const { response } = require('express');
const mongoose = require('mongoose');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const Solicitud = require('../../models/Gestion/SolicitudAtencion');
const Paciente = require('../../models/Mantenimiento/Paciente');
const ResultadoLaboratorio = require('../../models/Gestion/ResultadoLaboratorio');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const { buscarCoincidenciasVinculacion } = require('../../utils/Gestion/buscarCoincidenciasVinculacion');
const { normalizarDocumento, esAtencionTemporalPendiente, normalizarIdentidadPropuesta } = require('./previsualizarRegularizacionTemporalController');

const errorNegocio = (codigo, msg, status = 409) => {
  const error = new Error(msg);
  error.codigo = codigo;
  error.status = status;
  throw error;
};

const normalizarNombre = valor => String(valor ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const mismoDocumento = (paciente, documento) =>
  String(paciente.tipoDoc ?? '').trim().toUpperCase() === documento.tipoDoc &&
  String(paciente.nroDoc ?? '').trim().toUpperCase() === documento.nroDoc;

// ====== Comparar datos declarados y referencia del maestro ======
const compararIdentidad = (programacion, paciente) => {
  const nombreProgramado = normalizarNombre(programacion.nombreCliente);
  const nombreMaestro = normalizarNombre(paciente.nombreCliente);
  const paternoProgramado = normalizarNombre(programacion.apePatCliente);
  const paternoMaestro = normalizarNombre(paciente.apePatCliente);
  const maternoProgramado = normalizarNombre(programacion.apeMatCliente);
  const maternoMaestro = normalizarNombre(paciente.apeMatCliente);
  const coincideNombre = nombreProgramado === nombreMaestro;
  const coincidePaterno = paternoProgramado === paternoMaestro;
  const coincideMaterno = !maternoProgramado || maternoProgramado === maternoMaestro;
  return {
    coincide: coincideNombre && coincidePaterno && coincideMaterno,
    diferencias: [
      ...(!coincideNombre ? ['Nombres'] : []),
      ...(!coincidePaterno ? ['Apellido paterno'] : []),
      ...(!coincideMaterno ? ['Apellido materno'] : []),
    ],
  };
};

// ====== Registrar cambios originales frente a la identidad definitiva ======
const fechaISO = valor => {
  if (!valor) return '';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString().slice(0, 10);
};

const obtenerIdentidadDefinitiva = (programacion, declarada, paciente) => ({
  nombreCliente: paciente.nombreCliente,
  apePatCliente: paciente.apePatCliente,
  apeMatCliente: paciente.apeMatCliente || '',
  sexoCliente: paciente.sexoCliente || declarada.sexoCliente || programacion.sexoCliente || null,
  fechaNacimiento: paciente.fechaNacimiento || declarada.fechaNacimiento || programacion.fechaNacimiento || null,
});

const crearCambiosIdentidad = (programacion, identidad) => {
  const cambios = [];
  for (const campo of ['nombreCliente', 'apePatCliente', 'apeMatCliente', 'sexoCliente', 'fechaNacimiento']) {
    const anterior = campo === 'fechaNacimiento' ? fechaISO(programacion[campo]) : String(programacion[campo] ?? '').trim();
    const nuevo = campo === 'fechaNacimiento' ? fechaISO(identidad[campo]) : String(identidad[campo] ?? '').trim();
    if (anterior !== nuevo) cambios.push({ campo, valorAnterior: anterior || null, valorNuevo: nuevo || null });
  }
  return cambios;
};

// ====== Resolver el nombre real del responsable ======
const buscarNombreResponsable = async (uid, nombreUsuario, session) => {
  const filtros = [];
  if (uid) filtros.push({ codRecHumano: uid });
  if (nombreUsuario) filtros.push({ 'datosLogueo.nombreUsuario': nombreUsuario });
  if (!filtros.length) return null;
  const recursos = await RecursoHumano.find({ $or: filtros })
    .select('codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano datosLogueo.nombreUsuario')
    .session(session).lean();
  const recurso = recursos.find(r => String(r.codRecHumano) === String(uid)) ??
    recursos.find(r => String(r.datosLogueo?.nombreUsuario ?? '') === String(nombreUsuario ?? ''));
  return recurso ? [recurso.nombreRecHumano, recurso.apePatRecHumano, recurso.apeMatRecHumano]
    .map(v => String(v ?? '').trim()).filter(Boolean).join(' ') || null : null;
};

// ====== Vincular HC existente sin recrear solicitudes, resultados ni fotografías ======
const regularizarTemporalConHCExistente = async (req, res = response) => {
  let session;
  try {
    const id = String(req.params.id ?? '');
    const pacienteId = String(req.body?.pacienteId ?? '').trim();
    const hcConfirmada = String(req.body?.hcConfirmada ?? '').trim();
    const motivoDecision = String(req.body?.motivoDecision ?? '').trim();
    const documento = normalizarDocumento(req.body);
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(pacienteId)) {
      errorNegocio('ID_INVALIDO', 'La programación o el paciente no son válidos.', 400);
    }
    if (!documento) errorNegocio('DOCUMENTO_INVALIDO', 'Ingrese un documento válido.', 400);
    if (!hcConfirmada || req.body?.confirmacionExpresa !== true) {
      errorNegocio('CONFIRMACION_REQUERIDA', 'Confirme expresamente la identidad y la HC elegida.', 400);
    }
    if (motivoDecision.length > 300) {
      errorNegocio('MOTIVO_INVALIDO', 'El motivo no puede superar los 300 caracteres.', 400);
    }
    const uid = String(req.user?.uid ?? '').trim();
    const nombreUsuario = String(req.user?.nombreUsuario ?? '').trim();
    if (!uid) errorNegocio('USUARIO_INVALIDO', 'No se pudo identificar al responsable.', 401);

    session = await mongoose.startSession();
    let respuestaOperacion;
    await session.withTransaction(async () => {
      const programacion = await Programacion.findById(id).session(session);
      if (!programacion) errorNegocio('PROGRAMACION_NO_ENCONTRADA', 'La programación no existe.', 404);
      if (!esAtencionTemporalPendiente(programacion)) {
        errorNegocio('ATENCION_NO_TEMPORAL', 'La atención ya no está en identidad temporal o no admite regularización.');
      }
      const solicitudes = await Solicitud.find({ programacionEmpresaId: programacion._id }).session(session);
      if (!solicitudes.length || solicitudes.some(s =>
        s.origenAtencion !== 'EMPRESA' || s.identidadAtencion !== 'TEMPORAL' ||
        s.clienteId || s.hc || s.tipoDoc || s.nroDoc)) {
        errorNegocio('SOLICITUDES_INCONSISTENTES', 'Las solicitudes ya no están íntegramente en identidad temporal.');
      }

      const paciente = await Paciente.findById(pacienteId).session(session);
      if (!paciente || !paciente.hc || !paciente.tipoDoc || !paciente.nroDoc ||
          paciente.estadoIdentificacion === 'PENDIENTE') {
        errorNegocio('PACIENTE_NO_HABILITADO', 'El paciente maestro no tiene identidad y HC definitivas.');
      }
      if (String(paciente.hc) !== hcConfirmada) {
        errorNegocio('HC_NO_COINCIDE', 'La HC elegida cambió. Vuelva a consultar al paciente.');
      }
      if (!mismoDocumento(paciente, documento)) {
        errorNegocio('DOCUMENTO_NO_COINCIDE', 'El documento propuesto no coincide con el documento vigente de la HC.');
      }
      if (paciente.tipoHC === 'PROVISIONAL' && paciente.estadoConciliacion !== 'CONCILIADA') {
        errorNegocio('HC_PROVISIONAL', 'La HC provisional debe conciliarse antes de utilizarse en esta operación.');
      }

      // ====== Revalidar con la identidad ingresada, no con la programación inicial ======
      const identidadDeclarada = normalizarIdentidadPropuesta(req.body);
      const propuesta = { ...identidadDeclarada, ...documento };
      const coincidencias = await buscarCoincidenciasVinculacion(
        Paciente, propuesta, compararIdentidad, session,
      );
      const coincidenciasDocumento = [...new Set(coincidencias.porDocumento.map(c => String(c.pacienteId)))];
      if (coincidenciasDocumento.length !== 1 || coincidenciasDocumento[0] !== String(paciente._id)) {
        errorNegocio('DOCUMENTO_AMBIGUO', 'El documento no identifica de manera única a la HC seleccionada.');
      }
      // ====== La identidad del maestro prevalece; las diferencias no impiden vincular ======
      const identidadOriginal = compararIdentidad(programacion, paciente);
      const identidadConsultada = compararIdentidad(identidadDeclarada, paciente);
      const tieneDiscrepancias = !identidadOriginal.coincide || !identidadConsultada.coincide;
      if (tieneDiscrepancias && req.body?.confirmacionDiscrepancia !== true) {
        errorNegocio('DISCREPANCIA_NO_CONFIRMADA', 'Confirme expresamente las diferencias de identidad antes de vincular.');
      }
      const identidadDefinitiva = obtenerIdentidadDefinitiva(programacion, identidadDeclarada, paciente);
      const cambiosIdentidad = crearCambiosIdentidad(programacion, identidadDefinitiva);

      const liberados = await ResultadoLaboratorio.exists({
        solicitudAtencionId: { $in: solicitudes.map(s => s._id) }, estadoResultado: 'LIBERADO',
      }).session(session);
      if (liberados) {
        errorNegocio('RESULTADOS_YA_LIBERADOS', 'Existen resultados liberados; se requiere revisión de integridad.');
      }

      const ahora = new Date();
      const nombreCompletoUsuario = await buscarNombreResponsable(uid, nombreUsuario, session);
      programacion.tipoDoc = documento.tipoDoc;
      programacion.nroDoc = documento.nroDoc;
      programacion.pacienteId = paciente._id;
      programacion.hc = paciente.hc;
      // ====== Actualizar datos transaccionales desde el maestro ======
      Object.assign(programacion, identidadDefinitiva);
      programacion.identidadTemporalActiva = false;
      programacion.fechaRegularizacionIdentidad = ahora;
      programacion.updatedBy = uid;
      programacion.usuarioActualizacion = nombreUsuario;
      programacion.fechaActualizacion = ahora;
      programacion.historialVinculaciones.push({
        tipo: 'REGULARIZACION_TEMPORAL_HC_EXISTENTE',
        pacienteIdAnterior: null, hcAnterior: null,
        pacienteIdNuevo: paciente._id, hcNueva: paciente.hc,
        tipoDocAnterior: null, nroDocAnterior: null,
        tipoDocNuevo: documento.tipoDoc, nroDocNuevo: documento.nroDoc,
        fecha: ahora, ejecutadoPor: uid, usuario: nombreUsuario, nombreCompletoUsuario,
        origenDocumento: 'REGULARIZACION_TEMPORAL',
        tipoResolucion: tieneDiscrepancias ? 'DISCREPANCIA_CONFIRMADA' : 'COINCIDENCIA_EXACTA',
        motivoDecision: motivoDecision || null,
        identidadDeclarada: {
          nombreCliente: identidadDeclarada.nombreCliente,
          apePatCliente: identidadDeclarada.apePatCliente,
          apeMatCliente: identidadDeclarada.apeMatCliente,
          sexoCliente: identidadDeclarada.sexoCliente,
          fechaNacimiento: identidadDeclarada.fechaNacimiento,
        },
        cambiosIdentidad,
      });
      await programacion.save({ session });

      for (const solicitud of solicitudes) {
        solicitud.identidadAtencion = 'VINCULADA';
        solicitud.clienteId = paciente._id;
        solicitud.hc = paciente.hc;
        solicitud.tipoDoc = documento.tipoDoc;
        solicitud.nroDoc = documento.nroDoc;
        solicitud.nombreCliente = identidadDefinitiva.nombreCliente;
        solicitud.apePatCliente = identidadDefinitiva.apePatCliente;
        solicitud.apeMatCliente = identidadDefinitiva.apeMatCliente;
        solicitud.sexoPaciente = identidadDefinitiva.sexoCliente;
        solicitud.fechaNacimientoPaciente = identidadDefinitiva.fechaNacimiento;
        solicitud.updatedBy = uid;
        solicitud.usuarioActualizacion = nombreUsuario;
        solicitud.fechaActualizacion = ahora;
        await solicitud.save({ session });
      }
      respuestaOperacion = {
        ok: true, codigo: 'REGULARIZACION_COMPLETADA',
        msg: 'Identidad regularizada con HC existente. Se conservaron solicitudes, resultados y fotografías.',
        programacion: { _id: String(programacion._id), codProgramacion: programacion.codProgramacion,
          identidadTemporalActiva: false, tipoDoc: documento.tipoDoc, nroDoc: documento.nroDoc,
          pacienteId: String(paciente._id), hc: paciente.hc,
          nombreCliente: identidadDefinitiva.nombreCliente,
          apePatCliente: identidadDefinitiva.apePatCliente,
          apeMatCliente: identidadDefinitiva.apeMatCliente },
        solicitudesActualizadas: solicitudes.map(s => ({ _id: String(s._id), codSolicitud: s.codSolicitud,
          codigoLaboratorio: s.codigoLaboratorio, identidadAtencion: s.identidadAtencion })),
        fotografiasSinModificar: true,
      };
    });
    return res.json(respuestaOperacion);
  } catch (error) {
    if (!error.codigo) console.error('Error en regularización temporal con HC existente:', error);
    return res.status(error.status ?? 500).json({ ok: false, codigo: error.codigo ?? 'ERROR_REGULARIZACION',
      msg: error.codigo ? error.message : 'No se pudo regularizar la identidad. No se aplicaron cambios.' });
  } finally {
    if (session) await session.endSession();
  }
};

module.exports = { regularizarTemporalConHCExistente, compararIdentidad };
