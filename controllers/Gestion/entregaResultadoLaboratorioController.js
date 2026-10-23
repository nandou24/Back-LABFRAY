const { response } = require("express");
const crypto = require('crypto');
const FirmaProfesionalLaboratorioVersion = require('../../models/Mantenimiento/FirmaProfesionalLaboratorioVersion');
const { obtenerBufferFirma, esPng } = require('../../utils/Gestion/responsableInformeLaboratorio');
const mongoose = require("mongoose");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");
const EntregaResultado = require("../../models/Gestion/EntregaResultadoLaboratorio");
const MuestraLaboratorio = require("../../models/Gestion/MuestraLaboratorio");
const DiaNoLaborable = require("../../models/Mantenimiento/DiaNoLaborable");

const {
  obtenerClaveFechaPeru,
  sumarDiasCompromiso,
} = require("../../utils/Gestion/calendarioLaboral");
const {
  obtenerFechaBaseTomaUnidad: obtenerFechaBaseTomaUnidadVigente,
} = require("../../utils/Gestion/compromisoEntregaLaboratorio");

// ====== Rango operativo de fechas en hora Perú ======

const OFFSET_HORARIO_PERU = "-05:00";

const construirLimiteFechaOperativa = (fecha, finDia = false) => {
  const texto = String(fecha ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return null;
  }

  const [anio, mes, dia] = texto.split("-").map(Number);
  const comprobacion = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    comprobacion.getUTCFullYear() !== anio ||
    comprobacion.getUTCMonth() !== mes - 1 ||
    comprobacion.getUTCDate() !== dia
  ) {
    return null;
  }

  const hora = finDia ? "23:59:59.999" : "00:00:00.000";
  const limite = new Date(`${texto}T${hora}${OFFSET_HORARIO_PERU}`);

  return Number.isFinite(limite.getTime()) ? limite : null;
};

// ====== Omitir Items opcionales sin resultado ======
const esValorResultadoVacio = (valor) =>
  valor === null ||
  valor === undefined ||
  (typeof valor === "string" && valor.trim() === "");

const obtenerItemsEntregables = (items = []) =>
  (Array.isArray(items) ? items : []).filter(
    (item) => !(item?.esOpcional === true && esValorResultadoVacio(item?.valor)),
  );

// ====== Resolver configuración histórica para informe ======
const obtenerMetadataItemInforme = ({ solicitud, resultado, item }) => {
  const unidades = Array.isArray(solicitud?.unidadesLaboratorio)
    ? solicitud.unidadesLaboratorio
    : [];

  const unidad = unidades.find(
    (unidadActual) => String(unidadActual?.claveUnidad ?? "") === String(resultado?.claveUnidad ?? ""),
  );

  const grupos = Array.isArray(unidad?.snapshotClinico?.gruposResultado)
    ? unidad.snapshotClinico.gruposResultado
    : [];
  const grupo = grupos[Number(item?.indiceGrupo ?? -1)] ?? null;
  const itemsGrupo = Array.isArray(grupo?.items) ? grupo.items : [];
  const itemSnapshot = itemsGrupo[Number(item?.indiceItem ?? -1)]?.snapshotItem ?? null;

  const mostrarReferenciaInforme =
    typeof item?.mostrarReferenciaInforme === "boolean"
      ? item.mostrarReferenciaInforme
      : itemSnapshot?.mostrarReferenciaInforme !== false;

  return {
    tipoResultado: itemSnapshot?.tipoResultado ?? item?.tipoResultado ?? "TEXTO",
    metodo: String(itemSnapshot?.metodoItemLab ?? "").trim() || null,
    nombreGrupo: String(grupo?.nombreGrupo ?? item?.nombreGrupo ?? "").trim(),
    comentarioReferenciaGrupo:
      String(grupo?.comentarioReferenciaGrupo ?? "").trim() || null,
    mostrarReferenciaInforme,
    hallazgosNormales: Array.isArray(
      itemSnapshot?.configuracionEstructurada?.hallazgosNormales,
    )
      ? [...itemSnapshot.configuracionEstructurada.hallazgosNormales]
      : [],
    referenciasConfiguradas: Array.isArray(itemSnapshot?.referenciasResultado)
      ? itemSnapshot.referenciasResultado
          .filter((referencia) => referencia?.activo !== false)
          .map((referencia) => ({
            descripcion: referencia.descripcion ?? "",
            sexo: referencia.sexo ?? "TODOS",
            edadMin: referencia.edadMin ?? null,
            edadMax: referencia.edadMax ?? null,
            unidadEdad: referencia.unidadEdad ?? "ANIOS",
            tipoReferencia: referencia.tipoReferencia ?? null,
            valorMin: referencia.valorMin ?? null,
            valorMax: referencia.valorMax ?? null,
            valorLimite: referencia.valorLimite ?? null,
            valoresPermitidos: Array.isArray(referencia.valoresPermitidos)
              ? [...referencia.valoresPermitidos]
              : [],
            textoReferencia: referencia.textoReferencia ?? "",
          }))
      : [],
  };
};

// ====== Tipos de muestra realmente utilizados por unidad ======
const construirMuestrasPorUnidad = (muestras = []) => {
  const mapa = new Map();

  for (const muestra of Array.isArray(muestras) ? muestras : []) {
    const nombreMuestra = String(
      muestra?.tipoMuestra?.nombreTipoMuestra ?? "",
    ).trim();

    if (!nombreMuestra) continue;

    for (const cobertura of Array.isArray(muestra?.coberturas)
      ? muestra.coberturas
      : []) {
      const claveUnidad = String(cobertura?.claveUnidad ?? "").trim();
      if (!claveUnidad) continue;

      if (!mapa.has(claveUnidad)) {
        mapa.set(claveUnidad, new Set());
      }

      mapa.get(claveUnidad).add(nombreMuestra);
    }
  }

  return new Map(
    [...mapa.entries()].map(([claveUnidad, valores]) => [
      claveUnidad,
      [...valores].sort((a, b) => a.localeCompare(b, "es")),
    ]),
  );
};

// ====== Resolver el intento vigente de cada recipiente ======
const seleccionarIntentosVigentesInforme = (muestras = []) => {
  const intentosVigentes = new Map();

  for (const muestra of Array.isArray(muestras) ? muestras : []) {
    const clavePlan = String(muestra?.claveMuestraPlan ?? muestra?._id ?? "");
    if (!clavePlan) continue;

    const anterior = intentosVigentes.get(clavePlan);
    const intento = Number(muestra?.numeroIntento ?? 1);
    const intentoAnterior = Number(anterior?.numeroIntento ?? 0);
    const fecha = new Date(muestra?.fechaRegistro ?? muestra?.createdAt ?? 0).getTime();
    const fechaAnterior = new Date(anterior?.fechaRegistro ?? anterior?.createdAt ?? 0).getTime();

    if (!anterior || intento > intentoAnterior ||
        (intento === intentoAnterior && fecha > fechaAnterior)) {
      intentosVigentes.set(clavePlan, muestra);
    }
  }

  return [...intentosVigentes.values()];
};

// ====== Fechas de las muestras vigentes por unidad clínica ======
const construirFechasMuestrasPorUnidad = (muestras = []) => {
  const porUnidad = new Map();
  for (const muestra of muestras) {
    // ====== Nunca reutilizar una muestra reemplazada, rechazada o anulada ======
    if (muestra?.estadoMuestra !== "ACEPTADA") continue;

    const nombreMuestra = String(muestra?.tipoMuestra?.nombreTipoMuestra ?? "").trim();
    // ====== Distinguir el registro simultáneo de una toma histórica ======
    const registroToma = muestra.fechaRegistroRecoleccion
      ? new Date(muestra.fechaRegistroRecoleccion).getTime() : NaN;
    const registroRecepcion = muestra.fechaRecepcion
      ? new Date(muestra.fechaRecepcion).getTime() : NaN;
    const tomaRecepcionUnificada = Number.isFinite(registroToma) &&
      Number.isFinite(registroRecepcion) && registroToma === registroRecepcion;

    const dato = {
      nombreMuestra: nombreMuestra || "Muestra",
      fechaRecoleccion: muestra.fechaRecoleccion ?? null,
      fechaRecepcion: muestra.fechaRecepcion ?? null,
      tomaRecepcionUnificada,
      fechaTomaRecepcion: tomaRecepcionUnificada ? muestra.fechaRecepcion : null,
    };

    // ====== Conservar solo fechas efectivamente registradas ======
    if (!dato.fechaRecoleccion && !dato.fechaRecepcion) continue;

    const claves = new Set((muestra?.coberturas ?? [])
      .map((cobertura) => String(cobertura?.claveUnidad ?? "").trim())
      .filter(Boolean));
    for (const claveUnidad of claves) {
      if (!porUnidad.has(claveUnidad)) porUnidad.set(claveUnidad, []);
      porUnidad.get(claveUnidad).push(dato);
    }
  }

  return porUnidad;
};

// ====== Preparar datos del paciente ======
const construirPaciente = (solicitud) => {
  const origen = solicitud.programacionEmpresaId &&
    typeof solicitud.programacionEmpresaId === "object"
    ? solicitud.programacionEmpresaId
    : solicitud;

  const nombres = String(origen.nombreCliente || solicitud.nombreCliente || "").trim();
  const apellidoPaterno = String(
    origen.apePatCliente || solicitud.apePatCliente || "",
  ).trim();
  const apellidoMaterno = String(
    origen.apeMatCliente || solicitud.apeMatCliente || "",
  ).trim();

  const nombreCompleto = [nombres, apellidoPaterno, apellidoMaterno]
    .filter(Boolean)
    .join(" ")
    .trim();

  const nombreInforme = [apellidoPaterno, apellidoMaterno, nombres]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    pacienteId: String(origen.pacienteId || solicitud.clienteId || "") || null,
    nombres,
    apellidoPaterno,
    apellidoMaterno,
    nombreCompleto,
    nombreInforme,
    hc: origen.hc || solicitud.hc || "",
    documento: [origen.tipoDoc || solicitud.tipoDoc, origen.nroDoc || solicitud.nroDoc]
      .filter(Boolean)
      .join(" "),
    sexo: origen.sexoCliente || solicitud.sexoPaciente || null,
    fechaNacimiento:
      origen.fechaNacimiento || solicitud.fechaNacimientoPaciente || null,
  };
};

// ====== Preparar contexto corporativo ======
const construirEmpresa = (solicitud) => {
  if (solicitud.origenAtencion !== "EMPRESA") {
    return null;
  }

  const programacion =
    solicitud.programacionEmpresaId &&
    typeof solicitud.programacionEmpresaId === "object"
      ? solicitud.programacionEmpresaId
      : null;

  return {
    programacionEmpresaId: String(
      programacion?._id ?? solicitud.programacionEmpresaId ?? "",
    ) || null,
    codProgramacion:
      programacion?.codProgramacion ?? solicitud.codProgramacion ?? null,
    empresaId: String(programacion?.empresaId ?? solicitud.empresaId ?? "") || null,
    rucEmpresa: programacion?.rucEmpresa ?? null,
    razonSocialEmpresa:
      programacion?.razonSocialEmpresa ?? solicitud.razonSocialEmpresa ?? "",
    sede: programacion?.sede ?? null,
    prioridad: programacion?.prioridad ?? null,
    protocoloId: String(solicitud.protocoloId ?? "") || null,
    codProtocolo: solicitud.codProtocolo ?? null,
    nombreProtocolo: solicitud.nombreProtocolo ?? null,
  };
};


// ====== Interpretar plazo comprometido ======
const obtenerDiasRespuesta = (valor) => {
  const texto = String(valor ?? "").trim().replace(",", ".");
  const coincidencia = texto.match(/\d+(?:\.\d+)?/);

  if (!coincidencia) {
    return null;
  }

  const dias = Number(coincidencia[0]);
  return Number.isFinite(dias) && dias >= 0 ? dias : null;
};

const obtenerTipoDiasRespuesta = (valor) => {
  const texto = String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (texto.includes("CALENDARIO")) {
    return "CALENDARIO";
  }

  if (
    texto.includes("LABORABLE") ||
    texto.includes("L-S") ||
    texto.includes("LABORABLES_LS")
  ) {
    return "LABORABLES_LS";
  }

  // ====== Legacy: los tiempos numéricos se consideran días hábiles ======
  return "HABILES";
};

const describirPlazo = (cantidadDias, tipoDias) => {
  if (!Number.isFinite(cantidadDias)) {
    return null;
  }

  const cantidad = Number(cantidadDias);

  if (cantidad === 0) {
    return "Mismo día";
  }

  const etiquetas = {
    HABILES: "hábiles (L-V)",
    LABORABLES_LS: "laborables (L-S)",
    CALENDARIO: "calendario",
  };

  const etiquetaDias = etiquetas[tipoDias] ?? "hábiles (L-V)";

  return `${cantidad} ${cantidad === 1 ? "día" : "días"} ${etiquetaDias}`;
};

const resolverPlazoUnidad = (unidad) => {
  const plazoSnapshot = unidad?.plazoComprometido ?? null;
  const cantidadSnapshot = Number(plazoSnapshot?.cantidadDias);
  const tipoSnapshot = String(plazoSnapshot?.tipoDias ?? "")
    .trim()
    .toUpperCase();

  if (
    Number.isFinite(cantidadSnapshot) &&
    cantidadSnapshot >= 0 &&
    ["HABILES", "LABORABLES_LS", "CALENDARIO"].includes(tipoSnapshot)
  ) {
    return {
      cantidadDias: cantidadSnapshot,
      tipoDias: tipoSnapshot,
      origen: plazoSnapshot?.origen ?? "PROTOCOLO",
      descripcion: describirPlazo(cantidadSnapshot, tipoSnapshot),
    };
  }

  const tiempoRespuesta = String(
    unidad?.snapshotClinico?.tiempoRespuesta ?? "",
  ).trim();

  const cantidadDias = obtenerDiasRespuesta(tiempoRespuesta);

  if (cantidadDias === null) {
    return {
      cantidadDias: null,
      tipoDias: null,
      origen: null,
      descripcion: tiempoRespuesta || null,
    };
  }

  const tipoDiasSnapshot = String(
    unidad?.snapshotClinico?.tipoDiasRespuesta ?? "",
  )
    .trim()
    .toUpperCase();

  const tipoDias = ["HABILES", "LABORABLES_LS", "CALENDARIO"].includes(
    tipoDiasSnapshot,
  )
    ? tipoDiasSnapshot
    : obtenerTipoDiasRespuesta(tiempoRespuesta);

  return {
    cantidadDias,
    tipoDias,
    origen: "MAESTRO_PRUEBA",
    descripcion: describirPlazo(cantidadDias, tipoDias),
  };
};

// ====== Semáforo de plazo en hora Perú ======
const construirSemaforoPlazo = (fechaEstimada, estadoResultado) => {
  if (["LIBERADO", "ANULADO"].includes(estadoResultado)) {
    return { estado: "FINALIZADO", etiqueta: "FINALIZADO" };
  }

  if (!fechaEstimada || !Number.isFinite(fechaEstimada.getTime())) {
    return { estado: "SIN_FECHA", etiqueta: "SIN FECHA" };
  }

  const ahora = new Date();
  const milisegundosRestantes = fechaEstimada.getTime() - ahora.getTime();

  if (milisegundosRestantes < 0) {
    return { estado: "VENCIDO", etiqueta: "VENCIDO" };
  }

  const hoyPeru = obtenerClaveFechaPeru(ahora);
  const vencimientoPeru = obtenerClaveFechaPeru(fechaEstimada);

  if (hoyPeru && vencimientoPeru && hoyPeru === vencimientoPeru) {
    return { estado: "HOY", etiqueta: "VENCE HOY" };
  }

  if (milisegundosRestantes <= 24 * 60 * 60 * 1000) {
    return { estado: "PROXIMO", etiqueta: "PRÓXIMO" };
  }

  return { estado: "EN_PLAZO", etiqueta: "EN PLAZO" };
};

// ====== Tomar el intento vigente por recipiente planificado ======
const obtenerIntentosVigentes = (muestras = []) => {
  const porPlan = new Map();

  for (const muestra of Array.isArray(muestras) ? muestras : []) {
    if (!muestra) {
      continue;
    }

    const clavePlan = String(
      muestra.claveMuestraPlan ?? muestra.codMuestra ?? muestra._id ?? "",
    );

    const actual = porPlan.get(clavePlan);
    const intento = Number(muestra.numeroIntento ?? 1);
    const intentoActual = Number(actual?.numeroIntento ?? 0);

    if (
      !actual ||
      intento > intentoActual ||
      (intento === intentoActual &&
        new Date(muestra.fechaRegistro ?? 0).getTime() >
          new Date(actual.fechaRegistro ?? 0).getTime())
    ) {
      porPlan.set(clavePlan, muestra);
    }
  }

  // Si el último intento fue anulado, no se reutiliza un intento anterior.
  return [...porPlan.values()].filter(
    (muestra) => muestra.estadoMuestra !== "ANULADA",
  );
};

// ====== Muestras relacionadas con una unidad clínica ======
const obtenerMuestrasRelacionadasUnidad = (unidad, muestrasSolicitud = []) =>
  (Array.isArray(muestrasSolicitud) ? muestrasSolicitud : []).filter(
    (muestra) =>
      (Array.isArray(muestra?.coberturas) ? muestra.coberturas : []).some(
        (cobertura) =>
          String(cobertura?.claveUnidad ?? "") ===
          String(unidad?.claveUnidad ?? ""),
      ),
  );

// ====== Fecha real de toma que inicia el compromiso ======
const obtenerFechaBaseTomaUnidad = (unidad, muestrasSolicitud = []) =>
  obtenerFechaBaseTomaUnidadVigente(unidad, muestrasSolicitud);

// ====== Estado de muestra por unidad clínica ======
const construirEstadoMuestraUnidad = (unidad, muestrasSolicitud = []) => {
  if (unidad?.snapshotClinico?.requiereMuestra === false) {
    return {
      estado: "NO_REQUIERE",
      descripcion: "No requiere muestra",
      pendiente: false,
      fechaAceptacion: null,
      motivo: null,
    };
  }

  const relacionadas = obtenerMuestrasRelacionadasUnidad(
    unidad,
    muestrasSolicitud,
  );

  const vigentes = obtenerIntentosVigentes(relacionadas);

  if (!vigentes.length) {
    return {
      estado: "PENDIENTE",
      descripcion: "Muestra pendiente de recolección",
      pendiente: true,
      fechaAceptacion: null,
      motivo: null,
    };
  }

  const rechazadas = vigentes.filter((muestra) => muestra.estadoMuestra === "RECHAZADA");
  if (rechazadas.length) {
    const rechazo = rechazadas
      .slice()
      .sort(
        (a, b) =>
          new Date(b.fechaRechazo ?? b.fechaRegistro ?? 0).getTime() -
          new Date(a.fechaRechazo ?? a.fechaRegistro ?? 0).getTime(),
      )[0];

    return {
      estado: "RECHAZADA",
      descripcion: "Muestra rechazada; requiere nueva toma",
      pendiente: true,
      fechaAceptacion: null,
      motivo: String(rechazo?.motivoRechazo ?? "").trim() || null,
    };
  }

  if (vigentes.some((muestra) => muestra.estadoMuestra === "PENDIENTE")) {
    return {
      estado: "PENDIENTE",
      descripcion: "Muestra pendiente de recolección",
      pendiente: true,
      fechaAceptacion: null,
      motivo: null,
    };
  }

  if (vigentes.some((muestra) => muestra.estadoMuestra === "RECOLECTADA")) {
    return {
      estado: "RECOLECTADA",
      descripcion: "Muestra recolectada, pendiente de recepción",
      pendiente: true,
      fechaAceptacion: null,
      motivo: null,
    };
  }

  if (vigentes.some((muestra) => muestra.estadoMuestra === "RECEPCIONADA")) {
    return {
      estado: "RECEPCIONADA",
      descripcion: "Muestra recepcionada, pendiente de aceptación",
      pendiente: true,
      fechaAceptacion: null,
      motivo: null,
    };
  }

  const aceptadas = vigentes.filter((muestra) => muestra.estadoMuestra === "ACEPTADA");
  if (aceptadas.length === vigentes.length) {
    const fechaAceptacion = aceptadas
      .map((muestra) => muestra.fechaAceptacion)
      .filter(Boolean)
      .map((fecha) => new Date(fecha))
      .filter((fecha) => Number.isFinite(fecha.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      estado: "ACEPTADA",
      descripcion: "Muestra aceptada",
      pendiente: false,
      fechaAceptacion,
      motivo: null,
    };
  }

  return {
    estado: "PENDIENTE",
    descripcion: "Muestra pendiente",
    pendiente: true,
    fechaAceptacion: null,
    motivo: null,
  };
};

// ====== Seguimiento visible para Recepción / Informes ======
const construirPruebasSeguimiento = (
  solicitud,
  resultados = [],
  muestras = [],
  diasNoLaborables = new Set(),
) => {
  const porUnidad = new Map(
    (Array.isArray(resultados) ? resultados : []).map((resultado) => [
      String(resultado?.claveUnidad ?? ""),
      resultado,
    ]),
  );

  return (Array.isArray(solicitud?.unidadesLaboratorio)
    ? solicitud.unidadesLaboratorio
    : [])
    .filter((unidad) => unidad?.estado !== "ANULADO")
    .map((unidad) => {
      const resultado = porUnidad.get(String(unidad?.claveUnidad ?? "")) ?? null;
      const estadoResultado = resultado?.estadoResultado ?? "PENDIENTE";
      const muestra = construirEstadoMuestraUnidad(unidad, muestras);
      const plazo = resolverPlazoUnidad(unidad);
      const tiempoRespuesta = plazo.descripcion;
      const diasRespuesta = plazo.cantidadDias;

      const fechaBasePlazo =
        unidad?.snapshotClinico?.requiereMuestra === false
          ? solicitud?.fechaAtencionArea ?? solicitud?.fechaEmision ?? null
          : obtenerFechaBaseTomaUnidad(unidad, muestras);

      const fechaCongelada = unidad?.plazoComprometido?.fechaEntregaComprometida
        ? new Date(unidad.plazoComprometido.fechaEntregaComprometida)
        : null;

      const fechaCongeladaValida =
        fechaCongelada && Number.isFinite(fechaCongelada.getTime())
          ? fechaCongelada
          : null;

      const fechaEstimada =
        fechaCongeladaValida ??
        (diasRespuesta !== null && plazo.tipoDias && fechaBasePlazo
          ? sumarDiasCompromiso(
              fechaBasePlazo,
              diasRespuesta,
              plazo.tipoDias,
              diasNoLaborables,
            )
          : null);

      const semaforoPlazo = construirSemaforoPlazo(
        fechaEstimada,
        estadoResultado,
      );
      const fueraPlazo = semaforoPlazo.estado === "VENCIDO";

      let situacion = "";

      if (muestra.pendiente) {
        situacion = muestra.descripcion;
      } else {
        switch (estadoResultado) {
          case "EN PROCESO":
            situacion = "Resultado en procesamiento";
            break;
          case "COMPLETO":
            situacion = "Resultado registrado, pendiente de validación";
            break;
          case "VALIDADO":
            situacion = "Resultado validado, pendiente de liberación";
            break;
          case "LIBERADO":
            situacion = "Resultado liberado";
            break;
          case "ANULADO":
            situacion = "Resultado anulado";
            break;
          default:
            situacion = "Pendiente de registro de resultados";
            break;
        }
      }

      if (fueraPlazo) {
        situacion = `${situacion}. Plazo configurado vencido`;
      }

      return {
        claveUnidad: unidad?.claveUnidad ?? "",
        codPruebaLab:
          resultado?.codPruebaLab ??
          unidad?.snapshotClinico?.codPruebaLab ??
          unidad?.codExamen ??
          "",
        nombrePruebaLab:
          resultado?.nombrePruebaLab ??
          unidad?.snapshotClinico?.nombrePruebaLab ??
          unidad?.nombreExamen ??
          "",
        numeroInstancia:
          resultado?.numeroInstancia ?? unidad?.numeroInstancia ?? 1,
        etiquetaInstancia:
          resultado?.etiquetaInstancia ?? unidad?.etiquetaInstancia ?? null,
        estadoResultado,
        fechaValidacion: resultado?.fechaValidacion ?? null,
        fechaLiberacion: resultado?.fechaLiberacion ?? null,
        tiempoRespuesta: tiempoRespuesta || null,
        diasRespuesta,
        fechaEstimada,
        compromisoCongelado: Boolean(fechaCongeladaValida),
        estadoPlazo: semaforoPlazo.estado,
        etiquetaPlazo: semaforoPlazo.etiqueta,
        fueraPlazo,
        situacion,
        muestra,
      };
    });
};

const construirResumenSeguimiento = (solicitud, resultados, pruebas) => {
  const base = calcularResumen(solicitud, resultados);
  const activas = Array.isArray(pruebas) ? pruebas : [];
  const pendientesLiberacion = activas.filter(
    (prueba) => !["LIBERADO", "ANULADO"].includes(prueba.estadoResultado),
  );

  const enPlazo = pendientesLiberacion.filter(
    (prueba) => prueba.estadoPlazo === "EN_PLAZO",
  ).length;
  const proximosVencer = pendientesLiberacion.filter(
    (prueba) => prueba.estadoPlazo === "PROXIMO",
  ).length;
  const vencenHoy = pendientesLiberacion.filter(
    (prueba) => prueba.estadoPlazo === "HOY",
  ).length;
  const vencidos = pendientesLiberacion.filter(
    (prueba) => prueba.estadoPlazo === "VENCIDO",
  ).length;

  const semaforoPlazo = vencidos > 0
    ? "VENCIDO"
    : vencenHoy > 0
      ? "HOY"
      : proximosVencer > 0
        ? "PROXIMO"
        : enPlazo > 0
          ? "EN_PLAZO"
          : pendientesLiberacion.length > 0
            ? "SIN_FECHA"
            : "FINALIZADO";

  return {
    ...base,
    pendientesMuestra: activas.filter((prueba) => prueba?.muestra?.pendiente).length,
    enProceso: activas.filter((prueba) => prueba.estadoResultado === "EN PROCESO").length,
    completos: activas.filter((prueba) => prueba.estadoResultado === "COMPLETO").length,
    validados: activas.filter((prueba) => prueba.estadoResultado === "VALIDADO").length,
    enPlazo,
    proximosVencer,
    vencenHoy,
    vencidos,
    fueraPlazo: vencidos,
    semaforoPlazo,
  };
};

// ====== Calcular disponibilidad, sin confundirla con entrega ======
const calcularResumen = (solicitud, resultados) => {
  const activos = resultados.filter((r) => r.estadoResultado !== "ANULADO");
  const liberados = activos.filter((r) => r.estadoResultado === "LIBERADO");
  const unidadesActivas = (solicitud.unidadesLaboratorio || []).filter(
    (u) => u.estado !== "ANULADO",
  ).length;
  const total = Math.max(unidadesActivas, activos.length);

  return {
    totalPruebas: total,
    liberados: liberados.length,
    pendientes: Math.max(0, total - liberados.length),
    tipoDisponibilidad: liberados.length === 0
      ? "SIN_VIGENTES"
      : liberados.length === total ? "COMPLETA" : "PARCIAL",
  };
};

// ====== Consulta de solicitudes con resultados entregables ======
const obtenerBandejaEntregaResultados = async (req, res = response) => {
  try {
    const {
      fechaInicio,
      fechaFin,
      terminoBusqueda = "",
      empresaId = "",
      soloVencidos = "false",
    } = req.query;

    const modoSoloVencidos = ["1", "true", "si", "sí"].includes(
      String(soloVencidos ?? "").trim().toLocaleLowerCase("es"),
    );

    let desde = null;
    let hasta = null;

    if (!modoSoloVencidos) {
      if (!fechaInicio || !fechaFin) {
        return res.status(400).json({ ok: false, msg: "Debe indicar ambas fechas" });
      }

      // ====== Interpretar el rango como día calendario de Perú ======
      desde = construirLimiteFechaOperativa(fechaInicio, false);
      hasta = construirLimiteFechaOperativa(fechaFin, true);

      if (!desde || !hasta || desde > hasta) {
        return res.status(400).json({
          ok: false,
          msg: "Rango de fechas inválido",
        });
      }
    }

    const empresaFiltro = String(empresaId ?? "").trim();

    if (empresaFiltro && !mongoose.isValidObjectId(empresaFiltro)) {
      return res.status(400).json({ ok: false, msg: "Empresa inválida" });
    }

    const filtroSolicitudes = {
      tipo: "Laboratorio",
      ...(modoSoloVencidos
        ? { estado: { $nin: ["ANULADO", "ATENDIDO"] } }
        : { fechaEmision: { $gte: desde, $lte: hasta } }),
      ...(empresaFiltro
        ? {
            origenAtencion: "EMPRESA",
            empresaId: empresaFiltro,
          }
        : {}),
    };

    const solicitudes = await SolicitudAtencion.find(filtroSolicitudes)
      .select([
        "_id",
        "codSolicitud",
        "codigoLaboratorio",
        "origenAtencion",
        "estado",
        "fechaEmision",
        "fechaAtencionArea",
        "unidadesLaboratorio",
        "hc",
        "clienteId",
        "tipoDoc",
        "nroDoc",
        "nombreCliente",
        "apePatCliente",
        "apeMatCliente",
        "sexoPaciente",
        "fechaNacimientoPaciente",
        "programacionEmpresaId",
        "codProgramacion",
        "empresaId",
        "razonSocialEmpresa",
        "protocoloId",
        "codProtocolo",
        "nombreProtocolo",
      ].join(" "))
      .populate(
        "programacionEmpresaId",
        "_id codProgramacion empresaId rucEmpresa razonSocialEmpresa hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento sede prioridad",
      )
      .sort({ fechaEmision: -1 })
      .lean();

    if (!solicitudes.length) {
      return res.json({ ok: true, bandeja: [], total: 0 });
    }

    const idsSolicitudes = solicitudes.map((s) => s._id);
    const [entregasPrevias, resultados, muestras, diasNoLaborablesActivos] =
      await Promise.all([
        modoSoloVencidos
          ? Promise.resolve([])
          : EntregaResultado.distinct("solicitudAtencionId", {
              solicitudAtencionId: { $in: idsSolicitudes },
            }),
        ResultadoLaboratorio.find({
          solicitudAtencionId: { $in: idsSolicitudes },
        })
          .select(
            "solicitudAtencionId claveUnidad codPruebaLab nombrePruebaLab numeroInstancia etiquetaInstancia estadoResultado fechaValidacion fechaLiberacion",
          )
          .lean(),
        MuestraLaboratorio.find({
          solicitudAtencionId: { $in: idsSolicitudes },
        })
          .select(
            "solicitudAtencionId claveMuestraPlan codMuestra numeroIntento estadoMuestra coberturas.claveUnidad fechaRegistro createdAt fechaRecoleccion fechaRecepcion fechaAceptacion fechaRechazo motivoRechazo motivoAnulacion",
          )
          .lean(),
        DiaNoLaborable.find({
          estadoDiaNoLaborable: "ACTIVO",
        })
          .select("fecha")
          .lean(),
      ]);

    const conEntregasPrevias = new Set(entregasPrevias.map(String));

    const porSolicitud = new Map();
    for (const resultado of resultados) {
      const clave = String(resultado.solicitudAtencionId);
      if (!porSolicitud.has(clave)) porSolicitud.set(clave, []);
      porSolicitud.get(clave).push(resultado);
    }

    const muestrasPorSolicitud = new Map();
    for (const muestra of muestras) {
      const clave = String(muestra.solicitudAtencionId);
      if (!muestrasPorSolicitud.has(clave)) muestrasPorSolicitud.set(clave, []);
      muestrasPorSolicitud.get(clave).push(muestra);
    }

    // ====== Calendario de días no laborables ======

    const diasNoLaborables = new Set(
      (Array.isArray(diasNoLaborablesActivos) ? diasNoLaborablesActivos : [])
        .map((dia) => String(dia?.fecha ?? "").trim())
        .filter(Boolean),
    );

    const filtro = String(terminoBusqueda).trim().toLocaleLowerCase("es");
    const bandeja = solicitudes.flatMap((solicitud) => {
      const claveSolicitud = String(solicitud._id);
      const resultadosSolicitud = porSolicitud.get(claveSolicitud) || [];
      const pruebas = construirPruebasSeguimiento(
        solicitud,
        resultadosSolicitud,
        muestrasPorSolicitud.get(claveSolicitud) || [],
        diasNoLaborables,
      );
      const resumen = construirResumenSeguimiento(
        solicitud,
        resultadosSolicitud,
        pruebas,
      );
      const tieneHistorial = conEntregasPrevias.has(claveSolicitud);

      if (!resumen.totalPruebas && !tieneHistorial) {
        return [];
      }

      if (modoSoloVencidos && (resumen.vencidos ?? 0) <= 0) {
        return [];
      }

      const paciente = construirPaciente(solicitud);
      const empresa = construirEmpresa(solicitud);
      const fila = {
        solicitudAtencionId: claveSolicitud,
        codSolicitud: solicitud.codSolicitud,
        codigoLaboratorio: solicitud.codigoLaboratorio || "",
        fechaEmision: solicitud.fechaEmision,
        origenAtencion: solicitud.origenAtencion,
        paciente,
        empresa,
        resumen,
        pruebas,
        tieneHistorial,
      };
      if (filtro && ![
        fila.codSolicitud,
        fila.codigoLaboratorio,
        paciente.nombreCompleto,
        paciente.documento,
        paciente.hc,
        empresa?.codProgramacion,
        empresa?.razonSocialEmpresa,
        empresa?.rucEmpresa,
        empresa?.codProtocolo,
        empresa?.nombreProtocolo,
        empresa?.sede,
      ].some((dato) => String(dato || "").toLocaleLowerCase("es").includes(filtro))) {
        return [];
      }
      return [fila];
    });

    const bandejaOrdenada = modoSoloVencidos
      ? bandeja.sort((a, b) => {
          const primeraA = (a.pruebas ?? [])
            .filter((prueba) => prueba.estadoPlazo === "VENCIDO")
            .map((prueba) => new Date(prueba.fechaEstimada ?? 0).getTime())
            .filter(Number.isFinite)
            .sort((x, y) => x - y)[0] ?? Number.MAX_SAFE_INTEGER;
          const primeraB = (b.pruebas ?? [])
            .filter((prueba) => prueba.estadoPlazo === "VENCIDO")
            .map((prueba) => new Date(prueba.fechaEstimada ?? 0).getTime())
            .filter(Number.isFinite)
            .sort((x, y) => x - y)[0] ?? Number.MAX_SAFE_INTEGER;
          return primeraA - primeraB;
        })
      : bandeja;

    return res.json({
      ok: true,
      bandeja: bandejaOrdenada,
      total: bandejaOrdenada.length,
      modoSoloVencidos,
    });
  } catch (error) {
    console.error("Error de bandeja de entrega:", error);
    return res.status(500).json({ ok: false, msg: "No se pudo consultar la bandeja de entregas" });
  }
};

// ====== Informe exacto de un despacho público ======
const construirInformeEntregableSeleccionado = async ({
  solicitudAtencionId,
  resultadosEsperados = [],
}) => {
  if (!mongoose.isValidObjectId(solicitudAtencionId)) {
    const error = new Error("El informe solicitado no está disponible");
    error.codigo = "INFORME_REEMPLAZADO";
    throw error;
  }

  const esperados = (Array.isArray(resultadosEsperados) ? resultadosEsperados : [])
    .map((resultado) => ({
      resultadoLaboratorioId: String(resultado?.resultadoLaboratorioId ?? ""),
      versionResultado: Number(resultado?.versionResultado ?? 1),
    }))
    .filter((resultado) => mongoose.isValidObjectId(resultado.resultadoLaboratorioId));

  if (!esperados.length) {
    const error = new Error("El informe solicitado no contiene resultados disponibles");
    error.codigo = "INFORME_REEMPLAZADO";
    throw error;
  }

  const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
    .select([
      "codSolicitud",
      "codigoLaboratorio",
      "origenAtencion",
      "fechaEmision",
      "fechaAtencionArea",
      "unidadesLaboratorio",
      "hc",
      "clienteId",
      "tipoDoc",
      "nroDoc",
      "nombreCliente",
      "apePatCliente",
      "apeMatCliente",
      "sexoPaciente",
      "fechaNacimientoPaciente",
      "programacionEmpresaId",
      "codProgramacion",
      "empresaId",
      "razonSocialEmpresa",
      "protocoloId",
      "codProtocolo",
      "nombreProtocolo",
      "tipo",
    ].join(" "))
    .populate(
      "programacionEmpresaId",
      "_id codProgramacion empresaId rucEmpresa razonSocialEmpresa hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento sede prioridad",
    )
    .lean();

  if (!solicitud || solicitud.tipo !== "Laboratorio") {
    const error = new Error("El informe solicitado ya no está disponible");
    error.codigo = "INFORME_REEMPLAZADO";
    throw error;
  }

  const ids = esperados.map((resultado) => resultado.resultadoLaboratorioId);
  const liberados = await ResultadoLaboratorio.find({
    solicitudAtencionId,
    _id: { $in: ids },
    estadoResultado: "LIBERADO",
  })
    .select(
      "_id claveUnidad codPruebaLab nombrePruebaLab numeroInstancia etiquetaInstancia versionResultado fechaValidacion fechaLiberacion usuarioLiberacion observacionGeneral resultadosItems",
    )
    .sort({ numeroInstancia: 1, createdAt: 1 })
    .lean();

  if (liberados.length !== esperados.length) {
    const error = new Error(
      "Este informe fue reemplazado o alguno de sus resultados dejó de estar liberado. Solicite el enlace actualizado.",
    );
    error.codigo = "INFORME_REEMPLAZADO";
    throw error;
  }

  const esperadoPorId = new Map(
    esperados.map((resultado) => [resultado.resultadoLaboratorioId, resultado.versionResultado]),
  );

  const versionCambio = liberados.some(
    (resultado) =>
      Number(resultado.versionResultado ?? 1) !==
      Number(esperadoPorId.get(String(resultado._id)) ?? 1),
  );

  if (versionCambio) {
    const error = new Error(
      "Este informe fue reemplazado por una versión posterior. Solicite el enlace actualizado.",
    );
    error.codigo = "INFORME_REEMPLAZADO";
    throw error;
  }

  const muestrasSolicitud = await MuestraLaboratorio.find({ solicitudAtencionId })
    .select("claveMuestraPlan numeroIntento estadoMuestra fechaRegistro createdAt tipoMuestra coberturas.claveUnidad fechaRecoleccion fechaRegistroRecoleccion fechaRecepcion")
    .lean();

  const intentosVigentes = seleccionarIntentosVigentesInforme(muestrasSolicitud);
  const muestrasAceptadas = intentosVigentes.filter((muestra) => muestra.estadoMuestra === "ACEPTADA");
  const muestrasPorUnidad = construirMuestrasPorUnidad(muestrasAceptadas);
  const fechasMuestrasPorUnidad = construirFechasMuestrasPorUnidad(muestrasAceptadas);
  const resultados = liberados.map((resultado) => ({
    _id: String(resultado._id),
    codPruebaLab: resultado.codPruebaLab,
    nombrePruebaLab: resultado.nombrePruebaLab,
    numeroInstancia: resultado.numeroInstancia,
    etiquetaInstancia: resultado.etiquetaInstancia,
    versionResultado: resultado.versionResultado || 1,
    fechaValidacion: resultado.fechaValidacion ?? null,
    fechaLiberacion: resultado.fechaLiberacion,
    usuarioLiberacion: resultado.usuarioLiberacion,
    observacionGeneral: resultado.observacionGeneral,
    muestras: muestrasPorUnidad.get(String(resultado.claveUnidad ?? "")) ?? [],
    fechasMuestras: fechasMuestrasPorUnidad.get(String(resultado.claveUnidad ?? "")) ?? [],
    items: obtenerItemsEntregables(resultado.resultadosItems).map((item) => {
      const metadata = obtenerMetadataItemInforme({ solicitud, resultado, item });

      return {
        nombreInforme: item.nombreInforme,
        codItemLab: item.codItemLab,
        itemLabId: item.itemLabId ? String(item.itemLabId) : null,
        tipoResultado: metadata.tipoResultado,
        metodo: metadata.metodo,
        nombreGrupo: metadata.nombreGrupo,
        comentarioReferenciaGrupo: metadata.comentarioReferenciaGrupo,
        mostrarReferenciaInforme: metadata.mostrarReferenciaInforme,
        hallazgosNormales: metadata.hallazgosNormales,
        valor: item.valor,
        unidadesRef: item.unidadesRef,
        observacion: item.observacion,
        evaluacionReferencia: item.evaluacionReferencia,
        referenciasConfiguradas: metadata.referenciasConfiguradas,
        alertasDetectadas: item.alertasDetectadas,
        ordenGrupo: item.ordenGrupo,
        ordenItem: item.ordenItem,
      };
    }),
  }));

  return {
    ok: true,
    solicitud: {
      solicitudAtencionId: String(solicitud._id),
      codSolicitud: solicitud.codSolicitud,
      codigoLaboratorio: solicitud.codigoLaboratorio,
      fechaEmision: solicitud.fechaEmision,
      fechaAtencion: solicitud.fechaAtencionArea ?? null,
      origenAtencion: solicitud.origenAtencion,
      paciente: construirPaciente(solicitud),
      empresa: construirEmpresa(solicitud),
    },
    resumen: {
      totalPruebas: resultados.length,
      liberados: resultados.length,
      pendientes: 0,
      tipoDisponibilidad: "COMPLETA",
    },
    resultados,
    entregas: [],
  };
};

// ====== Informe vigente con solo pruebas LIBERADAS ======
const obtenerInformeEntregable = async (req, res = response) => {
  try {
    const { solicitudAtencionId } = req.params;
    if (!mongoose.isValidObjectId(solicitudAtencionId)) {
      return res.status(400).json({ ok: false, msg: "Id de solicitud inválido" });
    }
    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .select([
        "codSolicitud",
        "codigoLaboratorio",
        "origenAtencion",
        "fechaEmision",
        "fechaAtencionArea",
        "unidadesLaboratorio",
        "hc",
        "clienteId",
        "tipoDoc",
        "nroDoc",
        "nombreCliente",
        "apePatCliente",
        "apeMatCliente",
        "sexoPaciente",
        "fechaNacimientoPaciente",
        "programacionEmpresaId",
        "codProgramacion",
        "empresaId",
        "razonSocialEmpresa",
        "protocoloId",
        "codProtocolo",
        "nombreProtocolo",
        "tipo",
      ].join(" "))
      .populate(
        "programacionEmpresaId",
        "_id codProgramacion empresaId rucEmpresa razonSocialEmpresa hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento sede prioridad",
      )
      .lean();
    if (!solicitud || solicitud.tipo !== "Laboratorio") {
      return res.status(404).json({ ok: false, msg: "Solicitud no encontrada" });
    }
    const todos = await ResultadoLaboratorio.find({ solicitudAtencionId })
      .select("estadoResultado")
      .lean();
    const resumen = calcularResumen(solicitud, todos);
    const liberados = await ResultadoLaboratorio.find({
      solicitudAtencionId,
      estadoResultado: "LIBERADO",
    })
      .select("_id claveUnidad codPruebaLab nombrePruebaLab numeroInstancia etiquetaInstancia versionResultado fechaValidacion fechaLiberacion usuarioLiberacion observacionGeneral resultadosItems")
      .sort({ numeroInstancia: 1, createdAt: 1 })
      .lean();

    const muestrasSolicitud = await MuestraLaboratorio.find({ solicitudAtencionId })
      .select("claveMuestraPlan numeroIntento estadoMuestra fechaRegistro createdAt tipoMuestra coberturas.claveUnidad fechaRecoleccion fechaRegistroRecoleccion fechaRecepcion")
      .lean();

    const intentosVigentes = seleccionarIntentosVigentesInforme(muestrasSolicitud);
    const muestrasAceptadas = intentosVigentes.filter((muestra) => muestra.estadoMuestra === "ACEPTADA");
    const muestrasPorUnidad = construirMuestrasPorUnidad(muestrasAceptadas);
    const fechasMuestrasPorUnidad = construirFechasMuestrasPorUnidad(muestrasAceptadas);

    // ====== No enviar información interna del laboratorio ======
    const resultados = liberados.map((resultado) => ({
      _id: String(resultado._id),
      codPruebaLab: resultado.codPruebaLab,
      nombrePruebaLab: resultado.nombrePruebaLab,
      numeroInstancia: resultado.numeroInstancia,
      etiquetaInstancia: resultado.etiquetaInstancia,
      versionResultado: resultado.versionResultado || 1,
      fechaValidacion: resultado.fechaValidacion ?? null,
      fechaLiberacion: resultado.fechaLiberacion,
      usuarioLiberacion: resultado.usuarioLiberacion,
      observacionGeneral: resultado.observacionGeneral,
      muestras: muestrasPorUnidad.get(String(resultado.claveUnidad ?? "")) ?? [],
    fechasMuestras: fechasMuestrasPorUnidad.get(String(resultado.claveUnidad ?? "")) ?? [],
      items: obtenerItemsEntregables(resultado.resultadosItems).map((item) => {
        const metadata = obtenerMetadataItemInforme({
          solicitud,
          resultado,
          item,
        });

        return {
          nombreInforme: item.nombreInforme,
          codItemLab: item.codItemLab,
        itemLabId: item.itemLabId ? String(item.itemLabId) : null,
          tipoResultado: metadata.tipoResultado,
          metodo: metadata.metodo,
          nombreGrupo: metadata.nombreGrupo,
          comentarioReferenciaGrupo: metadata.comentarioReferenciaGrupo,
          mostrarReferenciaInforme: metadata.mostrarReferenciaInforme,
          hallazgosNormales: metadata.hallazgosNormales,
          valor: item.valor,
          unidadesRef: item.unidadesRef,
          observacion: item.observacion,
          evaluacionReferencia: item.evaluacionReferencia,
          referenciasConfiguradas: metadata.referenciasConfiguradas,
          alertasDetectadas: item.alertasDetectadas,
          ordenGrupo: item.ordenGrupo,
          ordenItem: item.ordenItem,
        };
      }),
    }));
    const entregas = await EntregaResultado.find({ solicitudAtencionId })
      .select("tipoEntrega medio receptorNombre receptorCorreo receptorTelefono fechaEntrega usuarioEntrega resultados despachoResultadoId")
      .sort({ fechaEntrega: -1 })
      .limit(50)
      .lean();

    return res.json({
      ok: true,
      solicitud: {
        solicitudAtencionId: String(solicitud._id),
        codSolicitud: solicitud.codSolicitud,
        codigoLaboratorio: solicitud.codigoLaboratorio,
        fechaEmision: solicitud.fechaEmision,
        origenAtencion: solicitud.origenAtencion,
        paciente: construirPaciente(solicitud),
        empresa: construirEmpresa(solicitud),
      },
      resumen,
      resultados,
      entregas: entregas.map((entrega) => ({
        _id: String(entrega._id),
        tipoEntrega: entrega.tipoEntrega,
        medio: entrega.medio,
        receptorNombre: entrega.receptorNombre,
        receptorCorreo: entrega.receptorCorreo ?? null,
        receptorTelefono: entrega.receptorTelefono ?? null,
        despachoResultadoId: entrega.despachoResultadoId
          ? String(entrega.despachoResultadoId)
          : null,
        fechaEntrega: entrega.fechaEntrega,
        usuarioEntrega: entrega.usuarioEntrega,
        pruebasEntregadas: entrega.resultados.length,
      })),
    });
  } catch (error) {
    console.error("Error de informe entregable:", error);
    return res.status(500).json({ ok: false, msg: "No se pudo obtener el informe" });
  }
};

// ====== Registrar entrega sin alterar estados clínicos ======
const registrarEntregaResultados = async (req, res = response) => {
  try {
    const { solicitudAtencionId } = req.params;
    const {
      resultadosIds,
      receptorNombre = "",
      medio = "PRESENCIAL",
      observacion = "",
    } = req.body || {};

    if (!mongoose.isValidObjectId(solicitudAtencionId)) {
      return res.status(400).json({ ok: false, msg: "Solicitud inválida" });
    }

    if (
      !Array.isArray(resultadosIds) ||
      !resultadosIds.length ||
      resultadosIds.length > 100 ||
      !resultadosIds.every((id) => mongoose.isValidObjectId(id)) ||
      String(receptorNombre || "").length > 180 ||
      !["PRESENCIAL", "WHATSAPP", "CORREO", "OTRO"].includes(medio) ||
      String(observacion || "").length > 1000
    ) {
      return res.status(400).json({
        ok: false,
        msg: "Datos de entrega incompletos o inválidos",
      });
    }
    if (["CORREO", "WHATSAPP"].includes(medio)) {
      return res.status(409).json({
        ok: false,
        codigo: "CANAL_AUTOMATIZADO",
        msg: `${medio} debe procesarse mediante el motor automático de despacho`,
      });
    }

    const ids = [...new Set(resultadosIds.map(String))];
    if (ids.length !== resultadosIds.length) {
      return res.status(400).json({ ok: false, msg: "No se permiten pruebas duplicadas" });
    }

    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .populate(
        "programacionEmpresaId",
        "hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente",
      )
      .lean();

    if (!solicitud || solicitud.tipo !== "Laboratorio") {
      return res.status(404).json({ ok: false, msg: "Solicitud no encontrada" });
    }
    if (solicitud.estado === "ANULADO") {
      return res.status(409).json({
        ok: false,
        codigo: "SOLICITUD_ANULADA",
        msg: "No se pueden registrar nuevas entregas de una solicitud anulada",
      });
    }
    const [todos, liberados] = await Promise.all([
      ResultadoLaboratorio.find({ solicitudAtencionId })
        .select("estadoResultado")
        .lean(),
      ResultadoLaboratorio.find({
        solicitudAtencionId,
        _id: { $in: ids },
        estadoResultado: "LIBERADO",
      }).lean(),
    ]);
    if (liberados.length !== ids.length) {
      return res.status(409).json({
        ok: false,
        codigo: "RESULTADO_NO_LIBERADO",
        msg: "Algún resultado seleccionado ya no está liberado. Actualice el informe.",
      });
    }
    const resumen = calcularResumen(solicitud, todos);
    const tipoEntrega = ids.length === resumen.totalPruebas &&
      resumen.totalPruebas > 0 ? "FINAL" : "PARCIAL";

    // ====== Congelar versión de los resultados entregados ======
    const snapshots = liberados.map((resultado) => ({
      resultadoLaboratorioId: String(resultado._id),
      codPruebaLab: resultado.codPruebaLab,
      nombrePruebaLab: resultado.nombrePruebaLab,
      versionResultado: resultado.versionResultado || 1,
      fechaLiberacion: resultado.fechaLiberacion,
      resultadosItems: obtenerItemsEntregables(resultado.resultadosItems).map((item) => ({
        nombreInforme: item.nombreInforme,
        valor: item.valor,
        unidadesRef: item.unidadesRef,
        evaluacionReferencia: item.evaluacionReferencia,
        alertasDetectadas: item.alertasDetectadas,
      })),
    }));

    const receptorFinal =
      String(receptorNombre || "").trim() ||
      construirPaciente(solicitud).nombreCompleto ||
      "PACIENTE";

    const entrega = await EntregaResultado.create({
      solicitudAtencionId,
      codSolicitud: solicitud.codSolicitud,
      codigoLaboratorio: solicitud.codigoLaboratorio || "",
      tipoEntrega,
      medio,
      receptorNombre: receptorFinal,
      observacion: String(observacion || "").trim(),
      resultados: snapshots,
      totalPruebasActivas: resumen.totalPruebas,
      entregadoPor: req.user.uid,
      usuarioEntrega: req.user.nombreUsuario,
    });
    return res.status(201).json({
      ok: true,
      msg: `Entrega ${tipoEntrega.toLowerCase()} registrada correctamente`,
      entregaId: entrega._id,
      tipoEntrega,
      pruebasEntregadas: snapshots.length,
      fechaEntrega: entrega.fechaEntrega,
    });
  } catch (error) {
    console.error("Error al registrar entrega:", error);
    return res.status(500).json({ ok: false, msg: "No se pudo registrar la entrega" });
  }
};

// ====== Recuperar firmas históricas solo para pruebas liberadas ======
const obtenerFirmasInformePdf = async (req, res = response) => {
  try {
    const solicitudAtencionId = String(req.params.solicitudAtencionId ?? '');
    const seleccion = req.body?.resultados;
    const ids = Array.isArray(seleccion) ? seleccion.map((item) => item?._id) : null;
    if (!mongoose.isValidObjectId(solicitudAtencionId) || !Array.isArray(ids) ||
        ids.length < 1 || ids.length > 100 ||
        new Set(ids.map(String)).size !== ids.length ||
        !ids.every((id) => mongoose.isValidObjectId(id)) ||
        !seleccion.every((item) => Number.isSafeInteger(Number(item?.versionResultado)) && Number(item.versionResultado) >= 1)) {
      return res.status(400).json({ ok: false, msg: 'Selección de resultados inválida' });
    }

    const resultados = await ResultadoLaboratorio.find({
      _id: { $in: ids }, solicitudAtencionId, estadoResultado: 'LIBERADO',
    }).select('_id codPruebaLab nombrePruebaLab versionResultado responsableInforme').lean();
    if (resultados.length !== ids.length) {
      return res.status(409).json({ ok: false,
        msg: 'Alguna prueba dejó de estar liberada; vuelva a cargar el informe' });
    }

    // ====== Impedir firmas para información desactualizada ======
    const versionesEsperadas = new Map(seleccion.map((item) => [String(item._id), Number(item.versionResultado)]));
    if (resultados.some((item) => Number(item.versionResultado ?? 1) !== versionesEsperadas.get(String(item._id)))) {
      return res.status(409).json({ ok: false, codigo: 'RESULTADOS_DESACTUALIZADOS',
        msg: 'El informe cambió durante la generación; vuelva a abrirlo' });
    }

    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .select('estado tipo').lean();
    if (!solicitud || solicitud.tipo !== 'Laboratorio' || solicitud.estado === 'ANULADO') {
      return res.status(409).json({ ok: false, msg: 'El informe no está disponible' });
    }

    const firmasPorArchivo = new Map();
    const sinFirma = [];
    for (const resultado of resultados) {
      const info = resultado.responsableInforme;
      if (!info?.firmaArchivoId || !info?.hashFirma) {
        sinFirma.push(resultado.codPruebaLab);
        continue;
      }
      // ====== No mezclar presentaciones históricas aunque compartan PNG ======
      const clavePresentacion = JSON.stringify({
        archivoId: String(info.firmaArchivoId), perfilId: info.perfilId ?? 'legacy',
        tratamiento: info.tratamiento ?? '', profesion: info.profesion ?? '',
        especialidad: info.especialidad ?? '', colegiatura: info.nroColegiatura ?? '',
        rne: info.rne ?? '', siglaColegiatura: info.siglaColegiatura ?? '',
        siglaEspecialidad: info.siglaEspecialidad ?? '',
        mostrarProfesion: info.mostrarProfesion !== false,
        mostrarEspecialidad: info.mostrarEspecialidad !== false,
        mostrarColegiatura: info.mostrarColegiatura !== false,
        mostrarRne: info.mostrarRne !== false,
      });
      if (!firmasPorArchivo.has(clavePresentacion)) {
        firmasPorArchivo.set(clavePresentacion, { info, pruebas: [] });
      }
      firmasPorArchivo.get(clavePresentacion).pruebas.push(resultado.codPruebaLab);
    }

    const firmas = [];
    for (const dato of firmasPorArchivo.values()) {
      const registro = await FirmaProfesionalLaboratorioVersion.findById(dato.info.firmaArchivoId)
        .select('+imagen hashSha256 recursoHumanoId');
      const png = obtenerBufferFirma(registro?.imagen);
      const hash = png ? crypto.createHash('sha256').update(png).digest('hex') : null;
      if (!registro || !esPng(png) || hash !== registro.hashSha256 ||
          hash !== dato.info.hashFirma ||
          String(registro.recursoHumanoId) !== String(dato.info.recursoHumanoId)) {
        return res.status(409).json({ ok: false, codigo: 'FIRMA_NO_DISPONIBLE',
          msg: 'Una firma histórica no pudo verificarse; no se generará un PDF incompleto' });
      }
      firmas.push({
        recursoHumanoId: String(dato.info.recursoHumanoId),
        nombreCompleto: dato.info.nombreCompleto,
        tratamiento: dato.info.tratamiento ?? '',
        perfilId: dato.info.perfilId ?? 'legacy',
        siglaColegiatura: dato.info.siglaColegiatura ?? 'Colegiatura',
        siglaEspecialidad: dato.info.siglaEspecialidad ?? 'RNE',
        mostrarProfesion: dato.info.mostrarProfesion !== false,
        mostrarEspecialidad: dato.info.mostrarEspecialidad !== false,
        mostrarColegiatura: dato.info.mostrarColegiatura !== false,
        mostrarRne: dato.info.mostrarRne !== false,
        nombres: dato.info.nombres || null,
        apellidoPaterno: dato.info.apellidoPaterno || null,
        apellidoMaterno: dato.info.apellidoMaterno || null,
        sexo: dato.info.sexo || null,
        profesion: dato.info.profesion,
        especialidad: dato.info.especialidad || null,
        nroColegiatura: dato.info.nroColegiatura,
        rne: dato.info.rne || null,
        pruebas: dato.pruebas,
        imagenPngBase64: png.toString('base64'),
      });
    }
    return res.set('Cache-Control', 'private, no-store')
      .json({ ok: true, firmas, pruebasSinFirma: sinFirma });
  } catch (error) {
    console.error('Error obteniendo firmas de informe:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudieron verificar las firmas del informe' });
  }
};

module.exports = {
  obtenerFirmasInformePdf,
  obtenerBandejaEntregaResultados,
  obtenerInformeEntregable,
  construirInformeEntregableSeleccionado,
  registrarEntregaResultados,
};
