const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const SolicitudAtencion = require('../../models/Gestion/SolicitudAtencion');
const MuestraLaboratorio = require('../../models/Gestion/MuestraLaboratorio');
const { construirEstadoOperativoLaboratorio } = require('./estadoOperativoSolicitud');

const ESTADOS_EDITABLES = ['EN ATENCION', 'PENDIENTE DE COMPLETAR'];
const tipoNormalizado = valor => String(valor ?? '').trim().toUpperCase();
const idNormalizado = valor => String(valor?._id ?? valor ?? '');

// ====== Relacionar cada servicio programado con su solicitud ======
const coincideServicio = (programado, registrado) => {
  const origen = registrado?.origenServicio ?? {};
  const ids = [registrado?.servicioId, origen.servicioOrigenId].map(idNormalizado);
  const codigos = [registrado?.codServicio, origen.codServicioOrigen]
    .map(tipoNormalizado);
  return Boolean(
    (idNormalizado(programado?.servicioId) && ids.includes(idNormalizado(programado.servicioId))) ||
    (tipoNormalizado(programado?.codServicio) && codigos.includes(tipoNormalizado(programado.codServicio)))
  );
};

// ====== Evaluar el hito presencial sin depender del código operativo vigente ======
const evaluarAtencionPresencialCompleta = ({ programacion, solicitudes = [], muestras = [] }) => {
  const serviciosProgramados = Array.isArray(programacion?.serviciosProgramados)
    ? programacion.serviciosProgramados : [];
  if (!serviciosProgramados.length || !solicitudes.length) return false;
  // ====== Áreas sin seguimiento presencial aún implementado no completan la programación ======
  if (serviciosProgramados.some(item => tipoNormalizado(item.tipoServicio) !== 'LABORATORIO') ||
      solicitudes.some(item => tipoNormalizado(item.tipo) !== 'LABORATORIO' || item.estado === 'ANULADO')) {
    return false;
  }
  // ====== Cada servicio del protocolo debe tener cobertura en alguna solicitud ======
  const serviciosReales = solicitudes.flatMap(item => Array.isArray(item.servicios) ? item.servicios : []);
  if (serviciosProgramados.some(item => !serviciosReales.some(real => coincideServicio(item, real)))) {
    return false;
  }

  return solicitudes.every(solicitud => {
    const unidades = Array.isArray(solicitud.unidadesLaboratorio)
      ? solicitud.unidadesLaboratorio.filter(u => u?.estado !== 'ANULADO') : [];
    // ====== Nunca dar por atendido un servicio sin una regla de atención definida ======
    if (!unidades.length || unidades.some(u => u?.snapshotClinico?.requiereMuestra !== true)) {
      return false;
    }
    const propias = muestras.filter(item =>
      idNormalizado(item.solicitudAtencionId) === idNormalizado(solicitud._id));
    const operativo = construirEstadoOperativoLaboratorio({ solicitud, muestras: propias, resultados: [] });
    const resumen = operativo.resumen.muestras;
    const vigentes = resumen.vigentes;
    return resumen.requiereMuestra === true &&
      resumen.recipientesPlanificados > 0 &&
      resumen.unidadesSinCoberturaVigente === 0 &&
      vigentes.pendientes === 0 && vigentes.rechazadas === 0 &&
      vigentes.sinIntentoVigente === 0 &&
      vigentes.recolectadas + vigentes.recepcionadas + vigentes.aceptadas === resumen.recipientesPlanificados;
  });
};

// ====== Registrar una única vez el bloqueo; nunca reabrir por retrocesos de muestras ======
const asegurarBloqueoFotograficoProgramacion = async ({ programacionId, session = null, usuario = null }) => {
  if (!programacionId) return { bloqueada: false, motivo: 'SIN_PROGRAMACION' };
  const query = Programacion.findById(programacionId)
    .select('_id estadoProgramacion fechaBloqueoFotografia serviciosProgramados');
  if (session) query.session(session);
  const programacion = await query.lean();
  if (!programacion) return { bloqueada: true, motivo: 'PROGRAMACION_NO_ENCONTRADA' };
  if (programacion.fechaBloqueoFotografia) {
    return { bloqueada: true, motivo: 'ATENCION_PRESENCIAL_COMPLETADA', fecha: programacion.fechaBloqueoFotografia };
  }
  if (!ESTADOS_EDITABLES.includes(programacion.estadoProgramacion)) {
    return { bloqueada: true, motivo: 'ESTADO_PROGRAMACION' };
  }

  const consultaSolicitudes = SolicitudAtencion.find({ programacionEmpresaId: programacion._id })
    .select('_id estado tipo servicios unidadesLaboratorio');
  if (session) consultaSolicitudes.session(session);
  const solicitudes = await consultaSolicitudes.lean();
  if (!solicitudes.length) return { bloqueada: false, motivo: 'SIN_SOLICITUDES' };
  const consultaMuestras = MuestraLaboratorio.find({
    solicitudAtencionId: { $in: solicitudes.map(item => item._id) },
  }).select('_id solicitudAtencionId claveMuestraPlan numeroIntento estadoMuestra createdAt coberturas.claveUnidad');
  if (session) consultaMuestras.session(session);
  const muestras = await consultaMuestras.lean();
  if (!evaluarAtencionPresencialCompleta({ programacion, solicitudes, muestras })) {
    return { bloqueada: false, motivo: 'SERVICIOS_PENDIENTES' };
  }

  const ahora = new Date();
  const cambios = await Programacion.updateOne({
    _id: programacion._id, fechaBloqueoFotografia: null,
    estadoProgramacion: { $in: ESTADOS_EDITABLES },
  }, { $set: {
    fechaBloqueoFotografia: ahora,
    origenBloqueoFotografia: 'SERVICIOS_PRESENCIALES_COMPLETADOS',
    usuarioBloqueoFotografia: usuario ? String(usuario) : null,
  } }, session ? { session } : {});

  if (cambios.modifiedCount === 1) {
    return { bloqueada: true, motivo: 'ATENCION_PRESENCIAL_COMPLETADA', fecha: ahora };
  }
  // ====== Si hubo carrera, no conceder edición sin volver a verificar ======
  return { bloqueada: true, motivo: 'PROGRAMACION_ACTUALIZADA' };
};

module.exports = {
  evaluarAtencionPresencialCompleta,
  asegurarBloqueoFotograficoProgramacion,
};
