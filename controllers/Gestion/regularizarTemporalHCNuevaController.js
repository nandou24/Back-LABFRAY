const { response } = require('express');
const mongoose = require('mongoose');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const Solicitud = require('../../models/Gestion/SolicitudAtencion');
const Paciente = require('../../models/Mantenimiento/Paciente');
const ResultadoLaboratorio = require('../../models/Gestion/ResultadoLaboratorio');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const { registrarPaciente } = require('../Mantenimiento/pacienteController');
const { normalizarDocumento, esAtencionTemporalPendiente, normalizarIdentidadPropuesta,
  buscarCandidatosIdentidadConsultada } = require('./previsualizarRegularizacionTemporalController');

const rechazar = (codigo, msg, status = 409) => {
  const error = new Error(msg);
  error.codigo = codigo;
  error.status = status;
  throw error;
};
const texto = valor => String(valor ?? '').trim().replace(/\s+/g, ' ');

// ====== Ubigeo opcional y jerárquico ======
const obtenerUbicacion = body => {
  const ubicacion = {
    departamentoCliente: texto(body?.departamentoCliente),
    provinciaCliente: texto(body?.provinciaCliente),
    distritoCliente: texto(body?.distritoCliente),
  };
  if (Object.values(ubicacion).some(valor => valor && !/^\d{2}$/.test(valor)) ||
      (ubicacion.provinciaCliente && !ubicacion.departamentoCliente) ||
      (ubicacion.distritoCliente && !ubicacion.provinciaCliente)) {
    rechazar('UBIGEO_INVALIDO', 'La ubicación es opcional; si indicas provincia o distrito, completa sus niveles anteriores.', 400);
  }
  return ubicacion;
};

// ====== Teléfonos múltiples y correo opcionales ======
const obtenerContacto = body => {
  const entrada = body?.phones ?? [];
  if (!Array.isArray(entrada) || entrada.length > 15) {
    rechazar('TELEFONOS_INVALIDOS', 'Ingresa un máximo de 15 teléfonos.', 400);
  }
  const phones = entrada.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      rechazar('TELEFONOS_INVALIDOS', 'Revise los teléfonos ingresados.', 400);
    }
    const phoneNumber = texto(item.phoneNumber);
    const descriptionPhone = texto(item.descriptionPhone);
    if (!/^\d{9,11}$/.test(phoneNumber) || !descriptionPhone || descriptionPhone.length > 30) {
      rechazar('TELEFONOS_INVALIDOS', 'Cada teléfono necesita 9 a 11 dígitos y una descripción de hasta 30 caracteres.', 400);
    }
    return { phoneNumber, descriptionPhone };
  });
  const correo = texto(body?.mailCliente).toLowerCase();
  if (correo && (correo.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))) {
    rechazar('CORREO_INVALIDO', 'El correo electrónico no es válido.', 400);
  }
  return { mailCliente: correo || undefined, phones };
};

// ====== Registrar cada corrección anterior / nueva en el evento de vinculación ======
const construirCambiosIdentidad = (programacion, identidad) =>
  ['nombreCliente', 'apePatCliente', 'apeMatCliente', 'sexoCliente', 'fechaNacimiento']
    .map(campo => {
      const anterior = campo === 'fechaNacimiento'
        ? (programacion[campo] ? new Date(programacion[campo]).toISOString().slice(0, 10) : null)
        : (programacion[campo] ?? null);
      const nuevo = identidad[campo] ?? null;
      return String(anterior ?? '') === String(nuevo ?? '') ? null :
        { campo, valorAnterior: anterior == null ? null : String(anterior),
          valorNuevo: nuevo == null ? null : String(nuevo) };
    }).filter(Boolean);

// ====== Resolver nombre auditado del operador ======
const nombreOperador = async (uid, usuario, session) => {
  const filtros = [];
  if (uid) filtros.push({ codRecHumano: uid });
  if (usuario) filtros.push({ 'datosLogueo.nombreUsuario': usuario });
  if (!filtros.length) return null;
  const recurso = await RecursoHumano.findOne({ $or: filtros })
    .select('nombreRecHumano apePatRecHumano apeMatRecHumano').session(session).lean();
  return recurso ? [recurso.nombreRecHumano, recurso.apePatRecHumano, recurso.apeMatRecHumano]
    .map(texto).filter(Boolean).join(' ') : null;
};

// ====== Crear identidad definitiva sin duplicar la atención transaccional ======
const regularizarTemporalConHCNueva = async (req, res = response) => {
  let session;
  try {
    const id = String(req.params.id ?? '');
    const documento = normalizarDocumento(req.body);
    const motivoDecision = texto(req.body?.motivoDecision);
    if (!mongoose.isValidObjectId(id)) rechazar('ID_INVALIDO', 'La programación no es válida.', 400);
    if (!documento) rechazar('DOCUMENTO_INVALIDO', 'Ingrese un documento válido.', 400);
    if (req.body?.confirmacionExpresa !== true || req.body?.confirmarNuevaHC !== true) {
      rechazar('CONFIRMACION_REQUERIDA', 'Confirme la identidad verificada y la creación de una HC nueva.', 400);
    }
    if (motivoDecision.length > 300) rechazar('MOTIVO_INVALIDO', 'El motivo supera 300 caracteres.', 400);
    const ubicacion = obtenerUbicacion(req.body);
    const contacto = obtenerContacto(req.body);
    const uid = texto(req.user?.uid);
    const usuario = texto(req.user?.nombreUsuario);
    if (!uid) rechazar('USUARIO_INVALIDO', 'No se pudo identificar al responsable.', 401);

    session = await mongoose.startSession();
    let salida;
    await session.withTransaction(async () => {
      const programacion = await Programacion.findById(id).session(session);
      if (!programacion) rechazar('PROGRAMACION_NO_ENCONTRADA', 'No se encontró la programación.', 404);
      if (!esAtencionTemporalPendiente(programacion)) {
        rechazar('ATENCION_NO_TEMPORAL', 'La atención ya fue regularizada o no admite regularización.');
      }
      const identidad = normalizarIdentidadPropuesta(req.body);
      const cambiosIdentidad = construirCambiosIdentidad(programacion, identidad);
      const solicitudes = await Solicitud.find({ programacionEmpresaId: programacion._id }).session(session);
      if (!solicitudes.length || solicitudes.some(s => s.origenAtencion !== 'EMPRESA' ||
        s.identidadAtencion !== 'TEMPORAL' || s.clienteId || s.hc || s.tipoDoc || s.nroDoc)) {
        rechazar('SOLICITUDES_INCONSISTENTES', 'Las solicitudes no están íntegramente en identidad temporal.');
      }

      // ====== Evitar dos altas simultáneas con el mismo documento en este flujo ======
      // La colección auxiliar utiliza el índice único _id nativo de MongoDB.
      const reservaId = `${documento.tipoDoc}:${documento.nroDoc}`;
      const reserva = await mongoose.connection.collection('reservasRegularizacionTemporal').updateOne(
        { _id: reservaId },
        { $setOnInsert: { programacionId: programacion._id, fecha: new Date() } },
        { session, upsert: true },
      );
      if (reserva.upsertedCount !== 1) {
        rechazar('DOCUMENTO_YA_RESERVADO', 'El documento ya fue regularizado por este flujo. Revise el paciente maestro.');
      }

      // ====== Reconsultar documento vigente y nombres dentro de la transacción ======
      const coincidencias = await buscarCandidatosIdentidadConsultada(documento, identidad, session);
      if (coincidencias.porDocumento.length) {
        rechazar('DOCUMENTO_EXISTENTE', 'Este documento ya pertenece a una HC. Revise la HC existente.');
      }
      // ====== Las coincidencias nominales se revisan; el documento manda ======
      const nominales = [...new Map(coincidencias.porNombres.map(c => [String(c.pacienteId), c])).values()];
      const descartados = req.body?.candidatosNominalesDescartados;
      if (nominales.length) {
        const ids = Array.isArray(descartados) ? descartados.map(String) : [];
        const esperados = new Set(nominales.map(c => String(c.pacienteId)));
        const revisionCompleta = ids.length === esperados.size &&
          new Set(ids).size === esperados.size && ids.every(id => esperados.has(id));
        if (!revisionCompleta || req.body?.confirmacionSinCorrespondencia !== true) {
          rechazar('COINCIDENCIAS_IDENTIDAD_PENDIENTES',
            'Revise los candidatos y confirme que son personas diferentes antes de crear una HC nueva.');
        }
      } else if (req.body?.confirmacionSinCorrespondencia === true ||
          (Array.isArray(descartados) && descartados.length > 0)) {
        rechazar('REVISION_DESACTUALIZADA', 'La lista de coincidencias cambió. Realice una nueva búsqueda.');
      }
      // ====== Sin resultados liberados: no alterar expedientes publicados ======
      const liberados = await ResultadoLaboratorio.exists({
        solicitudAtencionId: { $in: solicitudes.map(s => s._id) }, estadoResultado: 'LIBERADO',
      }).session(session);
      if (liberados) rechazar('RESULTADOS_YA_LIBERADOS', 'La atención posee resultados liberados y requiere revisión.');

      const paciente = await registrarPaciente({
        datosPaciente: {
          ...documento,
          ...identidad,
          fechaNacimiento: identidad.fechaNacimiento ? new Date(`${identidad.fechaNacimiento}T00:00:00.000Z`) : null,
          ...ubicacion, ...contacto,
          tipoHC: 'PRINCIPAL', estadoConciliacion: 'NO_APLICA',
          origenCreacionHC: 'EMPRESA_CON_DOCUMENTO',
          origenAlta: 'CAMPANA_EMPRESA',
        },
        estadoIdentificacion: 'REGISTRADA', session, uid, nombreUsuario: usuario,
      });
      if (!paciente?._id || !paciente.hc) rechazar('HC_NO_GENERADA', 'No se pudo generar la HC.');

      const ahora = new Date();
      const nombreCompletoUsuario = await nombreOperador(uid, usuario, session);
      // ====== Sincronizar identidad y contactos con la programación vigente ======
      const telefonosAnteriores = JSON.stringify((programacion.phones ?? []).map(t => ({
        phoneNumber: t.phoneNumber, descriptionPhone: t.descriptionPhone,
      })));
      const telefonosNuevos = JSON.stringify(contacto.phones);
      if (telefonosAnteriores !== telefonosNuevos) cambiosIdentidad.push({
        campo: 'phones', valorAnterior: telefonosAnteriores, valorNuevo: telefonosNuevos,
      });
      programacion.phones = contacto.phones;
      programacion.nombreCliente = identidad.nombreCliente;
      programacion.apePatCliente = identidad.apePatCliente;
      programacion.apeMatCliente = identidad.apeMatCliente;
      programacion.sexoCliente = identidad.sexoCliente;
      programacion.fechaNacimiento = identidad.fechaNacimiento ? new Date(`${identidad.fechaNacimiento}T00:00:00.000Z`) : null;
      programacion.tipoDoc = documento.tipoDoc;
      programacion.nroDoc = documento.nroDoc;
      programacion.pacienteId = paciente._id;
      programacion.hc = paciente.hc;
      programacion.identidadTemporalActiva = false;
      programacion.fechaRegularizacionIdentidad = ahora;
      programacion.updatedBy = uid;
      programacion.usuarioActualizacion = usuario;
      programacion.fechaActualizacion = ahora;
      // ====== Auditar cada candidato descartado sin alterar su HC ======
      for (const candidato of nominales) {
        programacion.historialRevisionIdentidad.push({
          decision: 'DISTINTO',
          pacienteIdCandidato: candidato.pacienteId,
          hcCandidata: candidato.hc ?? null,
          documentoCoincidente: false,
          tipoDocProgramacion: documento.tipoDoc,
          nroDocProgramacion: documento.nroDoc,
          nombreClienteProgramacion: identidad.nombreCliente,
          apePatClienteProgramacion: identidad.apePatCliente,
          apeMatClienteProgramacion: identidad.apeMatCliente,
          motivo: motivoDecision || null,
          fecha: ahora, ejecutadoPor: uid, usuario, nombreCompletoUsuario,
        });
      }
      programacion.historialVinculaciones.push({
        tipo: 'REGULARIZACION_TEMPORAL_HC_NUEVA',
        pacienteIdAnterior: null, hcAnterior: null,
        pacienteIdNuevo: paciente._id, hcNueva: paciente.hc,
        tipoDocAnterior: null, nroDocAnterior: null,
        tipoDocNuevo: documento.tipoDoc, nroDocNuevo: documento.nroDoc,
        fecha: ahora, ejecutadoPor: uid, usuario,
        nombreCompletoUsuario,
        origenDocumento: 'REGULARIZACION_TEMPORAL',
        tipoResolucion: nominales.length ? 'ALTA_NUEVA_EMPRESA_NOMINALES_DESCARTADAS' : 'ALTA_NUEVA_EMPRESA',
        motivoDecision: motivoDecision || null, cambiosIdentidad,
      });
      await programacion.save({ session });

      for (const solicitud of solicitudes) {
        solicitud.identidadAtencion = 'VINCULADA';
        solicitud.clienteId = paciente._id;
        solicitud.hc = paciente.hc;
        solicitud.tipoDoc = documento.tipoDoc;
        solicitud.nroDoc = documento.nroDoc;
        solicitud.nombreCliente = identidad.nombreCliente;
        solicitud.apePatCliente = identidad.apePatCliente;
        solicitud.apeMatCliente = identidad.apeMatCliente;
        solicitud.sexoPaciente = identidad.sexoCliente;
        solicitud.fechaNacimientoPaciente = identidad.fechaNacimiento ? new Date(`${identidad.fechaNacimiento}T00:00:00.000Z`) : null;
        solicitud.updatedBy = uid;
        solicitud.usuarioActualizacion = usuario;
        solicitud.fechaActualizacion = ahora;
        await solicitud.save({ session });
      }
      salida = {
        ok: true, codigo: 'REGULARIZACION_HC_NUEVA_COMPLETADA',
        msg: 'Se creó el paciente y su HC. Se conservaron las solicitudes y el trabajo clínico.',
        programacion: {
          _id: String(programacion._id), codProgramacion: programacion.codProgramacion,
          identidadTemporalActiva: false, tipoDoc: documento.tipoDoc, nroDoc: documento.nroDoc,
          pacienteId: String(paciente._id), hc: paciente.hc,
          nombreCliente: identidad.nombreCliente, apePatCliente: identidad.apePatCliente,
          apeMatCliente: identidad.apeMatCliente,
        },
        pacienteCreado: { _id: String(paciente._id), hc: paciente.hc },
        solicitudesActualizadas: solicitudes.map(s => ({ _id: String(s._id),
          codSolicitud: s.codSolicitud, codigoLaboratorio: s.codigoLaboratorio,
          identidadAtencion: s.identidadAtencion })),
        cambiosIdentidad, fotografiasSinModificar: true,
      };
    });
    return res.status(201).json(salida);
  } catch (error) {
    if (!error.codigo && error.code !== 11000) console.error('Error en regularización temporal con nueva HC:', error);
    const duplicado = error.code === 11000 || error.name === 'PacienteDuplicadoError';
    const concurrencia = error.code === 112 || error.hasErrorLabel?.('TransientTransactionError') ||
      ['WriteConflict', 'TransientTransactionError'].includes(error.codeName);
    const codigo = error.codigo || (duplicado ? 'CONFLICTO_DOCUMENTO_O_HC' :
      concurrencia ? 'CONCURRENCIA_IDENTIDAD' : 'ERROR_REGULARIZACION');
    const status = error.status || (duplicado || concurrencia ? 409 : 500);
    return res.status(status).json({ ok: false, codigo,
      msg: error.codigo ? error.message : 'No se completó la regularización. No se aplicaron cambios.' });
  } finally {
    if (session) await session.endSession();
  }
};

module.exports = { regularizarTemporalConHCNueva };
