const { response } = require('express');
const mongoose = require('mongoose');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const Solicitud = require('../../models/Gestion/SolicitudAtencion');
const Paciente = require('../../models/Mantenimiento/Paciente');
const ResultadoLaboratorio = require('../../models/Gestion/ResultadoLaboratorio');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const { registrarPaciente } = require('../Mantenimiento/pacienteController');
const { normalizarDocumento, esAtencionTemporalPendiente, normalizarIdentidadPropuesta,
  buscarCandidatosAmbasIdentidades } = require('./previsualizarRegularizacionTemporalController');

const rechazar = (codigo, msg, status = 409) => {
  const error = new Error(msg);
  error.codigo = codigo;
  error.status = status;
  throw error;
};
const texto = valor => String(valor ?? '').trim().replace(/\s+/g, ' ');

// ====== Validar datos reales del domicilio para un paciente definitivo ======
const obtenerUbicacion = body => {
  const ubicacion = {
    departamentoCliente: texto(body?.departamentoCliente),
    provinciaCliente: texto(body?.provinciaCliente),
    distritoCliente: texto(body?.distritoCliente),
  };
  // ====== Mantenimiento de Pacientes almacena códigos de ubigeo de dos dígitos ======
  if (Object.values(ubicacion).some(valor => !/^\d{2}$/.test(valor))) {
    rechazar('UBIGEO_INVALIDO', 'Seleccione departamento, provincia y distrito desde las listas.', 400);
  }
  return ubicacion;
};

// ====== Teléfono y correo opcionales ======
const obtenerContacto = body => {
  const telefono = texto(body?.telefonoCliente);
  const correo = texto(body?.mailCliente).toLowerCase();
  if (telefono && !/^\d{9,11}$/.test(telefono)) {
    rechazar('TELEFONO_INVALIDO', 'El teléfono debe tener entre 9 y 11 dígitos.', 400);
  }
  if (correo && (correo.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))) {
    rechazar('CORREO_INVALIDO', 'El correo electrónico no es válido.', 400);
  }
  return { mailCliente: correo || undefined, phones: telefono ? [{ phoneNumber: telefono, descriptionPhone: 'CELULAR' }] : [] };
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

// ====== Buscar documentos usados anteriormente en cualquier HC ======
const encontrarDocumentoHistorico = (documento, session) => {
  const tipoDoc = new RegExp(`^\\s*${documento.tipoDoc}\\s*$`, 'i');
  const nroDoc = new RegExp(`^\\s*${documento.nroDoc}\\s*$`, 'i');
  return Paciente.find({
    historialDocumentos: { $elemMatch: { $or: [
      { tipoDoc, nroDoc }, { tipoDocNuevo: tipoDoc, nroDocNuevo: nroDoc },
    ] } },
  }).select('_id hc').session(session).lean();
};

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
      const identidad = normalizarIdentidadPropuesta(req.body, programacion);
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

      // ====== Reconsultar maestro e historial dentro de la transacción ======
      const coincidencias = await buscarCandidatosAmbasIdentidades(programacion.toObject(), documento, identidad, session);
      const historicos = await encontrarDocumentoHistorico(documento, session);
      if (coincidencias.porDocumento.length || historicos.length) {
        rechazar('DOCUMENTO_EXISTENTE', 'El documento ya está asociado a un paciente o historial. Revise la HC existente.');
      }
      if (coincidencias.porNombres.length) {
        rechazar('COINCIDENCIAS_IDENTIDAD_PENDIENTES', 'Hay pacientes con nombres o apellidos similares. Revise antes de crear otra HC.');
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
      // ====== Sincronizar identidad corregida con la programación vigente ======
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
      programacion.historialVinculaciones.push({
        tipo: 'REGULARIZACION_TEMPORAL_HC_NUEVA',
        pacienteIdAnterior: null, hcAnterior: null,
        pacienteIdNuevo: paciente._id, hcNueva: paciente.hc,
        tipoDocAnterior: null, nroDocAnterior: null,
        tipoDocNuevo: documento.tipoDoc, nroDocNuevo: documento.nroDoc,
        fecha: ahora, ejecutadoPor: uid, usuario,
        nombreCompletoUsuario,
        origenDocumento: 'REGULARIZACION_TEMPORAL',
        tipoResolucion: 'ALTA_NUEVA_EMPRESA',
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
