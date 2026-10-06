const MuestraLaboratorio = require("../../models/Gestion/MuestraLaboratorio");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");

// ====== Obtener listas seguras ======

const obtenerLista = (valor) => (Array.isArray(valor) ? valor : []);

// ====== Resolver intentos vigentes ======

const resolverIntentosVigentes = (muestras = []) => {
  const grupos = new Map();

  obtenerLista(muestras).forEach((muestra) => {
    const clavePlan = String(
      muestra?.claveMuestraPlan ?? muestra?._id?.toString?.() ?? "",
    ).trim();

    if (!clavePlan) {
      return;
    }

    if (!grupos.has(clavePlan)) {
      grupos.set(clavePlan, []);
    }

    grupos.get(clavePlan).push(muestra);
  });

  const recipientes = [];

  for (const [claveMuestraPlan, intentos] of grupos.entries()) {
    const intentosOrdenados = [...intentos].sort((a, b) => {
      const intentoA = Number(a?.numeroIntento ?? 1);
      const intentoB = Number(b?.numeroIntento ?? 1);

      if (intentoA !== intentoB) {
        return intentoA - intentoB;
      }

      return (
        new Date(a?.createdAt ?? 0).getTime() -
        new Date(b?.createdAt ?? 0).getTime()
      );
    });

    const ultimoIntento = intentosOrdenados[intentosOrdenados.length - 1] ?? null;

    const vigente =
      ultimoIntento && ultimoIntento.estadoMuestra !== "ANULADA"
        ? ultimoIntento
        : null;

    recipientes.push({
      claveMuestraPlan,
      vigente,
      ultimoIntento,
      totalIntentos: intentosOrdenados.length,
    });
  }

  return recipientes;
};

// ====== Contar estados vigentes de muestra ======

const contarEstadosMuestra = (recipientes = []) => {
  const resumen = {
    total: recipientes.length,
    pendientes: 0,
    recolectadas: 0,
    recepcionadas: 0,
    aceptadas: 0,
    rechazadas: 0,
    sinIntentoVigente: 0,
  };

  recipientes.forEach(({ vigente }) => {
    if (!vigente) {
      resumen.sinIntentoVigente += 1;
      return;
    }

    switch (vigente.estadoMuestra) {
      case "PENDIENTE":
        resumen.pendientes += 1;
        break;

      case "RECOLECTADA":
        resumen.recolectadas += 1;
        break;

      case "RECEPCIONADA":
        resumen.recepcionadas += 1;
        break;

      case "ACEPTADA":
        resumen.aceptadas += 1;
        break;

      case "RECHAZADA":
        resumen.rechazadas += 1;
        break;

      default:
        break;
    }
  });

  return resumen;
};

// ====== Construir estado operativo de Laboratorio ======

const construirEstadoOperativoLaboratorio = ({
  solicitud,
  muestras = [],
  resultados = [],
}) => {
  const unidades = obtenerLista(solicitud?.unidadesLaboratorio);

  const unidadesActivas = unidades.filter((unidad) => unidad?.estado !== "ANULADO");

  const clavesUnidadesActivas = new Set(
    unidadesActivas
      .map((unidad) => String(unidad?.claveUnidad ?? "").trim())
      .filter(Boolean),
  );

  const unidadesRequierenMuestra = unidadesActivas.filter(
    (unidad) => unidad?.snapshotClinico?.requiereMuestra === true,
  );

  const clavesUnidadesRequierenMuestra = new Set(
    unidadesRequierenMuestra
      .map((unidad) => String(unidad?.claveUnidad ?? "").trim())
      .filter(Boolean),
  );

  const requiereMuestra = clavesUnidadesRequierenMuestra.size > 0;

  const recipientes = resolverIntentosVigentes(muestras);
  const resumenMuestrasVigentes = contarEstadosMuestra(recipientes);

  const coberturasVigentes = new Set();

  recipientes.forEach(({ vigente }) => {
    obtenerLista(vigente?.coberturas).forEach((cobertura) => {
      const claveUnidad = String(cobertura?.claveUnidad ?? "").trim();

      if (claveUnidad) {
        coberturasVigentes.add(claveUnidad);
      }
    });
  });

  const unidadesSinCoberturaVigente = [...clavesUnidadesRequierenMuestra].filter(
    (claveUnidad) => !coberturasVigentes.has(claveUnidad),
  ).length;

  const hayPendienteMuestra =
    requiereMuestra &&
    (recipientes.length === 0 ||
      unidadesSinCoberturaVigente > 0 ||
      resumenMuestrasVigentes.pendientes > 0 ||
      resumenMuestrasVigentes.rechazadas > 0 ||
      resumenMuestrasVigentes.sinIntentoVigente > 0);

  const todasMuestrasAceptadas =
    requiereMuestra &&
    !hayPendienteMuestra &&
    recipientes.length > 0 &&
    resumenMuestrasVigentes.aceptadas === recipientes.length;

  const todasMuestrasCompletadas =
    requiereMuestra &&
    !hayPendienteMuestra &&
    recipientes.length > 0 &&
    resumenMuestrasVigentes.recolectadas +
        resumenMuestrasVigentes.recepcionadas +
        resumenMuestrasVigentes.aceptadas ===
      recipientes.length;

  const puedeRetirarsePaciente = !requiereMuestra || !hayPendienteMuestra;

  const resultadosUnidadesActivas = obtenerLista(resultados).filter((resultado) =>
    clavesUnidadesActivas.has(String(resultado?.claveUnidad ?? "").trim()),
  );

  const resultadosPorUnidad = new Map(
    resultadosUnidadesActivas.map((resultado) => [
      String(resultado?.claveUnidad ?? "").trim(),
      resultado,
    ]),
  );

  const resumenResultados = {
    total: unidadesActivas.length,
    totalDocumentos: resultadosUnidadesActivas.length,
    sinInicializar: Math.max(0, unidadesActivas.length - resultadosPorUnidad.size),
    pendientes: 0,
    enProceso: 0,
    completos: 0,
    validados: 0,
    liberados: 0,
    anulados: 0,
    disponibles: 0,
  };

  resultadosUnidadesActivas.forEach((resultado) => {
    switch (resultado?.estadoResultado) {
      case "PENDIENTE":
        resumenResultados.pendientes += 1;
        break;

      case "EN PROCESO":
        resumenResultados.enProceso += 1;
        break;

      case "COMPLETO":
        resumenResultados.completos += 1;
        break;

      case "VALIDADO":
        resumenResultados.validados += 1;
        break;

      case "LIBERADO":
        resumenResultados.liberados += 1;
        break;

      case "ANULADO":
        resumenResultados.anulados += 1;
        break;

      default:
        break;
    }
  });

  resumenResultados.disponibles = resumenResultados.liberados;

  const resultadosPorEstadoUnidad = unidadesActivas.map((unidad) =>
    resultadosPorUnidad.get(String(unidad?.claveUnidad ?? "").trim()) ?? null,
  );

  const todosResultadosLiberados =
    unidadesActivas.length > 0 &&
    resultadosPorEstadoUnidad.every(
      (resultado) => resultado?.estadoResultado === "LIBERADO",
    );

  const algunResultadoLiberado = resumenResultados.liberados > 0;

  const todosResultadosValidados =
    unidadesActivas.length > 0 &&
    resultadosPorEstadoUnidad.every(
      (resultado) => resultado?.estadoResultado === "VALIDADO",
    );

  const todosResultadosAlMenosCompletos =
    unidadesActivas.length > 0 &&
    resultadosPorEstadoUnidad.every((resultado) =>
      ["COMPLETO", "VALIDADO", "LIBERADO"].includes(
        resultado?.estadoResultado,
      ),
    );

  const hayResultadosEnProceso = resultadosPorEstadoUnidad.some((resultado) =>
    ["EN PROCESO", "COMPLETO", "VALIDADO", "LIBERADO"].includes(
      resultado?.estadoResultado,
    ),
  );

  const resumenUnidades = {
    total: unidades.length,
    activas: unidadesActivas.length,
    pendientes: unidadesActivas.filter((unidad) => unidad?.estado === "PENDIENTE")
      .length,
    enProceso: unidadesActivas.filter(
      (unidad) => unidad?.estado === "EN PROCESO",
    ).length,
    terminadas: unidadesActivas.filter((unidad) => unidad?.estado === "TERMINADO")
      .length,
    anuladas: unidades.filter((unidad) => unidad?.estado === "ANULADO").length,
  };

  let codigo = "PENDIENTE_RESULTADOS";
  let descripcion = "Pendiente de resultados";

  if (solicitud?.estado === "ANULADO") {
    codigo = "ANULADO";
    descripcion = "Solicitud anulada";
  } else if (hayPendienteMuestra) {
    codigo = "PENDIENTE_MUESTRAS";
    descripcion = "Pendiente de muestras";
  } else if (todosResultadosLiberados) {
    codigo = "RESULTADOS_LIBERADOS";
    descripcion = "Resultados liberados";
  } else if (algunResultadoLiberado) {
    codigo = "RESULTADOS_DISPONIBLES_PARCIALMENTE";
    descripcion = "Resultados disponibles parcialmente";
  } else if (
    requiereMuestra &&
    todasMuestrasCompletadas &&
    !todasMuestrasAceptadas
  ) {
    codigo = "MUESTRAS_COMPLETADAS";
    descripcion = "Muestras completadas";
  } else if (todosResultadosValidados) {
    codigo = "RESULTADOS_VALIDADOS";
    descripcion = "Resultados validados";
  } else if (todosResultadosAlMenosCompletos) {
    codigo = "RESULTADOS_COMPLETOS";
    descripcion = "Resultados completos";
  } else if (hayResultadosEnProceso) {
    codigo = "RESULTADOS_EN_PROCESO";
    descripcion = "Resultados en proceso";
  } else if (requiereMuestra && todasMuestrasAceptadas) {
    codigo = "MUESTRAS_ACEPTADAS";
    descripcion = "Muestras aceptadas";
  }

  const actividadIniciada =
    obtenerLista(muestras).length > 0 ||
    resultadosUnidadesActivas.length > 0 ||
    ["EN PROCESO", "ATENDIDO"].includes(solicitud?.estado);

  let estadoPrincipalSugerido = "GENERADO";

  if (solicitud?.estado === "ANULADO") {
    estadoPrincipalSugerido = "ANULADO";
  } else if (solicitud?.estado === "ATENDIDO" || todosResultadosLiberados) {
    estadoPrincipalSugerido = "ATENDIDO";
  } else if (actividadIniciada) {
    estadoPrincipalSugerido = "EN PROCESO";
  }

  return {
    dominio: "LABORATORIO",
    codigo,
    descripcion,
    estadoPrincipalSugerido,
    puedeRetirarsePaciente,
    tieneResultadosDisponibles: algunResultadoLiberado,
    resultadosDisponibles: resumenResultados.disponibles,
    requiereMuestra,
    hayObligacionPendientePaciente: hayPendienteMuestra,
    resumen: {
      muestras: {
        requiereMuestra,
        totalDocumentos: obtenerLista(muestras).length,
        recipientesPlanificados: recipientes.length,
        unidadesRequierenMuestra: unidadesRequierenMuestra.length,
        unidadesSinCoberturaVigente,
        vigentes: resumenMuestrasVigentes,
      },
      resultados: resumenResultados,
      unidades: resumenUnidades,
    },
  };
};

// ====== Obtener datos operativos de Laboratorio ======

const obtenerDatosOperativosLaboratorio = async ({
  solicitudAtencionId,
  session = null,
}) => {
  let consultaMuestras = MuestraLaboratorio.find({
    solicitudAtencionId,
  }).select(
    [
      "_id",
      "claveMuestraPlan",
      "numeroRecipiente",
      "numeroIntento",
      "estadoMuestra",
      "createdAt",
      "coberturas.claveUnidad",
    ].join(" "),
  );

  let consultaResultados = ResultadoLaboratorio.find({
    solicitudAtencionId,
  }).select(
    [
      "_id",
      "solicitudAtencionId",
      "claveUnidad",
      "estadoResultado",
    ].join(" "),
  );

  if (session) {
    consultaMuestras = consultaMuestras.session(session);
    consultaResultados = consultaResultados.session(session);
  }

  const [muestras, resultados] = await Promise.all([
    consultaMuestras.lean(),
    consultaResultados.lean(),
  ]);

  return {
    muestras,
    resultados,
  };
};

// ====== Resolver estado operativo genérico ======

const resolverEstadoOperativoSolicitud = async ({
  solicitud,
  muestras = null,
  resultados = null,
  session = null,
}) => {
  if (!solicitud) {
    throw new Error("La solicitud es obligatoria para resolver el estado operativo");
  }

  if (solicitud.tipo !== "Laboratorio") {
    return {
      dominio: String(solicitud.tipo ?? "OTRO").toUpperCase(),
      codigo: "NO_DEFINIDO",
      descripcion: "Estado operativo no definido",
      estadoPrincipalSugerido: solicitud.estado,
    };
  }

  let muestrasFinales = muestras;
  let resultadosFinales = resultados;

  if (!Array.isArray(muestrasFinales) || !Array.isArray(resultadosFinales)) {
    const datos = await obtenerDatosOperativosLaboratorio({
      solicitudAtencionId: solicitud._id,
      session,
    });

    if (!Array.isArray(muestrasFinales)) {
      muestrasFinales = datos.muestras;
    }

    if (!Array.isArray(resultadosFinales)) {
      resultadosFinales = datos.resultados;
    }
  }

  return construirEstadoOperativoLaboratorio({
    solicitud,
    muestras: muestrasFinales,
    resultados: resultadosFinales,
  });
};

// ====== Sincronizar Unidad y estado principal ======

const sincronizarEstadosSolicitudLaboratorio = async ({
  solicitud,
  uid = null,
  nombreUsuario = null,
  session = null,
}) => {
  if (!solicitud) {
    throw new Error("La solicitud es obligatoria para sincronizar sus estados");
  }

  if (solicitud.tipo !== "Laboratorio" || solicitud.estado === "ANULADO") {
    return resolverEstadoOperativoSolicitud({
      solicitud,
      session,
    });
  }

  const { muestras, resultados } = await obtenerDatosOperativosLaboratorio({
    solicitudAtencionId: solicitud._id,
    session,
  });

  const resultadosPorUnidad = new Map(
    resultados.map((resultado) => [
      String(resultado?.claveUnidad ?? "").trim(),
      resultado,
    ]),
  );

  let unidadesModificadas = false;

  obtenerLista(solicitud.unidadesLaboratorio).forEach((unidad) => {
    if (unidad?.estado === "ANULADO") {
      return;
    }

    const resultado = resultadosPorUnidad.get(
      String(unidad?.claveUnidad ?? "").trim(),
    );

    if (!resultado || resultado.estadoResultado === "ANULADO") {
      return;
    }

    let nuevoEstadoUnidad = "PENDIENTE";

    if (resultado.estadoResultado === "LIBERADO") {
      nuevoEstadoUnidad = "TERMINADO";
    } else if (
      ["EN PROCESO", "COMPLETO", "VALIDADO"].includes(
        resultado.estadoResultado,
      )
    ) {
      nuevoEstadoUnidad = "EN PROCESO";
    }

    if (unidad.estado !== nuevoEstadoUnidad) {
      unidad.estado = nuevoEstadoUnidad;
      unidadesModificadas = true;
    }
  });

  let estadoOperativo = construirEstadoOperativoLaboratorio({
    solicitud,
    muestras,
    resultados,
  });

  const estadoAnteriorSolicitud = solicitud.estado;
  let nuevoEstadoSolicitud = estadoAnteriorSolicitud;

  if (estadoOperativo.estadoPrincipalSugerido === "ATENDIDO") {
    nuevoEstadoSolicitud = "ATENDIDO";
  } else if (
    estadoAnteriorSolicitud === "GENERADO" &&
    estadoOperativo.estadoPrincipalSugerido === "EN PROCESO"
  ) {
    nuevoEstadoSolicitud = "EN PROCESO";
  }

  const estadoSolicitudModificado = nuevoEstadoSolicitud !== estadoAnteriorSolicitud;

  if (estadoSolicitudModificado) {
    solicitud.estado = nuevoEstadoSolicitud;
  }

  if (estadoSolicitudModificado && nuevoEstadoSolicitud === "ATENDIDO") {
    const ahora = new Date();

    solicitud.fechaAtencionArea = solicitud.fechaAtencionArea ?? ahora;
    solicitud.atendidoPor = solicitud.atendidoPor ?? uid;
    solicitud.usuarioAtencion = solicitud.usuarioAtencion ?? nombreUsuario;
  }

  if (unidadesModificadas || estadoSolicitudModificado) {
    solicitud.updatedBy = uid ?? solicitud.updatedBy;
    solicitud.usuarioActualizacion = nombreUsuario ?? solicitud.usuarioActualizacion;
    solicitud.fechaActualizacion = new Date();

    if (unidadesModificadas && typeof solicitud.markModified === "function") {
      solicitud.markModified("unidadesLaboratorio");
    }

    await solicitud.save({
      ...(session ? { session } : {}),
    });

    estadoOperativo = construirEstadoOperativoLaboratorio({
      solicitud,
      muestras,
      resultados,
    });
  }

  return estadoOperativo;
};

module.exports = {
  construirEstadoOperativoLaboratorio,
  resolverEstadoOperativoSolicitud,
  sincronizarEstadosSolicitudLaboratorio,
};
