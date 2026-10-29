const {
  construirEstadoOperativoLaboratorio,
  construirSeguimientoServiciosLaboratorio,
} = require('./estadoOperativoSolicitud');

// ====== Agrupar registros relacionados por solicitud ======
const agruparPorSolicitud = (documentos = []) => {
  const agrupados = new Map();
  for (const item of documentos) {
    const id = String(item.solicitudAtencionId ?? '');
    if (!id) continue;
    if (!agrupados.has(id)) agrupados.set(id, []);
    agrupados.get(id).push(item);
  }
  return agrupados;
};

const mismoServicioProgramado = (programado, detalle) => {
  const id = String(programado.servicioId ?? '');
  const codigo = String(programado.codServicio ?? '').trim().toUpperCase();
  const idActual = String(detalle.servicioId ?? '');
  const codigoActual = String(detalle.codServicio ?? '').trim().toUpperCase();
  const origen = detalle.origenServicio ?? {};
  const idOrigen = String(origen.servicioOrigenId ?? '');
  const codigoOrigen = String(origen.codServicioOrigen ?? '').trim().toUpperCase();

  // ====== Incluir servicios expandidos de un paquete ======
  return Boolean((id && (id === idActual || id === idOrigen)) ||
    (codigo && (codigo === codigoActual || codigo === codigoOrigen)));
};

// ====== Reutilizar estados de laboratorio sin modificarlos ======
const construirSeguimientoProgramacionesEmpresa = ({
  programaciones = [], solicitudes = [], muestras = [], resultados = [],
}) => {
  const muestrasPorSolicitud = agruparPorSolicitud(muestras);
  const resultadosPorSolicitud = agruparPorSolicitud(resultados);
  const solicitudesPorProgramacion = new Map();

  for (const solicitud of solicitudes) {
    const programacionId = String(solicitud.programacionEmpresaId ?? '');
    if (!programacionId) continue;

    let servicios = Array.isArray(solicitud.servicios) ? solicitud.servicios : [];
    let estadoOperativo = null;
    if (solicitud.tipo === 'Laboratorio') {
      const id = String(solicitud._id);
      const datos = {
        solicitud,
        muestras: muestrasPorSolicitud.get(id) ?? [],
        resultados: resultadosPorSolicitud.get(id) ?? [],
      };
      const calculado = construirEstadoOperativoLaboratorio(datos);
      estadoOperativo = { codigo: calculado.codigo, descripcion: calculado.descripcion };
      servicios = construirSeguimientoServiciosLaboratorio(datos);
    } else {
      // ====== Otros módulos aún no tienen estado operativo implementado ======
      servicios = servicios.map((servicio) => ({
        ...servicio,
        estadoSeguimiento: servicio.estado ?? null,
        estadoOperativo: null,
      }));
    }

    const resumen = {
      solicitudAtencionId: String(solicitud._id),
      codSolicitud: solicitud.codSolicitud ?? null,
      tipo: solicitud.tipo,
      estadoPrincipal: solicitud.estado,
      estadoOperativo,
    };
    const detalle = { ...resumen, servicios };
    if (!solicitudesPorProgramacion.has(programacionId)) {
      solicitudesPorProgramacion.set(programacionId, []);
    }
    solicitudesPorProgramacion.get(programacionId).push(detalle);
  }

  const respuesta = new Map();
  for (const programacion of programaciones) {
    const solicitudesVinculadas = solicitudesPorProgramacion.get(String(programacion._id)) ?? [];
    const todosServicios = solicitudesVinculadas.flatMap((solicitud) =>
      solicitud.servicios.map((servicio) => ({ ...servicio, tipo: solicitud.tipo,
        solicitudAtencionId: solicitud.solicitudAtencionId,
      }))
    );
    const servicios = (programacion.serviciosProgramados ?? []).map((programado) => {
      const relacionados = todosServicios.filter((servicio) => mismoServicioProgramado(programado, servicio));
      return {
        servicioId: String(programado.servicioId ?? ''),
        codServicio: programado.codServicio,
        estadoSeguimiento: relacionados.length === 1 ? relacionados[0].estadoSeguimiento : null,
        estadoOperativo: relacionados.length === 1 ? relacionados[0].estadoOperativo : null,
        // ====== Un paquete conserva el desglose de todos sus servicios ======
        detalleServicios: relacionados.length > 1 ? relacionados.map((servicio) => ({
          codServicio: servicio.codServicio,
          nombreServicio: servicio.nombreServicio,
          estadoSeguimiento: servicio.estadoSeguimiento,
          estadoOperativo: servicio.estadoOperativo,
        })) : [],
      };
    });
    respuesta.set(String(programacion._id), {
      solicitudes: solicitudesVinculadas.map(({ servicios: ignorar, ...resumen }) => resumen),
      servicios,
    });
  }
  return respuesta;
};

module.exports = { construirSeguimientoProgramacionesEmpresa };
