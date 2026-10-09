const mongoose = require("mongoose");
const { response } = require("express");

const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const MuestraLaboratorio = require("../../models/Gestion/MuestraLaboratorio");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");
const {
  construirEstadoOperativoLaboratorio,
  resolverEstadoOperativoSolicitud,
  sincronizarEstadosSolicitudLaboratorio,
} = require("../../utils/Gestion/estadoOperativoSolicitud");
const {
  registrarEventoHistorialResultado,
} = require("../../utils/Gestion/historialResultadoLaboratorio");


// ====== Escapar búsqueda regex ======

const escaparRegex = (valor = "") =>
  String(valor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ====== Obtener id normalizado ======

const obtenerId = (valor) => {
  if (!valor) {
    return null;
  }

  return valor._id ?? valor;
};

// ====== Obtener unidad clínica ======

const obtenerUnidadLaboratorio = ({ solicitud, claveUnidad }) => {
  const unidades = Array.isArray(solicitud.unidadesLaboratorio)
    ? solicitud.unidadesLaboratorio
    : [];

  return (
    unidades.find(
      (unidad) => String(unidad.claveUnidad ?? "") === String(claveUnidad ?? ""),
    ) ?? null
  );
};

// ====== Resolver intento vigente por recipiente ======

const construirEstadoRecipientesUnidad = (muestras = []) => {
  const grupos = new Map();

  for (const muestra of muestras) {
    const clavePlan = String(
      muestra.claveMuestraPlan ?? muestra._id?.toString() ?? "",
    );

    if (!clavePlan) {
      continue;
    }

    if (!grupos.has(clavePlan)) {
      grupos.set(clavePlan, []);
    }

    grupos.get(clavePlan).push(muestra);
  }

  const recipientes = [];

  for (const [claveMuestraPlan, intentos] of grupos.entries()) {
    const intentosOrdenados = [...intentos].sort((a, b) => {
      const intentoA = Number(a.numeroIntento ?? 1);
      const intentoB = Number(b.numeroIntento ?? 1);

      if (intentoA !== intentoB) {
        return intentoA - intentoB;
      }

      return (
        new Date(a.createdAt ?? 0).getTime() -
        new Date(b.createdAt ?? 0).getTime()
      );
    });

    const ultimoIntento = intentosOrdenados[intentosOrdenados.length - 1] ?? null;

    const intentoVigente =
      ultimoIntento && ultimoIntento.estadoMuestra !== "ANULADA"
        ? ultimoIntento
        : null;

    const muestraReferencia = intentoVigente ?? ultimoIntento;

    recipientes.push({
      claveMuestraPlan,
      numeroRecipiente: muestraReferencia?.numeroRecipiente ?? null,
      totalIntentos: intentosOrdenados.length,
      muestraVigenteId: intentoVigente?._id ?? null,
      codMuestra: muestraReferencia?.codMuestra ?? null,
      codigoEtiqueta: muestraReferencia?.codigoEtiqueta ?? null,
      numeroIntento: muestraReferencia?.numeroIntento ?? null,
      estadoMuestra: muestraReferencia?.estadoMuestra ?? null,
      esVigente: Boolean(intentoVigente),
      aceptada: intentoVigente?.estadoMuestra === "ACEPTADA",
    });
  }

  recipientes.sort((a, b) => {
    const recipienteA = Number(a.numeroRecipiente ?? 0);
    const recipienteB = Number(b.numeroRecipiente ?? 0);

    if (recipienteA !== recipienteB) {
      return recipienteA - recipienteB;
    }

    return String(a.claveMuestraPlan).localeCompare(String(b.claveMuestraPlan));
  });

  return recipientes;
};

// ====== Resolver habilitación Muestra ↔ Resultado ======

const resolverHabilitacionMuestraUnidad = async ({
  solicitud,
  claveUnidad,
  session = null,
  muestrasSolicitud = null,
}) => {
  const unidad = obtenerUnidadLaboratorio({
    solicitud,
    claveUnidad,
  });

  if (!unidad) {
    throw new Error(
      `La unidad clínica ${claveUnidad} asociada al resultado no existe en la solicitud`,
    );
  }

  if (unidad.estado === "ANULADO") {
    return {
      habilitada: false,
      codigo: "UNIDAD_ANULADA",
      requiereMuestra: unidad.snapshotClinico?.requiereMuestra !== false,
      claveUnidad,
      mensaje: "La unidad clínica se encuentra ANULADA",
      resumen: {
        totalRecipientes: 0,
        aceptados: 0,
        pendientes: 0,
      },
      muestras: [],
    };
  }

  const requiereMuestra = unidad.snapshotClinico?.requiereMuestra !== false;

  if (!requiereMuestra) {
    return {
      habilitada: true,
      codigo: "NO_REQUIERE_MUESTRA",
      requiereMuestra: false,
      claveUnidad,
      mensaje: "La unidad no requiere muestra física para registrar resultados",
      resumen: {
        totalRecipientes: 0,
        aceptados: 0,
        pendientes: 0,
      },
      muestras: [],
    };
  }

  let muestrasUnidad;

  if (Array.isArray(muestrasSolicitud)) {
    muestrasUnidad = muestrasSolicitud.filter((muestra) =>
      Array.isArray(muestra.coberturas)
        ? muestra.coberturas.some(
            (cobertura) =>
              String(cobertura?.claveUnidad ?? "") === String(claveUnidad),
          )
        : false,
    );
  } else {
    let consulta = MuestraLaboratorio.find({
      solicitudAtencionId: solicitud._id,
      "coberturas.claveUnidad": claveUnidad,
    }).select(
      [
        "_id",
        "claveMuestraPlan",
        "numeroRecipiente",
        "numeroIntento",
        "muestraAnteriorId",
        "estadoMuestra",
        "codigoEtiqueta",
        "codMuestra",
        "createdAt",
        "coberturas.claveUnidad",
      ].join(" "),
    );

    if (session) {
      consulta = consulta.session(session);
    }

    muestrasUnidad = await consulta.lean();
  }

  const recipientes = construirEstadoRecipientesUnidad(muestrasUnidad);

  if (recipientes.length === 0) {
    return {
      habilitada: false,
      codigo: "SIN_MUESTRAS",
      requiereMuestra: true,
      claveUnidad,
      mensaje: "La unidad aún no posee muestras físicas inicializadas",
      resumen: {
        totalRecipientes: 0,
        aceptados: 0,
        pendientes: 0,
      },
      muestras: [],
    };
  }

  const aceptados = recipientes.filter((recipiente) => recipiente.aceptada).length;
  const pendientes = recipientes.length - aceptados;
  const habilitada = pendientes === 0;

  const detallePendiente = recipientes
    .filter((recipiente) => !recipiente.aceptada)
    .map((recipiente) => {
      const numero = recipiente.numeroRecipiente ?? "-";
      const estado = recipiente.estadoMuestra ?? "SIN INTENTO VIGENTE";

      return `Recipiente ${numero}: ${estado}`;
    })
    .join(", ");

  return {
    habilitada,
    codigo: habilitada ? "MUESTRAS_ACEPTADAS" : "MUESTRAS_NO_APTAS",
    requiereMuestra: true,
    claveUnidad,
    mensaje: habilitada
      ? "Todas las muestras requeridas se encuentran ACEPTADAS"
      : `No se pueden registrar resultados hasta que todas las muestras requeridas estén ACEPTADAS. ${detallePendiente}`,
    resumen: {
      totalRecipientes: recipientes.length,
      aceptados,
      pendientes,
    },
    muestras: recipientes,
  };
};

// ====== Cargar muestras mínimas de una solicitud ======

const obtenerMuestrasSolicitudParaResultados = async ({
  solicitudAtencionId,
  session = null,
}) => {
  let consulta = MuestraLaboratorio.find({
    solicitudAtencionId,
  }).select(
    [
      "_id",
      "claveMuestraPlan",
      "numeroRecipiente",
      "numeroIntento",
      "muestraAnteriorId",
      "estadoMuestra",
      "codigoEtiqueta",
      "codMuestra",
      "createdAt",
      "coberturas.claveUnidad",
    ].join(" "),
  );

  if (session) {
    consulta = consulta.session(session);
  }

  return consulta.lean();
};

// ====== Adjuntar habilitación dinámica ======

const adjuntarHabilitacionMuestraResultados = async ({
  solicitud,
  resultados,
  session = null,
  muestrasSolicitud = null,
}) => {
  const muestrasFinales = Array.isArray(muestrasSolicitud)
    ? muestrasSolicitud
    : await obtenerMuestrasSolicitudParaResultados({
        solicitudAtencionId: solicitud._id,
        session,
      });

  const salida = [];

  for (const resultado of resultados) {
    const resultadoPlano =
      typeof resultado?.toObject === "function" ? resultado.toObject() : resultado;

    const resultadoConConfiguracion = adjuntarConfiguracionClinicaResultado({
      solicitud,
      resultado: resultadoPlano,
    });

    const habilitacionMuestra = await resolverHabilitacionMuestraUnidad({
      solicitud,
      claveUnidad: resultadoPlano.claveUnidad,
      session,
      muestrasSolicitud: muestrasFinales,
    });

    const unidadLaboratorio = obtenerUnidadLaboratorio({
      solicitud,
      claveUnidad: resultadoPlano.claveUnidad,
    });

    salida.push({
      ...resultadoConConfiguracion,
      estadoUnidadLaboratorio: unidadLaboratorio?.estado ?? null,
      habilitacionMuestra,
    });
  }

  return salida;
};

// ====== Validar captura habilitada ======

const validarCapturaResultadoHabilitada = async ({
  solicitud,
  resultadoLaboratorio,
  session = null,
}) => {
  const habilitacionMuestra = await resolverHabilitacionMuestraUnidad({
    solicitud,
    claveUnidad: resultadoLaboratorio.claveUnidad,
    session,
  });

  if (!habilitacionMuestra.habilitada) {
    const error = new Error(habilitacionMuestra.mensaje);

    error.codigo = "RESULTADO_BLOQUEADO_POR_MUESTRA";
    error.habilitacionMuestra = habilitacionMuestra;

    throw error;
  }

  return habilitacionMuestra;
};

// ====== Construir Items desde snapshot ======

const construirResultadosItemsDesdeUnidad = (unidad) => {
  const snapshot = unidad.snapshotClinico;

  if (!snapshot) {
    throw new Error(
      `La unidad ${unidad.claveUnidad} no posee snapshot clínico`,
    );
  }

  const grupos = Array.isArray(snapshot.gruposResultado)
    ? snapshot.gruposResultado
    : [];

  const resultadosItems = [];

  grupos.forEach((grupo, indiceGrupo) => {
    const items = Array.isArray(grupo.items) ? grupo.items : [];

    items.forEach((item, indiceItem) => {
      const snapshotItem = item.snapshotItem;

      if (!item.itemLabId || !snapshotItem) {
        throw new Error(
          `Existe un Item incompleto en la unidad ${unidad.claveUnidad}`,
        );
      }

      const itemLabId = item.itemLabId._id ?? item.itemLabId;

      const claveItemResultado =
        `${unidad.claveUnidad}:` +
        `${indiceGrupo}:` +
        `${indiceItem}:` +
        `${itemLabId.toString()}`;

      resultadosItems.push({
        claveItemResultado,

        // ====== Ubicación en snapshot ======

        indiceGrupo,
        indiceItem,

        nombreGrupo: grupo.nombreGrupo ?? "",

        ordenGrupo: Number(grupo.ordenGrupo ?? 0),

        ordenItem: Number(item.ordenItem ?? 0),

        // ====== Identidad del Item ======

        itemLabId,

        codItemLab: snapshotItem.codItemLab ?? null,

        nombreInforme: snapshotItem.nombreInforme,

        tipoResultado: snapshotItem.tipoResultado ?? "TEXTO",

        unidadesRef: snapshotItem.unidadesRef ?? "",

        esOpcional: snapshotItem.esOpcional === true,

        mostrarReferenciaInforme:
          snapshotItem.mostrarReferenciaInforme !== false,

        // ====== Resultado inicial ======

        valor: null,

        observacion: "",

        estado: "PENDIENTE",

        evaluacionReferencia: {
          estado: "PENDIENTE",
        },

        alertasDetectadas: [],
      });
    });
  });

  return resultadosItems;
};

// ====== Construir resultado desde unidad ======

const construirResultadoDesdeUnidad = ({
  solicitud,
  unidad,
  uid,
  nombreUsuario,
}) => {
  if (!unidad.snapshotClinico) {
    throw new Error(
      `La unidad ${unidad.claveUnidad} no posee snapshot clínico`,
    );
  }

  const snapshot = unidad.snapshotClinico;

  const resultadosItems = construirResultadosItemsDesdeUnidad(unidad);
  const ahora = new Date();

  return {
    // ====== Orden ======

    solicitudAtencionId: solicitud._id,

    codSolicitud: solicitud.codSolicitud,

    claveUnidad: unidad.claveUnidad,

    // ====== Prueba ======

    pruebaLabId: snapshot.pruebaLabId ?? unidad.pruebaLabId,

    codPruebaLab: snapshot.codPruebaLab ?? unidad.codExamen,

    nombrePruebaLab: snapshot.nombrePruebaLab ?? unidad.nombreExamen,

    numeroInstancia: unidad.numeroInstancia,

    etiquetaInstancia: unidad.etiquetaInstancia ?? null,

    // ====== Resultados ======

    resultadosItems,

    observacionGeneral: "",

    estadoResultado: "PENDIENTE",

    // ====== Versionado e historial ======

    versionResultado: 1,

    historialEventos: [
      {
        tipoEvento: "INICIALIZACION",
        versionResultado: 1,
        estadoAnterior: null,
        estadoNuevo: "PENDIENTE",
        ejecutadoPor: uid,
        usuarioEjecucion: nombreUsuario ?? null,
        fechaEvento: ahora,
        detalle: "Resultado inicializado desde el snapshot clínico de la solicitud",
      },
    ],

    // ====== Auditoría ======

    createdBy: uid,

    usuarioRegistro: nombreUsuario ?? null,

    fechaRegistro: ahora,
  };
};

// ====== Formatos numéricos soportados ======

const FORMATOS_CAPTURA_NUMERICA = new Set([
  "VALOR",
  "RANGO",
  "MAYOR_QUE",
  "MAYOR_IGUAL_QUE",
  "MENOR_QUE",
  "MENOR_IGUAL_QUE",
]);

// ====== Detectar resultado vacío ======
const esValorResultadoVacio = (valor) =>
  valor === null ||
  valor === undefined ||
  (typeof valor === "string" && valor.trim() === "");

// ====== Resolver opción canónica ======
const obtenerOpcionCanonicaResultado = (valor, opciones = []) => {
  const buscado = String(valor ?? "").trim().toUpperCase();
  if (!buscado) return null;

  return (
    (Array.isArray(opciones) ? opciones : []).find(
      (opcion) => String(opcion ?? "").trim().toUpperCase() === buscado,
    ) ?? null
  );
};

// ====== Identificar valor cualitativo en Item numérico ======
const esValorCualitativoNumerico = (valor) =>
  Boolean(
    valor &&
      typeof valor === "object" &&
      !Array.isArray(valor) &&
      String(valor.tipo ?? "").trim().toUpperCase() === "CUALITATIVO",
  );

// ====== Obtener formatos históricos permitidos ======

const obtenerFormatosCapturaNumerica = (snapshotItem) => {
  const formatos = Array.isArray(snapshotItem?.formatosCapturaNumerica)
    ? snapshotItem.formatosCapturaNumerica.filter((formato) =>
        FORMATOS_CAPTURA_NUMERICA.has(formato),
      )
    : [];

  return formatos.length > 0 ? [...new Set(formatos)] : ["VALOR"];
};

// ====== Resolver precisión numérica histórica ======
const obtenerPrecisionNumerica = (snapshotItem) =>
  String(snapshotItem?.precisionNumerica ?? "DECIMAL").toUpperCase() === "ENTERO"
    ? "ENTERO"
    : "DECIMAL";

// ====== Validar precisión del resultado ======
const validarPrecisionResultadoNumerico = (valor, snapshotItem) => {
  if (obtenerPrecisionNumerica(snapshotItem) === "ENTERO" && !Number.isInteger(valor)) {
    throw new Error("Este Item solo permite valores enteros");
  }
};

// ====== Normalizar resultado numérico estructurado ======

const normalizarValorNumericoResultado = ({ valor, snapshotItem }) => {
  const formatosPermitidos = obtenerFormatosCapturaNumerica(snapshotItem);

  // ====== Alternativa cualitativa ======
  if (esValorCualitativoNumerico(valor)) {
    const alternativas = Array.isArray(snapshotItem?.valoresCualitativosAlternativos)
      ? snapshotItem.valoresCualitativosAlternativos
      : [];
    const opcion = obtenerOpcionCanonicaResultado(valor.valor, alternativas);

    if (!opcion) {
      throw new Error(
        "El valor cualitativo no está permitido para este Item numérico",
      );
    }

    return {
      tipo: "CUALITATIVO",
      valor: opcion,
    };
  }

  const validarFormato = (formato) => {
    if (!formatosPermitidos.includes(formato)) {
      throw new Error(
        `El formato numérico ${formato} no está permitido para este Item`,
      );
    }
  };

  // ====== Compatibilidad valor simple ======

  if (
    valor === null ||
    valor === undefined ||
    valor === "" ||
    Array.isArray(valor)
  ) {
    throw new Error("El valor numérico es obligatorio");
  }

  if (typeof valor !== "object") {
    validarFormato("VALOR");

    const valorNumerico = Number(valor);

    if (!Number.isFinite(valorNumerico)) {
      throw new Error("El resultado debe ser un valor numérico válido");
    }

    validarPrecisionResultadoNumerico(valorNumerico, snapshotItem);

    return valorNumerico;
  }

  const formato = String(valor.tipo ?? "").trim().toUpperCase();

  if (!FORMATOS_CAPTURA_NUMERICA.has(formato)) {
    throw new Error("El formato del resultado numérico no es válido");
  }

  validarFormato(formato);

  // ====== Valor único enviado como objeto ======

  if (formato === "VALOR") {
    if (valor.valor === null || valor.valor === undefined || valor.valor === "") {
      throw new Error("El resultado debe ser un valor numérico válido");
    }

    const valorNumerico = Number(valor.valor);

    if (!Number.isFinite(valorNumerico)) {
      throw new Error("El resultado debe ser un valor numérico válido");
    }

    validarPrecisionResultadoNumerico(valorNumerico, snapshotItem);

    return valorNumerico;
  }

  // ====== Rango ======

  if (formato === "RANGO") {
    if (
      valor.desde === null ||
      valor.desde === undefined ||
      valor.desde === "" ||
      valor.hasta === null ||
      valor.hasta === undefined ||
      valor.hasta === ""
    ) {
      throw new Error("Debe indicar ambos extremos del rango numérico");
    }

    const desde = Number(valor.desde);
    const hasta = Number(valor.hasta);

    if (!Number.isFinite(desde) || !Number.isFinite(hasta)) {
      throw new Error("Debe indicar ambos extremos del rango numérico");
    }

    validarPrecisionResultadoNumerico(desde, snapshotItem);
    validarPrecisionResultadoNumerico(hasta, snapshotItem);

    if (desde > hasta) {
      throw new Error("El valor inicial no puede ser mayor que el valor final");
    }

    return {
      tipo: "RANGO",
      desde,
      hasta,
    };
  }

  // ====== Operador con un límite ======

  if (valor.valor === null || valor.valor === undefined || valor.valor === "") {
    throw new Error("Debe indicar un valor numérico para el operador seleccionado");
  }

  const valorLimite = Number(valor.valor);

  if (!Number.isFinite(valorLimite)) {
    throw new Error("Debe indicar un valor numérico para el operador seleccionado");
  }

  validarPrecisionResultadoNumerico(valorLimite, snapshotItem);

  return {
    tipo: formato,
    valor: valorLimite,
  };
};

// ====== Convertir resultado numérico a intervalo ======

const obtenerIntervaloResultadoNumerico = (valor) => {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    const numero = Number(valor);

    if (!Number.isFinite(numero)) {
      return null;
    }

    return {
      minimo: numero,
      maximo: numero,
      incluyeMinimo: true,
      incluyeMaximo: true,
    };
  }

  const tipo = String(valor.tipo ?? "").toUpperCase();

  if (tipo === "RANGO") {
    const desde = Number(valor.desde);
    const hasta = Number(valor.hasta);

    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde > hasta) {
      return null;
    }

    return {
      minimo: desde,
      maximo: hasta,
      incluyeMinimo: true,
      incluyeMaximo: true,
    };
  }

  const limite = Number(valor.valor);

  if (!Number.isFinite(limite)) {
    return null;
  }

  if (tipo === "MAYOR_QUE") {
    return {
      minimo: limite,
      maximo: Number.POSITIVE_INFINITY,
      incluyeMinimo: false,
      incluyeMaximo: false,
    };
  }

  if (tipo === "MAYOR_IGUAL_QUE") {
    return {
      minimo: limite,
      maximo: Number.POSITIVE_INFINITY,
      incluyeMinimo: true,
      incluyeMaximo: false,
    };
  }

  if (tipo === "MENOR_QUE") {
    return {
      minimo: Number.NEGATIVE_INFINITY,
      maximo: limite,
      incluyeMinimo: false,
      incluyeMaximo: false,
    };
  }

  if (tipo === "MENOR_IGUAL_QUE") {
    return {
      minimo: Number.NEGATIVE_INFINITY,
      maximo: limite,
      incluyeMinimo: false,
      incluyeMaximo: true,
    };
  }

  if (tipo === "VALOR") {
    const numero = Number(valor.valor);
    if (!Number.isFinite(numero)) return null;
    return {
      minimo: numero,
      maximo: numero,
      incluyeMinimo: true,
      incluyeMaximo: true,
    };
  }

  return null;
};

// ====== Convertir referencia numérica a intervalo ======

const obtenerIntervaloReferenciaNumerica = (referencia) => {
  const tipo = referencia?.tipoReferencia;

  if (tipo === "RANGO") {
    const minimo = Number(referencia.valorMin);
    const maximo = Number(referencia.valorMax);

    if (!Number.isFinite(minimo) || !Number.isFinite(maximo) || minimo > maximo) {
      return null;
    }

    return {
      minimo,
      maximo,
      incluyeMinimo: true,
      incluyeMaximo: true,
    };
  }

  const limite = Number(referencia?.valorLimite);
  if (!Number.isFinite(limite)) return null;

  if (tipo === "MENOR_QUE") {
    return {
      minimo: Number.NEGATIVE_INFINITY,
      maximo: limite,
      incluyeMinimo: false,
      incluyeMaximo: false,
    };
  }

  if (tipo === "MENOR_IGUAL_QUE") {
    return {
      minimo: Number.NEGATIVE_INFINITY,
      maximo: limite,
      incluyeMinimo: false,
      incluyeMaximo: true,
    };
  }

  if (tipo === "MAYOR_QUE") {
    return {
      minimo: limite,
      maximo: Number.POSITIVE_INFINITY,
      incluyeMinimo: false,
      incluyeMaximo: false,
    };
  }

  if (tipo === "MAYOR_IGUAL_QUE") {
    return {
      minimo: limite,
      maximo: Number.POSITIVE_INFINITY,
      incluyeMinimo: true,
      incluyeMaximo: false,
    };
  }

  return null;
};

// ====== Validar inclusión de intervalos ======

const intervaloContenido = (resultado, referencia) => {
  if (!resultado || !referencia) return false;

  const cumpleMinimo =
    resultado.minimo > referencia.minimo ||
    (resultado.minimo === referencia.minimo &&
      (!resultado.incluyeMinimo || referencia.incluyeMinimo));

  const cumpleMaximo =
    resultado.maximo < referencia.maximo ||
    (resultado.maximo === referencia.maximo &&
      (!resultado.incluyeMaximo || referencia.incluyeMaximo));

  return cumpleMinimo && cumpleMaximo;
};

// ====== Dirección de desvío de intervalo ======

const direccionFueraIntervalo = (resultado, referencia) => {
  if (!resultado || !referencia) return "FUERA_REFERENCIA";

  const violaMinimo = !(
    resultado.minimo > referencia.minimo ||
    (resultado.minimo === referencia.minimo &&
      (!resultado.incluyeMinimo || referencia.incluyeMinimo))
  );

  const violaMaximo = !(
    resultado.maximo < referencia.maximo ||
    (resultado.maximo === referencia.maximo &&
      (!resultado.incluyeMaximo || referencia.incluyeMaximo))
  );

  if (violaMinimo && !violaMaximo) return "BAJO";
  if (violaMaximo && !violaMinimo) return "ALTO";
  return "FUERA_REFERENCIA";
};

// ====== Validar si un intervalo contiene un valor ======

const intervaloContieneValor = (intervalo, valor) => {
  if (!intervalo || !Number.isFinite(valor)) return false;

  const cumpleMinimo =
    valor > intervalo.minimo ||
    (valor === intervalo.minimo && intervalo.incluyeMinimo);
  const cumpleMaximo =
    valor < intervalo.maximo ||
    (valor === intervalo.maximo && intervalo.incluyeMaximo);

  return cumpleMinimo && cumpleMaximo;
};

// ====== Normalizar resultado estructurado de hallazgos ======
const normalizarValorEstructuradoResultado = ({ valor, snapshotItem }) => {
  const configuracion = snapshotItem?.configuracionEstructurada;

  if (
    !configuracion ||
    configuracion.subtipo !== "HALLAZGOS" ||
    !valor ||
    typeof valor !== "object" ||
    Array.isArray(valor) ||
    String(valor.tipo ?? "").trim().toUpperCase() !== "HALLAZGOS"
  ) {
    throw new Error("El resultado estructurado no es válido");
  }

  const modo = String(valor.modo ?? "").trim().toUpperCase();

  if (modo === "AUSENCIA") {
    return {
      tipo: "HALLAZGOS",
      modo: "AUSENCIA",
      valorAusencia: String(configuracion.valorAusencia ?? "NO SE OBSERVAN").trim(),
      hallazgos: [],
    };
  }

  if (modo !== "DETALLE") {
    throw new Error("El modo del resultado estructurado no es válido");
  }

  const hallazgosEntrada = Array.isArray(valor.hallazgos) ? valor.hallazgos : [];

  if (!hallazgosEntrada.length) {
    throw new Error("Debe registrar al menos un hallazgo");
  }

  if (configuracion.permiteMultiples === false && hallazgosEntrada.length > 1) {
    throw new Error("Este Item solo permite un hallazgo");
  }

  const hallazgosConfigurados = Array.isArray(configuracion.hallazgos)
    ? configuracion.hallazgos
    : [];
  const usados = new Set();
  const hallazgos = [];

  for (const entrada of hallazgosEntrada) {
    const solicitado = String(entrada?.hallazgo ?? "").trim();
    const canonico = obtenerOpcionCanonicaResultado(
      solicitado,
      hallazgosConfigurados,
    );

    if (!canonico && configuracion.permitirOtroHallazgo !== true) {
      throw new Error(`El hallazgo ${solicitado || "indicado"} no está permitido`);
    }

    const hallazgo = canonico ?? solicitado;

    if (!hallazgo) {
      throw new Error("Debe indicar el nombre del hallazgo");
    }

    const clave = hallazgo.toUpperCase();
    if (usados.has(clave)) {
      throw new Error(`El hallazgo ${hallazgo} está repetido`);
    }
    usados.add(clave);

    if (configuracion.cuantificacion?.tipo === "CATEGORICA") {
      const valorEntrada =
        entrada?.valor && typeof entrada.valor === "object"
          ? entrada.valor.valor
          : entrada?.valor;
      const opcion = obtenerOpcionCanonicaResultado(
        valorEntrada,
        configuracion.cuantificacion.opciones,
      );

      if (!opcion) {
        throw new Error(
          `La cuantificación de ${hallazgo} no está entre las opciones permitidas`,
        );
      }

      hallazgos.push({
        hallazgo,
        valor: { tipo: "CATEGORICO", valor: opcion },
      });
      continue;
    }

    if (configuracion.cuantificacion?.tipo !== "NUMERICA") {
      throw new Error("La cuantificación del Item estructurado no está configurada");
    }

    const snapshotNumerico = {
      formatosCapturaNumerica:
        configuracion.cuantificacion.formatosCapturaNumerica,
      formatoCapturaNumericaDefault:
        configuracion.cuantificacion.formatoCapturaNumericaDefault,
      precisionNumerica:
        configuracion.cuantificacion.precisionNumerica ?? "DECIMAL",
      valoresCualitativosAlternativos: [],
    };

    hallazgos.push({
      hallazgo,
      valor: normalizarValorNumericoResultado({
        valor: entrada?.valor,
        snapshotItem: snapshotNumerico,
      }),
    });
  }

  return {
    tipo: "HALLAZGOS",
    modo: "DETALLE",
    hallazgos,
  };
};

// ====== Normalizar valor según tipo ======

const normalizarValorResultado = ({ valor, tipoResultado, snapshotItem }) => {
  // ====== Numérico ======

  if (tipoResultado === "NUMERICO") {
    return normalizarValorNumericoResultado({ valor, snapshotItem });
  }

  // ====== Texto ======

  if (tipoResultado === "TEXTO") {
    if (typeof valor !== "string") {
      throw new Error("El resultado debe ser un texto");
    }

    const valorTexto = valor.trim();

    if (!valorTexto) {
      throw new Error("El resultado de texto no puede estar vacío");
    }

    return valorTexto;
  }

  // ====== Categórico ======

  if (tipoResultado === "CATEGORICO") {
    if (typeof valor !== "string") {
      throw new Error("El resultado categórico debe ser un texto");
    }

    const valorTexto = valor.trim();

    if (!valorTexto) {
      throw new Error("El resultado categórico no puede estar vacío");
    }

    const opciones = Array.isArray(snapshotItem.opcionesResultado)
      ? snapshotItem.opcionesResultado
      : [];

    const opcionEncontrada = opciones.find(
      (opcion) =>
        String(opcion).trim().toUpperCase() === valorTexto.toUpperCase(),
    );

    // ====== Usar valor canónico ======

    if (opcionEncontrada !== undefined) {
      return opcionEncontrada;
    }

    // ====== Validar valor no listado ======

    if (snapshotItem.permiteValorNoListado !== true) {
      throw new Error(
        opciones.length > 0
          ? `El valor debe ser una de las opciones permitidas: ${opciones.join(", ")}`
          : "El Item no permite valores fuera de la configuración",
      );
    }

    return valorTexto;
  }

  // ====== Estructurado ======

  if (tipoResultado === "ESTRUCTURADO") {
    return normalizarValorEstructuradoResultado({ valor, snapshotItem });
  }

  throw new Error(`Tipo de resultado no soportado: ${tipoResultado}`);
};

// ====== Recalcular estado del resultado ======

const recalcularEstadoResultado = (resultadoLaboratorio) => {
  if (resultadoLaboratorio.estadoResultado === "ANULADO") {
    return "ANULADO";
  }

  const items = Array.isArray(resultadoLaboratorio.resultadosItems)
    ? resultadoLaboratorio.resultadosItems
    : [];

  if (items.length === 0) {
    return "PENDIENTE";
  }

  // ====== Los Items opcionales vacíos no bloquean la completitud ======
  const requeridos = items.filter((item) => item.esOpcional !== true);

  if (requeridos.length === 0) {
    return items.some((item) => item.estado !== "PENDIENTE")
      ? "COMPLETO"
      : "PENDIENTE";
  }

  const pendientes = requeridos.filter(
    (item) => item.estado === "PENDIENTE",
  ).length;

  if (pendientes === requeridos.length) {
    return "PENDIENTE";
  }

  if (pendientes > 0) {
    return "EN PROCESO";
  }

  return "COMPLETO";
};

// ====== Obtener grupo desde snapshot de la orden ======

const obtenerGrupoSnapshotResultado = ({
  solicitud,
  resultadoLaboratorio,
  resultadoItem,
}) => {
  const unidades = Array.isArray(solicitud.unidadesLaboratorio)
    ? solicitud.unidadesLaboratorio
    : [];

  const unidad = unidades.find(
    (item) => item.claveUnidad === resultadoLaboratorio.claveUnidad,
  );

  if (!unidad) {
    throw new Error(
      "La unidad clínica asociada al resultado ya no existe en la solicitud",
    );
  }

  if (!unidad.snapshotClinico) {
    throw new Error("La unidad clínica no posee snapshot clínico");
  }

  const grupos = Array.isArray(unidad.snapshotClinico.gruposResultado)
    ? unidad.snapshotClinico.gruposResultado
    : [];

  const grupo = grupos[resultadoItem.indiceGrupo];

  if (!grupo) {
    throw new Error("No se encontró el grupo clínico asociado al Item");
  }

  return grupo;
};

// ====== Obtener Item desde snapshot de la orden ======

const obtenerItemSnapshotResultado = ({
  solicitud,
  resultadoLaboratorio,
  resultadoItem,
}) => {
  const grupo = obtenerGrupoSnapshotResultado({
    solicitud,
    resultadoLaboratorio,
    resultadoItem,
  });

  const items = Array.isArray(grupo.items) ? grupo.items : [];

  const itemSnapshot = items[resultadoItem.indiceItem];

  if (!itemSnapshot) {
    throw new Error("No se encontró el Item en el snapshot clínico");
  }

  const itemLabIdSnapshot =
    itemSnapshot.itemLabId?._id ?? itemSnapshot.itemLabId;

  if (
    !itemLabIdSnapshot ||
    itemLabIdSnapshot.toString() !== resultadoItem.itemLabId.toString()
  ) {
    throw new Error(
      "El Item del resultado no coincide con el snapshot clínico de la orden",
    );
  }

  if (!itemSnapshot.snapshotItem) {
    throw new Error("El Item no posee configuración clínica histórica");
  }

  return itemSnapshot;
};

// ====== Clonar configuración clínica serializable ======
const clonarConfiguracionClinicaResultado = (valor) => {
  if (valor === null || valor === undefined) return null;

  if (valor && typeof valor.toObject === "function") {
    valor = valor.toObject();
  }

  if (Array.isArray(valor)) {
    return valor.map((item) => clonarConfiguracionClinicaResultado(item));
  }

  if (typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([clave, contenido]) => [
        clave,
        clonarConfiguracionClinicaResultado(contenido),
      ]),
    );
  }

  if (typeof valor === "string") return valor.trim();

  return valor;
};

// ====== Clonar valor por defecto de resultado ======
const clonarValorPorDefectoResultado = (valor) => {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  return clonarConfiguracionClinicaResultado(valor);
};

// ====== Adjuntar configuración clínica histórica ======

const adjuntarConfiguracionClinicaResultado = ({ solicitud, resultado }) => {
  const resultadoPlano =
    typeof resultado?.toObject === "function" ? resultado.toObject() : resultado;

  const items = Array.isArray(resultadoPlano?.resultadosItems)
    ? resultadoPlano.resultadosItems
    : [];

  return {
    ...resultadoPlano,
    resultadosItems: items.map((item) => {
      const itemSnapshot = obtenerItemSnapshotResultado({
        solicitud,
        resultadoLaboratorio: resultadoPlano,
        resultadoItem: item,
      });

      const snapshotItem = itemSnapshot.snapshotItem;
      const grupoSnapshot = obtenerGrupoSnapshotResultado({
        solicitud,
        resultadoLaboratorio: resultadoPlano,
        resultadoItem: item,
      });

      return {
        ...item,
        esOpcional:
          item.esOpcional === true || snapshotItem.esOpcional === true,
        comentarioReferenciaGrupo: String(
          grupoSnapshot.comentarioReferenciaGrupo ?? "",
        ).trim(),
        configuracionClinica: {
          tipoResultado: snapshotItem.tipoResultado ?? item.tipoResultado,
          esOpcional: snapshotItem.esOpcional === true,
          mostrarReferenciaInforme:
            item.mostrarReferenciaInforme !== false &&
            snapshotItem.mostrarReferenciaInforme !== false,
          opcionesResultado: Array.isArray(snapshotItem.opcionesResultado)
            ? [...snapshotItem.opcionesResultado]
            : [],
          valorPorDefectoResultado: clonarValorPorDefectoResultado(
            snapshotItem.valorPorDefectoResultado,
          ),
          formatosCapturaNumerica:
            snapshotItem.tipoResultado === "NUMERICO"
              ? obtenerFormatosCapturaNumerica(snapshotItem)
              : ["VALOR"],
          formatoCapturaNumericaDefault:
            snapshotItem.tipoResultado === "NUMERICO"
              ? (snapshotItem.formatoCapturaNumericaDefault ??
                obtenerFormatosCapturaNumerica(snapshotItem)[0] ??
                "VALOR")
              : "VALOR",
          precisionNumerica:
            snapshotItem.tipoResultado === "NUMERICO"
              ? obtenerPrecisionNumerica(snapshotItem)
              : "DECIMAL",
          valoresCualitativosAlternativos:
            snapshotItem.tipoResultado === "NUMERICO" &&
            Array.isArray(snapshotItem.valoresCualitativosAlternativos)
              ? [...snapshotItem.valoresCualitativosAlternativos]
              : [],
          valoresCualitativosReferencia:
            snapshotItem.tipoResultado === "NUMERICO" &&
            Array.isArray(snapshotItem.valoresCualitativosReferencia)
              ? [...snapshotItem.valoresCualitativosReferencia]
              : [],
          configuracionEstructurada:
            snapshotItem.tipoResultado === "ESTRUCTURADO"
              ? clonarConfiguracionClinicaResultado(
                  snapshotItem.configuracionEstructurada,
                )
              : null,
          permiteValorNoListado: snapshotItem.permiteValorNoListado === true,
          referenciasResultado: Array.isArray(snapshotItem.referenciasResultado)
            ? snapshotItem.referenciasResultado.map((referencia) => ({
                descripcion: referencia.descripcion ?? "",
                sexo: referencia.sexo ?? "TODOS",
                edadMin: referencia.edadMin ?? null,
                edadMax: referencia.edadMax ?? null,
                unidadEdad: referencia.unidadEdad ?? "ANIOS",
                tipoReferencia: referencia.tipoReferencia,
                valorMin: referencia.valorMin ?? null,
                valorMax: referencia.valorMax ?? null,
                valorLimite: referencia.valorLimite ?? null,
                valoresPermitidos: Array.isArray(referencia.valoresPermitidos)
                  ? [...referencia.valoresPermitidos]
                  : [],
                textoReferencia: referencia.textoReferencia ?? "",
                activo: referencia.activo !== false,
              }))
            : [],
          reglasAlerta: Array.isArray(snapshotItem.reglasAlerta)
            ? snapshotItem.reglasAlerta.map((regla) => ({
                descripcion: regla.descripcion ?? "",
                sexo: regla.sexo ?? "TODOS",
                edadMin: regla.edadMin ?? null,
                edadMax: regla.edadMax ?? null,
                unidadEdad: regla.unidadEdad ?? "ANIOS",
                condicion: regla.condicion,
                valor1: regla.valor1 ?? null,
                valor2: regla.valor2 ?? null,
                nivelAlerta: regla.nivelAlerta ?? "ADVERTENCIA",
                mensaje: regla.mensaje ?? "",
                activo: regla.activo !== false,
              }))
            : [],
        },
      };
    }),
  };
};

// ====== Normalizar sexo clínico ======

const normalizarSexoClinico = (sexo) => {
  const valor = String(sexo ?? "")
    .trim()
    .toUpperCase();

  if (!valor) {
    return null;
  }

  if (["MASCULINO", "M", "HOMBRE"].includes(valor)) {
    return "MASCULINO";
  }

  if (["FEMENINO", "F", "MUJER"].includes(valor)) {
    return "FEMENINO";
  }

  return null;
};

// ====== Calcular edad clínica ======

const calcularEdadClinica = ({
  fechaNacimiento,
  fechaReferencia,
  unidadEdad,
}) => {
  if (!fechaNacimiento || !fechaReferencia) {
    return null;
  }

  const nacimiento = new Date(fechaNacimiento);
  const referencia = new Date(fechaReferencia);

  if (
    Number.isNaN(nacimiento.getTime()) ||
    Number.isNaN(referencia.getTime())
  ) {
    return null;
  }

  const anioNacimiento = nacimiento.getUTCFullYear();
  const mesNacimiento = nacimiento.getUTCMonth();
  const diaNacimiento = nacimiento.getUTCDate();

  const anioReferencia = referencia.getUTCFullYear();
  const mesReferencia = referencia.getUTCMonth();
  const diaReferencia = referencia.getUTCDate();

  const nacimientoUTC = Date.UTC(anioNacimiento, mesNacimiento, diaNacimiento);

  const referenciaUTC = Date.UTC(anioReferencia, mesReferencia, diaReferencia);

  if (referenciaUTC < nacimientoUTC) {
    return null;
  }

  // ====== Edad en días ======

  if (unidadEdad === "DIAS") {
    const milisegundosDia = 24 * 60 * 60 * 1000;

    return Math.floor((referenciaUTC - nacimientoUTC) / milisegundosDia);
  }

  // ====== Edad en meses ======

  if (unidadEdad === "MESES") {
    let meses =
      (anioReferencia - anioNacimiento) * 12 + (mesReferencia - mesNacimiento);

    if (diaReferencia < diaNacimiento) {
      meses -= 1;
    }

    return Math.max(0, meses);
  }

  // ====== Edad en años ======

  let anios = anioReferencia - anioNacimiento;

  const aunNoCumple =
    mesReferencia < mesNacimiento ||
    (mesReferencia === mesNacimiento && diaReferencia < diaNacimiento);

  if (aunNoCumple) {
    anios -= 1;
  }

  return Math.max(0, anios);
};

// ====== Validar referencia para paciente ======

const referenciaAplicaPaciente = ({
  referencia,
  sexoPaciente,
  fechaNacimientoPaciente,
  fechaReferencia,
}) => {
  if (!referencia || referencia.activo === false) {
    return false;
  }

  const sexoReferencia = referencia.sexo ?? "TODOS";

  // ====== Validar sexo ======

  if (sexoReferencia !== "TODOS") {
    if (!sexoPaciente || sexoReferencia !== sexoPaciente) {
      return false;
    }
  }

  const tieneEdadMin =
    referencia.edadMin !== null && referencia.edadMin !== undefined;

  const tieneEdadMax =
    referencia.edadMax !== null && referencia.edadMax !== undefined;

  // ====== Validar edad ======

  if (tieneEdadMin || tieneEdadMax) {
    const edad = calcularEdadClinica({
      fechaNacimiento: fechaNacimientoPaciente,
      fechaReferencia,
      unidadEdad: referencia.unidadEdad ?? "ANIOS",
    });

    if (edad === null) {
      return false;
    }

    if (tieneEdadMin && edad < Number(referencia.edadMin)) {
      return false;
    }

    if (tieneEdadMax && edad > Number(referencia.edadMax)) {
      return false;
    }
  }

  return true;
};

// ====== Construir referencia aplicada ======

const construirReferenciaAplicada = (referencia) => ({
  descripcion: referencia.descripcion ?? "",

  sexo: referencia.sexo ?? "TODOS",

  edadMin: referencia.edadMin ?? null,

  edadMax: referencia.edadMax ?? null,

  unidadEdad: referencia.unidadEdad ?? "ANIOS",

  tipoReferencia: referencia.tipoReferencia,

  valorMin: referencia.valorMin ?? null,

  valorMax: referencia.valorMax ?? null,

  valorLimite: referencia.valorLimite ?? null,

  valoresPermitidos: Array.isArray(referencia.valoresPermitidos)
    ? [...referencia.valoresPermitidos]
    : [],

  textoReferencia: referencia.textoReferencia ?? "",
});

// ====== Obtener referencias demográficas ======

const obtenerReferenciasDemograficas = ({ solicitud, snapshotItem }) => {
  const referencias = Array.isArray(snapshotItem.referenciasResultado)
    ? snapshotItem.referenciasResultado.filter(
        (referencia) => referencia.activo !== false,
      )
    : [];

  if (referencias.length === 0) {
    return [];
  }

  const sexoPaciente = normalizarSexoClinico(solicitud.sexoPaciente);

  const fechaNacimientoPaciente = solicitud.fechaNacimientoPaciente ?? null;

  const fechaReferencia = solicitud.fechaEmision;

  let candidatas = referencias.filter((referencia) =>
    referenciaAplicaPaciente({
      referencia,
      sexoPaciente,
      fechaNacimientoPaciente,
      fechaReferencia,
    }),
  );

  if (candidatas.length === 0) {
    return [];
  }

  // ====== Priorizar sexo específico ======

  const especificasSexo = candidatas.filter(
    (referencia) => (referencia.sexo ?? "TODOS") !== "TODOS",
  );

  if (especificasSexo.length > 0) {
    candidatas = especificasSexo;
  }

  // ====== Priorizar edad específica ======

  const especificasEdad = candidatas.filter(
    (referencia) =>
      (referencia.edadMin !== null && referencia.edadMin !== undefined) ||
      (referencia.edadMax !== null && referencia.edadMax !== undefined),
  );

  if (especificasEdad.length > 0) {
    candidatas = especificasEdad;
  }

  return candidatas;
};

// ====== Comparar valor con referencia ======

const valorCumpleReferencia = ({ valor, referencia }) => {
  const tipoReferencia = referencia.tipoReferencia;

  // ====== Referencias numéricas ======

  if (
    [
      "RANGO",
      "MENOR_QUE",
      "MENOR_IGUAL_QUE",
      "MAYOR_QUE",
      "MAYOR_IGUAL_QUE",
    ].includes(tipoReferencia)
  ) {
    const intervaloResultado = obtenerIntervaloResultadoNumerico(valor);
    const intervaloReferencia = obtenerIntervaloReferenciaNumerica(referencia);

    return intervaloContenido(intervaloResultado, intervaloReferencia);
  }

  // ====== Valores permitidos ======

  if (tipoReferencia === "VALORES_PERMITIDOS") {
    const valoresPermitidos = Array.isArray(referencia.valoresPermitidos)
      ? referencia.valoresPermitidos
      : [];

    const valorComparacion = String(valor ?? "")
      .trim()
      .toUpperCase();

    return valoresPermitidos.some(
      (valorPermitido) =>
        String(valorPermitido).trim().toUpperCase() === valorComparacion,
    );
  }

  // ====== Referencia textual ======

  if (tipoReferencia === "TEXTO") {
    const valorComparacion = String(valor ?? "")
      .trim()
      .toUpperCase();

    const textoReferencia = String(referencia.textoReferencia ?? "")
      .trim()
      .toUpperCase();

    if (!textoReferencia) {
      return false;
    }

    return valorComparacion === textoReferencia;
  }

  return false;
};

// ====== Evaluar fuera de referencia única ======

const evaluarFueraReferenciaUnica = ({ valor, referencia }) => {
  const tipoReferencia = referencia.tipoReferencia;

  if (tipoReferencia === "VALORES_PERMITIDOS") {
    return "VALOR_NO_PERMITIDO";
  }

  if (tipoReferencia === "TEXTO") {
    return "FUERA_REFERENCIA";
  }

  const intervaloResultado = obtenerIntervaloResultadoNumerico(valor);
  const intervaloReferencia = obtenerIntervaloReferenciaNumerica(referencia);

  return direccionFueraIntervalo(intervaloResultado, intervaloReferencia);
};

// ====== Evaluar referencia del resultado ======

const evaluarReferenciaResultado = ({ solicitud, snapshotItem, valor }) => {
  // ====== Resultados estructurados ======
  if (snapshotItem?.tipoResultado === "ESTRUCTURADO") {
    const configuracion = snapshotItem?.configuracionEstructurada;
    const hallazgosNormales = Array.isArray(configuracion?.hallazgosNormales)
      ? configuracion.hallazgosNormales
          .map((hallazgo) => String(hallazgo ?? "").trim().toUpperCase())
          .filter(Boolean)
      : [];
    const ausenciaEsReferencia = configuracion?.ausenciaEsReferencia === true;

    if (!ausenciaEsReferencia && hallazgosNormales.length === 0) {
      return {
        estado: "NO_APLICA",
        referenciaAplicada: null,
        mensaje: "No existe una referencia estructurada configurada",
      };
    }

    const modo = String(valor?.modo ?? "").trim().toUpperCase();
    const valorEsperado = String(
      configuracion?.valorAusencia ?? "NO SE OBSERVAN",
    ).trim();

    if (modo === "AUSENCIA") {
      return {
        estado: ausenciaEsReferencia ? "VALOR_PERMITIDO" : "VALOR_NO_PERMITIDO",
        referenciaAplicada: null,
        mensaje: ausenciaEsReferencia
          ? `Resultado estructurado dentro del valor esperado: ${valorEsperado}`
          : `El resultado de ausencia no está configurado como valor esperado: ${valorEsperado}`,
      };
    }

    const hallazgos = Array.isArray(valor?.hallazgos) ? valor.hallazgos : [];
    const fueraReferencia = hallazgos
      .map((hallazgo) => String(hallazgo?.hallazgo ?? "").trim())
      .filter(Boolean)
      .filter(
        (hallazgo) => !hallazgosNormales.includes(hallazgo.toUpperCase()),
      );

    if (fueraReferencia.length === 0 && hallazgos.length > 0) {
      return {
        estado: "VALOR_PERMITIDO",
        referenciaAplicada: null,
        mensaje: "Los hallazgos registrados están considerados dentro de los valores esperados",
      };
    }

    return {
      estado: "VALOR_NO_PERMITIDO",
      referenciaAplicada: null,
      mensaje: fueraReferencia.length
        ? `Hallazgos fuera del valor esperado: ${fueraReferencia.join(", ")}`
        : `Se registraron hallazgos. Valor esperado: ${valorEsperado}`,
    };
  }

  // ====== Alternativa cualitativa de un Item numérico ======
  if (
    snapshotItem?.tipoResultado === "NUMERICO" &&
    esValorCualitativoNumerico(valor)
  ) {
    const valoresReferencia = Array.isArray(
      snapshotItem.valoresCualitativosReferencia,
    )
      ? snapshotItem.valoresCualitativosReferencia
      : [];

    if (valoresReferencia.length === 0) {
      return {
        estado: "NO_APLICA",
        referenciaAplicada: null,
        mensaje: "No existe una referencia cualitativa configurada",
      };
    }

    const coincide = Boolean(
      obtenerOpcionCanonicaResultado(valor.valor, valoresReferencia),
    );

    return {
      estado: coincide ? "VALOR_PERMITIDO" : "VALOR_NO_PERMITIDO",
      referenciaAplicada: null,
      mensaje: coincide
        ? "Resultado cualitativo dentro de la referencia clínica"
        : "Resultado cualitativo fuera de la referencia clínica",
    };
  }

  const referencias = obtenerReferenciasDemograficas({
    solicitud,
    snapshotItem,
  });

  // ====== Sin referencia aplicable ======

  if (referencias.length === 0) {
    return {
      estado: "NO_APLICA",
      referenciaAplicada: null,
      mensaje: "No existe una referencia clínica aplicable al paciente",
    };
  }

  // ====== Buscar referencias que cumplen ======

  const coincidencias = referencias.filter((referencia) =>
    valorCumpleReferencia({
      valor,
      referencia,
    }),
  );

  // ====== Una referencia encontrada ======

  if (coincidencias.length === 1) {
    const referencia = coincidencias[0];

    const estado =
      referencia.tipoReferencia === "VALORES_PERMITIDOS"
        ? "VALOR_PERMITIDO"
        : "DENTRO_REFERENCIA";

    return {
      estado,

      referenciaAplicada: construirReferenciaAplicada(referencia),

      mensaje: referencia.descripcion
        ? `Resultado clasificado como: ${referencia.descripcion}`
        : "Resultado dentro de la referencia clínica",
    };
  }

  // ====== Configuración ambigua ======

  if (coincidencias.length > 1) {
    return {
      estado: "PENDIENTE",
      referenciaAplicada: null,
      mensaje:
        "El resultado coincide con más de una referencia clínica; revise la configuración histórica del Item",
    };
  }

  // ====== Una sola referencia demográfica ======

  if (referencias.length === 1) {
    const referencia = referencias[0];

    const estado = evaluarFueraReferenciaUnica({
      valor,
      referencia,
    });

    return {
      estado,

      referenciaAplicada: construirReferenciaAplicada(referencia),

      mensaje:
        estado === "BAJO"
          ? "Resultado por debajo de la referencia"
          : estado === "ALTO"
            ? "Resultado por encima de la referencia"
            : estado === "VALOR_NO_PERMITIDO"
              ? "El resultado no corresponde a los valores permitidos"
              : "Resultado fuera de la referencia clínica",
    };
  }

  // ====== Ninguna banda coincide ======

  return {
    estado: "FUERA_REFERENCIA",
    referenciaAplicada: null,
    mensaje:
      "El resultado no coincide con ninguna referencia clínica configurada",
  };
};

// ====== Obtener reglas de alerta aplicables ======

const obtenerReglasAlertaAplicables = ({ solicitud, snapshotItem }) => {
  const reglas = Array.isArray(snapshotItem.reglasAlerta)
    ? snapshotItem.reglasAlerta.filter((regla) => regla.activo !== false)
    : [];

  if (reglas.length === 0) {
    return [];
  }

  const sexoPaciente = normalizarSexoClinico(solicitud.sexoPaciente);

  const fechaNacimientoPaciente = solicitud.fechaNacimientoPaciente ?? null;

  const fechaReferencia = solicitud.fechaEmision;

  // ====== Filtrar por contexto demográfico ======

  return reglas.filter((regla) =>
    referenciaAplicaPaciente({
      referencia: regla,
      sexoPaciente,
      fechaNacimientoPaciente,
      fechaReferencia,
    }),
  );
};

// ====== Normalizar texto para comparación ======

const normalizarTextoComparacion = (valor) =>
  String(valor ?? "")
    .trim()
    .toUpperCase();

// ====== Evaluar condición de alerta ======

const cumpleCondicionAlerta = ({ valor, tipoResultado, regla }) => {
  const condicion = regla.condicion;

  if (!condicion) {
    throw new Error("Existe una regla de alerta sin condición configurada");
  }

  // ====== Un valor cualitativo alternativo no se evalúa con reglas numéricas ======
  if (tipoResultado === "NUMERICO" && esValorCualitativoNumerico(valor)) {
    return false;
  }

  if (tipoResultado === "ESTRUCTURADO") {
    return false;
  }

  const condicionesNumericas = [
    "MENOR_QUE",
    "MENOR_IGUAL_QUE",
    "MAYOR_QUE",
    "MAYOR_IGUAL_QUE",
    "FUERA_DE_RANGO",
  ];

  // ====== Condiciones numéricas ======

  if (condicionesNumericas.includes(condicion)) {
    if (tipoResultado !== "NUMERICO") {
      throw new Error(
        `La regla de alerta ${regla.descripcion || condicion} requiere un resultado NUMERICO`,
      );
    }

    const intervalo = obtenerIntervaloResultadoNumerico(valor);

    if (!intervalo) {
      throw new Error(
        "No se puede evaluar una alerta numérica con un resultado no numérico",
      );
    }

    const valor1 = Number(regla.valor1);

    if (!Number.isFinite(valor1)) {
      throw new Error(
        `La regla de alerta ${regla.descripcion || condicion} no posee un valor1 numérico válido`,
      );
    }

    if (condicion === "MENOR_QUE") {
      return intervalo.minimo < valor1;
    }

    if (condicion === "MENOR_IGUAL_QUE") {
      return intervalo.minimo <= valor1;
    }

    if (condicion === "MAYOR_QUE") {
      return intervalo.maximo > valor1;
    }

    if (condicion === "MAYOR_IGUAL_QUE") {
      return intervalo.maximo >= valor1;
    }

    // ====== Fuera de rango ======

    const valor2 = Number(regla.valor2);

    if (!Number.isFinite(valor2)) {
      throw new Error(
        `La regla de alerta ${regla.descripcion || condicion} no posee un valor2 numérico válido`,
      );
    }

    if (valor1 > valor2) {
      throw new Error(
        `La regla de alerta ${regla.descripcion || condicion} posee un rango inválido`,
      );
    }

    return intervalo.minimo < valor1 || intervalo.maximo > valor2;
  }

  // ====== Igual o distinto ======

  if (condicion === "IGUAL_A" || condicion === "DISTINTO_DE") {
    let sonIguales;

    if (tipoResultado === "NUMERICO") {
      const intervalo = obtenerIntervaloResultadoNumerico(valor);
      const valorRegla = Number(regla.valor1);

      if (!intervalo || !Number.isFinite(valorRegla)) {
        throw new Error(
          `La regla de alerta ${regla.descripcion || condicion} no posee un valor numérico válido`,
        );
      }

      sonIguales = intervaloContieneValor(intervalo, valorRegla);
    } else {
      sonIguales =
        normalizarTextoComparacion(valor) ===
        normalizarTextoComparacion(regla.valor1);
    }

    return condicion === "IGUAL_A" ? sonIguales : !sonIguales;
  }

  throw new Error(`Condición de alerta no soportada: ${condicion}`);
};

// ====== Detectar alertas del resultado ======

const detectarAlertasResultado = ({
  solicitud,
  snapshotItem,
  valor,
  fechaDeteccion,
}) => {
  const reglas = obtenerReglasAlertaAplicables({
    solicitud,
    snapshotItem,
  });

  if (reglas.length === 0) {
    return [];
  }

  const alertasDetectadas = [];

  // ====== Evaluar todas las reglas ======

  for (const regla of reglas) {
    const detectada = cumpleCondicionAlerta({
      valor,
      tipoResultado: snapshotItem.tipoResultado,
      regla,
    });

    if (!detectada) {
      continue;
    }

    alertasDetectadas.push({
      descripcion: regla.descripcion ?? "",

      condicion: regla.condicion,

      valor1: regla.valor1 ?? null,

      valor2: regla.valor2 ?? null,

      nivelAlerta: regla.nivelAlerta ?? "ADVERTENCIA",

      mensaje: regla.mensaje ?? "",

      fechaDeteccion: fechaDeteccion ?? new Date(),
    });
  }

  return alertasDetectadas;
};

// ====== Registrar o editar resultado de Item ======

const registrarEditarResultadoItem = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { resultadoLaboratorioId, itemResultadoId } = req.params;

    const { uid, nombreUsuario } = req.user;

    // ====== Validar ids ======

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    if (!mongoose.Types.ObjectId.isValid(itemResultadoId)) {
      throw new Error("El id del Item de resultado no es válido");
    }

    // ====== Validar valor recibido ======

    if (!Object.prototype.hasOwnProperty.call(req.body, "valor")) {
      throw new Error("Debe enviar el valor del resultado");
    }

    const { valor, observacion } = req.body;

    // ====== Obtener resultado ======

    const resultadoLaboratorio = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).session(session);

    if (!resultadoLaboratorio) {
      throw new Error("El resultado de laboratorio no existe");
    }

    // ====== Validar estado general ======

    if (
      ["VALIDADO", "LIBERADO", "ANULADO"].includes(
        resultadoLaboratorio.estadoResultado,
      )
    ) {
      throw new Error(
        `No se puede modificar un resultado en estado ${resultadoLaboratorio.estadoResultado}`,
      );
    }

    // ====== Obtener Item transaccional ======

    const resultadoItem =
      resultadoLaboratorio.resultadosItems.id(itemResultadoId);

    if (!resultadoItem) {
      throw new Error("El Item de resultado no existe");
    }

    if (["VALIDADO", "ANULADO"].includes(resultadoItem.estado)) {
      throw new Error(
        `No se puede modificar un Item en estado ${resultadoItem.estado}`,
      );
    }

    // ====== Obtener solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      resultadoLaboratorio.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se pueden registrar resultados de una solicitud anulada",
      );
    }

    // ====== Validar muestra habilitada ======

    const habilitacionMuestra = await validarCapturaResultadoHabilitada({
      solicitud,
      resultadoLaboratorio,
      session,
    });

    // ====== Resolver configuración histórica ======

    const itemSnapshot = obtenerItemSnapshotResultado({
      solicitud,
      resultadoLaboratorio,
      resultadoItem,
    });

    const snapshotItem = itemSnapshot.snapshotItem;

    // ====== Validar consistencia del tipo ======

    if (resultadoItem.tipoResultado !== snapshotItem.tipoResultado) {
      throw new Error(
        "El tipo de resultado no coincide con el snapshot clínico",
      );
    }

    const ahora = new Date();
    const estadoAnteriorResultado = resultadoLaboratorio.estadoResultado;
    const valorAnterior = resultadoItem.valor;
    const esLimpieza = esValorResultadoVacio(valor);
    const primeraCaptura =
      !resultadoItem.fechaRegistroResultado && !esLimpieza;

    // ====== Registrar o limpiar valor ======

    if (esLimpieza) {
      resultadoItem.valor = null;
      resultadoItem.estado = "PENDIENTE";
      resultadoItem.evaluacionReferencia = {
        estado: "PENDIENTE",
        referenciaAplicada: null,
        mensaje: "",
      };
      resultadoItem.alertasDetectadas = [];
    } else {
      const valorNormalizado = normalizarValorResultado({
        valor,
        tipoResultado: resultadoItem.tipoResultado,
        snapshotItem,
      });

      resultadoItem.valor = valorNormalizado;
      resultadoItem.estado = "REGISTRADO";

      resultadoItem.evaluacionReferencia = evaluarReferenciaResultado({
        solicitud,
        snapshotItem,
        valor: valorNormalizado,
      });

      resultadoItem.alertasDetectadas = detectarAlertasResultado({
        solicitud,
        snapshotItem,
        valor: valorNormalizado,
        fechaDeteccion: ahora,
      });
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "observacion")) {
      resultadoItem.observacion =
        typeof observacion === "string" ? observacion.trim() : "";
    }

    // ====== Trazabilidad ======

    if (primeraCaptura) {
      resultadoItem.registradoPor = uid;
      resultadoItem.usuarioRegistroResultado = nombreUsuario ?? null;
      resultadoItem.fechaRegistroResultado = ahora;
    } else if (
      resultadoItem.fechaRegistroResultado ||
      !esValorResultadoVacio(valorAnterior)
    ) {
      resultadoItem.actualizadoPor = uid;
      resultadoItem.usuarioActualizacionResultado = nombreUsuario ?? null;
      resultadoItem.fechaActualizacionResultado = ahora;
    }

    // ====== Recalcular estado general ======

    resultadoLaboratorio.estadoResultado =
      recalcularEstadoResultado(resultadoLaboratorio);

    // ====== Auditoría ======

    resultadoLaboratorio.updatedBy = uid;

    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaActualizacion = ahora;

    registrarEventoHistorialResultado(resultadoLaboratorio, {
      tipoEvento: primeraCaptura ? "REGISTRO" : "MODIFICACION",
      estadoAnterior: estadoAnteriorResultado,
      estadoNuevo: resultadoLaboratorio.estadoResultado,
      uid,
      nombreUsuario,
      fecha: ahora,
      detalle: primeraCaptura
        ? `Registro del Item ${resultadoItem.nombreInforme}`
        : `Modificación del Item ${resultadoItem.nombreInforme}`,
      metadatos: {
        itemResultadoId: resultadoItem._id,
        codItemLab: resultadoItem.codItemLab,
        nombreInforme: resultadoItem.nombreInforme,
        valorAnterior,
        valorNuevo: resultadoItem.valor,
      },
    });

    // ====== Guardar resultado ======

    await resultadoLaboratorio.save({
      session,
    });

    // ====== Sincronizar estados de solicitud ======

    const estadoOperativo = await sincronizarEstadosSolicitudLaboratorio({
      solicitud,
      uid,
      nombreUsuario,
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg: primeraCaptura
        ? "Resultado del Item registrado correctamente"
        : "Resultado del Item actualizado correctamente",

      estadoResultado: resultadoLaboratorio.estadoResultado,

      estadoUnidadLaboratorio:
        obtenerUnidadLaboratorio({
          solicitud,
          claveUnidad: resultadoLaboratorio.claveUnidad,
        })?.estado ?? null,

      estadoSolicitud: solicitud.estado,

      estadoOperativo,

      habilitacionMuestra,

      item: resultadoItem,

      versionResultado: resultadoLaboratorio.versionResultado,

      historialEventos: resultadoLaboratorio.historialEventos,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al registrar resultado de laboratorio:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo registrar el resultado del Item",

      ...(error.codigo ? { codigo: error.codigo } : {}),

      ...(error.habilitacionMuestra
        ? { habilitacionMuestra: error.habilitacionMuestra }
        : {}),
    });
  } finally {
    await session.endSession();
  }
};

// ====== Registrar resultados masivos ======

const registrarResultadosMasivos = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { resultadoLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    const { items } = req.body;

    // ====== Validar id del resultado ======

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    // ====== Validar payload ======

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Debe enviar al menos un Item de resultado");
    }

    const idsRecibidos = new Set();

    for (const itemRecibido of items) {
      if (
        !itemRecibido ||
        typeof itemRecibido !== "object" ||
        Array.isArray(itemRecibido)
      ) {
        throw new Error("Existe un Item de resultado inválido");
      }

      const { itemResultadoId } = itemRecibido;

      if (!mongoose.Types.ObjectId.isValid(itemResultadoId)) {
        throw new Error(
          `El id del Item de resultado no es válido: ${itemResultadoId}`,
        );
      }

      if (!Object.prototype.hasOwnProperty.call(itemRecibido, "valor")) {
        throw new Error(`Debe enviar el valor del Item ${itemResultadoId}`);
      }

      const claveId = itemResultadoId.toString();

      if (idsRecibidos.has(claveId)) {
        throw new Error(
          `El Item ${itemResultadoId} se encuentra repetido en la solicitud`,
        );
      }

      idsRecibidos.add(claveId);
    }

    // ====== Obtener resultado ======

    const resultadoLaboratorio = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).session(session);

    if (!resultadoLaboratorio) {
      throw new Error("El resultado de laboratorio no existe");
    }

    // ====== Validar estado general ======

    if (
      ["VALIDADO", "LIBERADO", "ANULADO"].includes(
        resultadoLaboratorio.estadoResultado,
      )
    ) {
      throw new Error(
        `No se puede modificar un resultado en estado ${resultadoLaboratorio.estadoResultado}`,
      );
    }

    // ====== Obtener solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      resultadoLaboratorio.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se pueden registrar resultados de una solicitud anulada",
      );
    }

    // ====== Validar muestra habilitada ======

    const habilitacionMuestra = await validarCapturaResultadoHabilitada({
      solicitud,
      resultadoLaboratorio,
      session,
    });

    const ahora = new Date();
    const estadoAnteriorResultado = resultadoLaboratorio.estadoResultado;

    const itemsActualizados = [];
    const trazabilidadItems = [];

    // ====== Procesar Items ======

    for (const itemRecibido of items) {
      const { itemResultadoId, valor, observacion } = itemRecibido;

      // ====== Obtener Item transaccional ======

      const resultadoItem =
        resultadoLaboratorio.resultadosItems.id(itemResultadoId);

      if (!resultadoItem) {
        throw new Error(`El Item de resultado ${itemResultadoId} no existe`);
      }

      if (["VALIDADO", "ANULADO"].includes(resultadoItem.estado)) {
        throw new Error(
          `No se puede modificar el Item ${resultadoItem.nombreInforme} en estado ${resultadoItem.estado}`,
        );
      }

      // ====== Resolver configuración histórica ======

      const itemSnapshot = obtenerItemSnapshotResultado({
        solicitud,
        resultadoLaboratorio,
        resultadoItem,
      });

      const snapshotItem = itemSnapshot.snapshotItem;

      // ====== Validar consistencia del tipo ======

      if (resultadoItem.tipoResultado !== snapshotItem.tipoResultado) {
        throw new Error(
          `El tipo de resultado del Item ${resultadoItem.nombreInforme} no coincide con el snapshot clínico`,
        );
      }

      const valorAnterior = resultadoItem.valor;
      const esLimpieza = esValorResultadoVacio(valor);
      const primeraCaptura =
        !resultadoItem.fechaRegistroResultado && !esLimpieza;

      // ====== Registrar o limpiar valor ======

      if (esLimpieza) {
        resultadoItem.valor = null;
        resultadoItem.estado = "PENDIENTE";
        resultadoItem.evaluacionReferencia = {
          estado: "PENDIENTE",
          referenciaAplicada: null,
          mensaje: "",
        };
        resultadoItem.alertasDetectadas = [];
      } else {
        const valorNormalizado = normalizarValorResultado({
          valor,
          tipoResultado: resultadoItem.tipoResultado,
          snapshotItem,
        });

        resultadoItem.valor = valorNormalizado;
        resultadoItem.estado = "REGISTRADO";

        resultadoItem.evaluacionReferencia = evaluarReferenciaResultado({
          solicitud,
          snapshotItem,
          valor: valorNormalizado,
        });

        resultadoItem.alertasDetectadas = detectarAlertasResultado({
          solicitud,
          snapshotItem,
          valor: valorNormalizado,
          fechaDeteccion: ahora,
        });
      }

      if (Object.prototype.hasOwnProperty.call(itemRecibido, "observacion")) {
        resultadoItem.observacion =
          typeof observacion === "string" ? observacion.trim() : "";
      }

      // ====== Trazabilidad ======

      if (primeraCaptura) {
        resultadoItem.registradoPor = uid;
        resultadoItem.usuarioRegistroResultado = nombreUsuario ?? null;
        resultadoItem.fechaRegistroResultado = ahora;
      } else if (
        resultadoItem.fechaRegistroResultado ||
        !esValorResultadoVacio(valorAnterior)
      ) {
        resultadoItem.actualizadoPor = uid;
        resultadoItem.usuarioActualizacionResultado = nombreUsuario ?? null;
        resultadoItem.fechaActualizacionResultado = ahora;
      }

      itemsActualizados.push(resultadoItem);
      trazabilidadItems.push({
        itemResultadoId: resultadoItem._id,
        codItemLab: resultadoItem.codItemLab,
        nombreInforme: resultadoItem.nombreInforme,
        primeraCaptura,
        valorAnterior,
        valorNuevo: resultadoItem.valor,
      });
    }

    // ====== Recalcular estado general ======

    resultadoLaboratorio.estadoResultado =
      recalcularEstadoResultado(resultadoLaboratorio);

    // ====== Auditoría ======

    resultadoLaboratorio.updatedBy = uid;

    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaActualizacion = ahora;

    registrarEventoHistorialResultado(resultadoLaboratorio, {
      tipoEvento: trazabilidadItems.every((item) => item.primeraCaptura)
        ? "REGISTRO"
        : "MODIFICACION",
      estadoAnterior: estadoAnteriorResultado,
      estadoNuevo: resultadoLaboratorio.estadoResultado,
      uid,
      nombreUsuario,
      fecha: ahora,
      detalle: `Actualización de ${itemsActualizados.length} Item(s) de la prueba`,
      metadatos: { items: trazabilidadItems },
    });

    // ====== Guardar una sola vez ======

    await resultadoLaboratorio.save({
      session,
    });

    // ====== Sincronizar estados de solicitud ======

    const estadoOperativo = await sincronizarEstadosSolicitudLaboratorio({
      solicitud,
      uid,
      nombreUsuario,
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg:
        resultadoLaboratorio.estadoResultado === "COMPLETO"
          ? "Resultados registrados correctamente. El resultado se encuentra COMPLETO"
          : "Resultados registrados correctamente",

      estadoResultado: resultadoLaboratorio.estadoResultado,

      estadoUnidadLaboratorio:
        obtenerUnidadLaboratorio({
          solicitud,
          claveUnidad: resultadoLaboratorio.claveUnidad,
        })?.estado ?? null,

      estadoSolicitud: solicitud.estado,

      estadoOperativo,

      habilitacionMuestra,

      itemsActualizados: itemsActualizados.length,

      items: itemsActualizados,

      versionResultado: resultadoLaboratorio.versionResultado,

      historialEventos: resultadoLaboratorio.historialEventos,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error(
      "Error al registrar resultados masivos de laboratorio:",
      error,
    );

    return res.status(400).json({
      ok: false,

      msg:
        error.message ||
        "No se pudieron registrar los resultados de laboratorio",

      ...(error.codigo ? { codigo: error.codigo } : {}),

      ...(error.habilitacionMuestra
        ? { habilitacionMuestra: error.habilitacionMuestra }
        : {}),
    });
  } finally {
    await session.endSession();
  }
};

// ====== Revisar Items antes de validación ======

const revisarResultadoAntesValidacion = async (req, res = response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { resultadoLaboratorioId } = req.params;
    const { uid, nombreUsuario } = req.user;
    const { items } = req.body ?? {};

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Debe enviar al menos un Item para revisar");
    }

    const resultadoLaboratorio = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).session(session);

    if (!resultadoLaboratorio) {
      throw new Error("El resultado de laboratorio no existe");
    }

    if (resultadoLaboratorio.estadoResultado !== "COMPLETO") {
      throw new Error(
        `Solo se puede modificar el informe durante la validación cuando el resultado está COMPLETO. Estado actual: ${resultadoLaboratorio.estadoResultado}`,
      );
    }

    const solicitud = await SolicitudAtencion.findById(
      resultadoLaboratorio.solicitudAtencionId,
    ).session(session);

    if (!solicitud || solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud de laboratorio asociada no existe");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error("No se puede revisar un resultado de una solicitud anulada");
    }

    const habilitacionMuestra = await validarCapturaResultadoHabilitada({
      solicitud,
      resultadoLaboratorio,
      session,
    });

    const ahora = new Date();
    const trazabilidadItems = [];
    const itemsActualizados = [];
    const idsRecibidos = new Set();

    for (const itemRecibido of items) {
      const itemResultadoId = itemRecibido?.itemResultadoId;

      if (!mongoose.Types.ObjectId.isValid(itemResultadoId)) {
        throw new Error(`El id del Item no es válido: ${itemResultadoId}`);
      }

      if (!Object.prototype.hasOwnProperty.call(itemRecibido, "valor")) {
        throw new Error(`Debe enviar el valor del Item ${itemResultadoId}`);
      }

      if (idsRecibidos.has(String(itemResultadoId))) {
        throw new Error(`El Item ${itemResultadoId} se encuentra repetido`);
      }
      idsRecibidos.add(String(itemResultadoId));

      const resultadoItem = resultadoLaboratorio.resultadosItems.id(
        itemResultadoId,
      );

      if (!resultadoItem) {
        throw new Error(`El Item ${itemResultadoId} no existe`);
      }

      if (
        resultadoItem.estado !== "REGISTRADO" &&
        !(resultadoItem.esOpcional === true && resultadoItem.estado === "PENDIENTE")
      ) {
        throw new Error(
          `El Item ${resultadoItem.nombreInforme} no se encuentra disponible para revisión`,
        );
      }

      const { snapshotItem } = obtenerItemSnapshotResultado({
        solicitud,
        resultadoLaboratorio,
        resultadoItem,
      });

      const valorAnterior = resultadoItem.valor;
      const esLimpieza = esValorResultadoVacio(itemRecibido.valor);

      if (esLimpieza) {
        resultadoItem.valor = null;
        resultadoItem.estado = "PENDIENTE";
        resultadoItem.evaluacionReferencia = {
          estado: "PENDIENTE",
          referenciaAplicada: null,
          mensaje: "",
        };
        resultadoItem.alertasDetectadas = [];
      } else {
        const valorNormalizado = normalizarValorResultado({
          valor: itemRecibido.valor,
          tipoResultado: resultadoItem.tipoResultado,
          snapshotItem,
        });

        resultadoItem.valor = valorNormalizado;
        resultadoItem.estado = "REGISTRADO";
        resultadoItem.evaluacionReferencia = evaluarReferenciaResultado({
          solicitud,
          snapshotItem,
          valor: valorNormalizado,
        });
        resultadoItem.alertasDetectadas = detectarAlertasResultado({
          solicitud,
          snapshotItem,
          valor: valorNormalizado,
          fechaDeteccion: ahora,
        });
      }

      if (Object.prototype.hasOwnProperty.call(itemRecibido, "observacion")) {
        resultadoItem.observacion =
          typeof itemRecibido.observacion === "string"
            ? itemRecibido.observacion.trim()
            : "";
      }

      resultadoItem.actualizadoPor = uid;
      resultadoItem.usuarioActualizacionResultado = nombreUsuario ?? null;
      resultadoItem.fechaActualizacionResultado = ahora;

      trazabilidadItems.push({
        itemResultadoId: resultadoItem._id,
        codItemLab: resultadoItem.codItemLab,
        nombreInforme: resultadoItem.nombreInforme,
        valorAnterior,
        valorNuevo: resultadoItem.valor,
      });
      itemsActualizados.push(resultadoItem);
    }

    resultadoLaboratorio.estadoResultado =
      recalcularEstadoResultado(resultadoLaboratorio);

    resultadoLaboratorio.updatedBy = uid;
    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;
    resultadoLaboratorio.fechaActualizacion = ahora;

    registrarEventoHistorialResultado(resultadoLaboratorio, {
      tipoEvento: "REVISION_VALIDACION",
      estadoAnterior: "COMPLETO",
      estadoNuevo: resultadoLaboratorio.estadoResultado,
      uid,
      nombreUsuario,
      fecha: ahora,
      detalle: `Revisión previa a validación de ${itemsActualizados.length} Item(s)`,
      metadatos: { items: trazabilidadItems },
    });

    await resultadoLaboratorio.save({ session });

    const estadoOperativo = await sincronizarEstadosSolicitudLaboratorio({
      solicitud,
      uid,
      nombreUsuario,
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,
      msg: "Informe actualizado durante la revisión de validación",
      estadoResultado: resultadoLaboratorio.estadoResultado,
      estadoUnidadLaboratorio:
        obtenerUnidadLaboratorio({
          solicitud,
          claveUnidad: resultadoLaboratorio.claveUnidad,
        })?.estado ?? null,
      estadoSolicitud: solicitud.estado,
      estadoOperativo,
      habilitacionMuestra,
      itemsActualizados: itemsActualizados.length,
      items: itemsActualizados,
      versionResultado: resultadoLaboratorio.versionResultado,
      historialEventos: resultadoLaboratorio.historialEventos,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al revisar resultado antes de validar:", error);

    return res.status(error.statusCode ?? 400).json({
      ok: false,
      msg: error.message || "No se pudo actualizar el informe durante la validación",
      ...(error.codigo ? { codigo: error.codigo } : {}),
      ...(error.habilitacionMuestra
        ? { habilitacionMuestra: error.habilitacionMuestra }
        : {}),
    });
  } finally {
    await session.endSession();
  }
};

// ====== Validar varios resultados completos ======

const validarResultadosMasivamente = async (req, res = response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { uid, nombreUsuario } = req.user;
    const {
      resultadoIds,
      observacionValidacion,
      confirmarAlertasCriticas,
    } = req.body ?? {};

    if (!Array.isArray(resultadoIds) || resultadoIds.length === 0) {
      throw new Error("Debe indicar al menos un resultado para validar");
    }

    const ids = [...new Set(resultadoIds.map((id) => String(id ?? "")))];

    if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      throw new Error("Existe un id de resultado no válido");
    }

    if (
      observacionValidacion !== undefined &&
      typeof observacionValidacion !== "string"
    ) {
      throw new Error("La observación de validación debe ser un texto");
    }

    const resultados = await ResultadoLaboratorio.find({
      _id: { $in: ids },
    }).session(session);

    if (resultados.length !== ids.length) {
      throw new Error("No se encontraron todos los resultados solicitados");
    }

    const solicitudIds = new Set(
      resultados.map((resultado) => String(resultado.solicitudAtencionId)),
    );

    if (solicitudIds.size !== 1) {
      throw new Error("La validación masiva solo admite resultados de una misma solicitud");
    }

    const solicitud = await SolicitudAtencion.findById(
      resultados[0].solicitudAtencionId,
    ).session(session);

    if (!solicitud || solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud de laboratorio asociada no existe");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error("No se pueden validar resultados de una solicitud anulada");
    }

    const alertas = [];

    for (const resultado of resultados) {
      if (resultado.estadoResultado !== "COMPLETO") {
        throw new Error(
          `${resultado.codPruebaLab} - ${resultado.nombrePruebaLab} no se encuentra COMPLETO`,
        );
      }

      const items = Array.isArray(resultado.resultadosItems)
        ? resultado.resultadosItems
        : [];

      if (
        items.length === 0 ||
        items.some(
          (item) =>
            item.esOpcional !== true && item.estado !== "REGISTRADO",
        )
      ) {
        throw new Error(
          `${resultado.codPruebaLab} - ${resultado.nombrePruebaLab} posee Items obligatorios pendientes de registro`,
        );
      }

      if (
        items.some(
          (item) =>
            (item.esOpcional !== true || item.estado === "REGISTRADO") &&
            (!item.evaluacionReferencia ||
              item.evaluacionReferencia.estado === "PENDIENTE"),
        )
      ) {
        throw new Error(
          `${resultado.codPruebaLab} - ${resultado.nombrePruebaLab} posee evaluación clínica pendiente`,
        );
      }

      for (const item of items) {
        alertas.push(
          ...(Array.isArray(item.alertasDetectadas)
            ? item.alertasDetectadas
            : []),
        );
      }
    }

    const resumenAlertas = {
      total: alertas.length,
      informativas: alertas.filter(
        (alerta) => alerta.nivelAlerta === "INFORMATIVA",
      ).length,
      advertencias: alertas.filter(
        (alerta) => alerta.nivelAlerta === "ADVERTENCIA",
      ).length,
      criticas: alertas.filter((alerta) => alerta.nivelAlerta === "CRITICA")
        .length,
    };

    if (resumenAlertas.criticas > 0 && confirmarAlertasCriticas !== true) {
      const error = new Error(
        "Debe confirmar explícitamente la revisión de las alertas críticas antes de validar los resultados",
      );
      error.statusCode = 409;
      error.codigo = "CONFIRMACION_ALERTAS_CRITICAS_REQUERIDA";
      throw error;
    }

    const ahora = new Date();
    const observacion =
      typeof observacionValidacion === "string"
        ? observacionValidacion.trim()
        : "";

    for (const resultado of resultados) {
      for (const item of resultado.resultadosItems ?? []) {
        item.estado = "VALIDADO";
      }

      resultado.estadoResultado = "VALIDADO";
      resultado.validadoPor = uid;
      resultado.usuarioValidacion = nombreUsuario ?? null;
      resultado.fechaValidacion = ahora;
      resultado.observacionValidacion = observacion;
      resultado.confirmoAlertasCriticasValidacion =
        resumenAlertas.criticas > 0 && confirmarAlertasCriticas === true;
      resultado.updatedBy = uid;
      resultado.usuarioActualizacion = nombreUsuario ?? null;
      resultado.fechaActualizacion = ahora;

      registrarEventoHistorialResultado(resultado, {
        tipoEvento: "VALIDACION",
        estadoAnterior: "COMPLETO",
        estadoNuevo: "VALIDADO",
        uid,
        nombreUsuario,
        fecha: ahora,
        detalle: observacion
          ? `Resultado validado masivamente. Observación: ${observacion}`
          : "Resultado validado masivamente",
        metadatos: {
          validacionMasiva: true,
          confirmoAlertasCriticas:
            resultado.confirmoAlertasCriticasValidacion === true,
        },
      });

      await resultado.save({ session });
    }

    const estadoOperativo = await sincronizarEstadosSolicitudLaboratorio({
      solicitud,
      uid,
      nombreUsuario,
      session,
    });

    await session.commitTransaction();

    const resultadosOrdenados = ids.map((id) =>
      resultados.find((resultado) => String(resultado._id) === id),
    );

    return res.status(200).json({
      ok: true,
      msg: `${resultados.length} resultado(s) validado(s) correctamente`,
      estadoSolicitud: solicitud.estado,
      estadoOperativo,
      resumenAlertas,
      resultados: resultadosOrdenados,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al validar resultados masivamente:", error);

    return res.status(error.statusCode ?? 400).json({
      ok: false,
      msg: error.message || "No se pudieron validar los resultados",
      ...(error.codigo ? { codigo: error.codigo } : {}),
    });
  } finally {
    await session.endSession();
  }
};

// ====== Validar resultado de laboratorio ======

const validarResultadoLaboratorio = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { resultadoLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    const observacionValidacion = req.body?.observacionValidacion;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    // ====== Validar observación ======

    if (
      observacionValidacion !== undefined &&
      typeof observacionValidacion !== "string"
    ) {
      throw new Error("La observación de validación debe ser un texto");
    }

    // ====== Obtener resultado ======

    const resultadoLaboratorio = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).session(session);

    if (!resultadoLaboratorio) {
      throw new Error("El resultado de laboratorio no existe");
    }

    // ====== Validar estado general ======

    if (resultadoLaboratorio.estadoResultado !== "COMPLETO") {
      throw new Error(
        `Solo se puede validar un resultado en estado COMPLETO. Estado actual: ${resultadoLaboratorio.estadoResultado}`,
      );
    }

    // ====== Validar Items ======

    const items = Array.isArray(resultadoLaboratorio.resultadosItems)
      ? resultadoLaboratorio.resultadosItems
      : [];

    if (items.length === 0) {
      throw new Error("El resultado no contiene Items para validar");
    }

    // ====== Validar registro completo ======

    const itemsNoRegistrados = items.filter(
      (item) =>
        item.esOpcional !== true && item.estado !== "REGISTRADO",
    );

    if (itemsNoRegistrados.length > 0) {
      const nombres = itemsNoRegistrados
        .map((item) => item.nombreInforme)
        .join(", ");

      throw new Error(
        `Existen Items que no se encuentran REGISTRADOS: ${nombres}`,
      );
    }

    // ====== Validar evaluación clínica ======

    const itemsEvaluacionPendiente = items.filter(
      (item) =>
        (item.esOpcional !== true || item.estado === "REGISTRADO") &&
        (!item.evaluacionReferencia ||
          item.evaluacionReferencia.estado === "PENDIENTE"),
    );

    if (itemsEvaluacionPendiente.length > 0) {
      const nombres = itemsEvaluacionPendiente
        .map((item) => item.nombreInforme)
        .join(", ");

      throw new Error(
        `Existen Items con evaluación clínica pendiente: ${nombres}`,
      );
    }

    // ====== Obtener solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      resultadoLaboratorio.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se puede validar un resultado de una solicitud anulada",
      );
    }

    const ahora = new Date();

    // ====== Validar Items ======

    for (const item of items) {
      item.estado = "VALIDADO";
    }

    // ====== Validar resultado general ======

    resultadoLaboratorio.estadoResultado = "VALIDADO";

    resultadoLaboratorio.validadoPor = uid;

    resultadoLaboratorio.usuarioValidacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaValidacion = ahora;

    resultadoLaboratorio.observacionValidacion =
      typeof observacionValidacion === "string"
        ? observacionValidacion.trim()
        : "";

    // ====== Auditoría ======

    resultadoLaboratorio.updatedBy = uid;

    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaActualizacion = ahora;

    // ====== Resumen de alertas ======

    const alertasDetectadas = items.flatMap((item) =>
      Array.isArray(item.alertasDetectadas) ? item.alertasDetectadas : [],
    );

    const resumenAlertas = {
      total: alertasDetectadas.length,

      informativas: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "INFORMATIVA",
      ).length,

      advertencias: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "ADVERTENCIA",
      ).length,

      criticas: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "CRITICA",
      ).length,
    };

    resultadoLaboratorio.confirmoAlertasCriticasValidacion =
      resumenAlertas.criticas > 0 && req.body?.confirmarAlertasCriticas === true;

    registrarEventoHistorialResultado(resultadoLaboratorio, {
      tipoEvento: "VALIDACION",
      estadoAnterior: "COMPLETO",
      estadoNuevo: "VALIDADO",
      uid,
      nombreUsuario,
      fecha: ahora,
      detalle: resultadoLaboratorio.observacionValidacion
        ? `Resultado validado. Observación: ${resultadoLaboratorio.observacionValidacion}`
        : "Resultado validado",
      metadatos: {
        confirmoAlertasCriticas:
          resultadoLaboratorio.confirmoAlertasCriticasValidacion === true,
      },
    });

    // ====== Guardar ======

    await resultadoLaboratorio.save({
      session,
    });

    // ====== Sincronizar estados de solicitud ======

    const estadoOperativo = await sincronizarEstadosSolicitudLaboratorio({
      solicitud,
      uid,
      nombreUsuario,
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg:
        resumenAlertas.criticas > 0
          ? "Resultado validado correctamente. Existen alertas críticas detectadas"
          : "Resultado de laboratorio validado correctamente",

      estadoResultado: resultadoLaboratorio.estadoResultado,

      estadoUnidadLaboratorio:
        obtenerUnidadLaboratorio({
          solicitud,
          claveUnidad: resultadoLaboratorio.claveUnidad,
        })?.estado ?? null,

      estadoSolicitud: solicitud.estado,

      estadoOperativo,

      resumenAlertas,

      resultado: resultadoLaboratorio,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al validar resultado de laboratorio:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo validar el resultado de laboratorio",
    });
  } finally {
    await session.endSession();
  }
};

// ====== Liberar varios resultados validados ======

const liberarResultadosMasivamente = async (req, res = response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { uid, nombreUsuario } = req.user;
    const { resultadoIds, confirmarAlertasCriticas } = req.body ?? {};

    if (!Array.isArray(resultadoIds) || resultadoIds.length === 0) {
      throw new Error("Debe indicar al menos un resultado para liberar");
    }

    const ids = [...new Set(resultadoIds.map((id) => String(id ?? "")))];

    if (ids.length > 500) {
      throw new Error(
        "No se pueden liberar más de 500 resultados en una sola operación masiva",
      );
    }

    if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      throw new Error("Existe un id de resultado no válido");
    }

    const resultados = await ResultadoLaboratorio.find({
      _id: { $in: ids },
    }).session(session);

    if (resultados.length !== ids.length) {
      throw new Error("No se encontraron todos los resultados solicitados");
    }

    const solicitudIds = [
      ...new Set(
        resultados.map((resultado) => String(resultado.solicitudAtencionId)),
      ),
    ];

    const solicitudes = await SolicitudAtencion.find({
      _id: { $in: solicitudIds },
    }).session(session);

    if (solicitudes.length !== solicitudIds.length) {
      throw new Error("No se encontraron todas las solicitudes asociadas");
    }

    const solicitudesPorId = new Map(
      solicitudes.map((solicitud) => [String(solicitud._id), solicitud]),
    );

    for (const solicitud of solicitudes) {
      if (solicitud.tipo !== "Laboratorio") {
        throw new Error(
          `La solicitud ${solicitud.codSolicitud} no corresponde a Laboratorio`,
        );
      }

      if (solicitud.estado === "ANULADO") {
        throw new Error(
          `No se pueden liberar resultados de la solicitud anulada ${solicitud.codSolicitud}`,
        );
      }
    }

    const alertas = [];

    for (const resultado of resultados) {
      if (resultado.estadoResultado !== "VALIDADO") {
        throw new Error(
          `${resultado.codPruebaLab} - ${resultado.nombrePruebaLab} no se encuentra VALIDADO`,
        );
      }

      const items = Array.isArray(resultado.resultadosItems)
        ? resultado.resultadosItems
        : [];

      if (items.length === 0) {
        throw new Error(
          `${resultado.codPruebaLab} - ${resultado.nombrePruebaLab} no contiene Items para liberar`,
        );
      }

      const itemsNoValidados = items.filter(
        (item) => item.estado !== "VALIDADO",
      );

      if (itemsNoValidados.length > 0) {
        throw new Error(
          `${resultado.codPruebaLab} - ${resultado.nombrePruebaLab} posee Items que no se encuentran VALIDADOS`,
        );
      }

      if (!resultado.validadoPor || !resultado.fechaValidacion) {
        throw new Error(
          `${resultado.codPruebaLab} - ${resultado.nombrePruebaLab} no posee trazabilidad de validación completa`,
        );
      }

      if (!solicitudesPorId.has(String(resultado.solicitudAtencionId))) {
        throw new Error("La solicitud asociada al resultado no existe");
      }

      for (const item of items) {
        alertas.push(
          ...(Array.isArray(item.alertasDetectadas)
            ? item.alertasDetectadas
            : []),
        );
      }
    }

    const resumenAlertas = {
      total: alertas.length,
      informativas: alertas.filter(
        (alerta) => alerta.nivelAlerta === "INFORMATIVA",
      ).length,
      advertencias: alertas.filter(
        (alerta) => alerta.nivelAlerta === "ADVERTENCIA",
      ).length,
      criticas: alertas.filter((alerta) => alerta.nivelAlerta === "CRITICA")
        .length,
    };

    if (resumenAlertas.criticas > 0 && confirmarAlertasCriticas !== true) {
      const error = new Error(
        "Debe confirmar explícitamente la revisión de las alertas críticas antes de liberar los resultados",
      );
      error.statusCode = 409;
      error.codigo = "CONFIRMACION_ALERTAS_CRITICAS_REQUERIDA";
      throw error;
    }

    const ahora = new Date();

    for (const resultado of resultados) {
      const alertasResultado = (resultado.resultadosItems ?? []).flatMap(
        (item) =>
          Array.isArray(item.alertasDetectadas) ? item.alertasDetectadas : [],
      );
      const criticasResultado = alertasResultado.filter(
        (alerta) => alerta.nivelAlerta === "CRITICA",
      ).length;

      resultado.estadoResultado = "LIBERADO";
      resultado.liberadoPor = uid;
      resultado.usuarioLiberacion = nombreUsuario ?? null;
      resultado.fechaLiberacion = ahora;
      resultado.confirmoAlertasCriticasLiberacion =
        criticasResultado > 0 && confirmarAlertasCriticas === true;
      resultado.updatedBy = uid;
      resultado.usuarioActualizacion = nombreUsuario ?? null;
      resultado.fechaActualizacion = ahora;

      registrarEventoHistorialResultado(resultado, {
        tipoEvento: "LIBERACION",
        estadoAnterior: "VALIDADO",
        estadoNuevo: "LIBERADO",
        uid,
        nombreUsuario,
        fecha: ahora,
        detalle: "Resultado liberado masivamente para visualización o entrega",
        metadatos: {
          liberacionMasiva: true,
          confirmoAlertasCriticas:
            resultado.confirmoAlertasCriticasLiberacion === true,
        },
      });

      await resultado.save({ session });
    }

    const estadosSolicitudes = [];

    for (const solicitud of solicitudes) {
      const estadoOperativo = await sincronizarEstadosSolicitudLaboratorio({
        solicitud,
        uid,
        nombreUsuario,
        session,
      });

      estadosSolicitudes.push({
        solicitudAtencionId: String(solicitud._id),
        codSolicitud: solicitud.codSolicitud,
        estadoSolicitud: solicitud.estado,
        estadoOperativo,
      });
    }

    await session.commitTransaction();

    const resultadosOrdenados = ids.map((id) =>
      resultados.find((resultado) => String(resultado._id) === id),
    );

    return res.status(200).json({
      ok: true,
      msg: `${resultados.length} resultado(s) liberado(s) correctamente`,
      resumen: {
        totalSolicitados: ids.length,
        liberados: resultados.length,
        solicitudesAfectadas: solicitudes.length,
        alertas: resumenAlertas,
      },
      solicitudes: estadosSolicitudes,
      resultados: resultadosOrdenados,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al liberar resultados masivamente:", error);

    return res.status(error.statusCode ?? 400).json({
      ok: false,
      msg: error.message || "No se pudieron liberar los resultados",
      ...(error.codigo ? { codigo: error.codigo } : {}),
    });
  } finally {
    await session.endSession();
  }
};

// ====== Liberar resultado de laboratorio ======

const liberarResultadoLaboratorio = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { resultadoLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    // ====== Obtener resultado ======

    const resultadoLaboratorio = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).session(session);

    if (!resultadoLaboratorio) {
      throw new Error("El resultado de laboratorio no existe");
    }

    // ====== Validar estado general ======

    if (resultadoLaboratorio.estadoResultado !== "VALIDADO") {
      throw new Error(
        `Solo se puede liberar un resultado en estado VALIDADO. Estado actual: ${resultadoLaboratorio.estadoResultado}`,
      );
    }

    // ====== Validar Items ======

    const items = Array.isArray(resultadoLaboratorio.resultadosItems)
      ? resultadoLaboratorio.resultadosItems
      : [];

    if (items.length === 0) {
      throw new Error("El resultado no contiene Items para liberar");
    }

    const itemsNoValidados = items.filter((item) => item.estado !== "VALIDADO");

    if (itemsNoValidados.length > 0) {
      const nombres = itemsNoValidados
        .map((item) => item.nombreInforme)
        .join(", ");

      throw new Error(
        `Existen Items que no se encuentran VALIDADOS: ${nombres}`,
      );
    }

    // ====== Validar trazabilidad de validación ======

    if (
      !resultadoLaboratorio.validadoPor ||
      !resultadoLaboratorio.fechaValidacion
    ) {
      throw new Error(
        "El resultado no posee trazabilidad de validación completa",
      );
    }

    // ====== Obtener solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      resultadoLaboratorio.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se puede liberar un resultado de una solicitud anulada",
      );
    }

    const ahora = new Date();

    // ====== Liberar resultado ======

    resultadoLaboratorio.estadoResultado = "LIBERADO";

    resultadoLaboratorio.liberadoPor = uid;

    resultadoLaboratorio.usuarioLiberacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaLiberacion = ahora;

    // ====== Auditoría ======

    resultadoLaboratorio.updatedBy = uid;

    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaActualizacion = ahora;

    // ====== Resumen de alertas ======

    const alertasDetectadas = items.flatMap((item) =>
      Array.isArray(item.alertasDetectadas) ? item.alertasDetectadas : [],
    );

    const resumenAlertas = {
      total: alertasDetectadas.length,

      informativas: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "INFORMATIVA",
      ).length,

      advertencias: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "ADVERTENCIA",
      ).length,

      criticas: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "CRITICA",
      ).length,
    };

    resultadoLaboratorio.confirmoAlertasCriticasLiberacion =
      resumenAlertas.criticas > 0 && req.body?.confirmarAlertasCriticas === true;

    registrarEventoHistorialResultado(resultadoLaboratorio, {
      tipoEvento: "LIBERACION",
      estadoAnterior: "VALIDADO",
      estadoNuevo: "LIBERADO",
      uid,
      nombreUsuario,
      fecha: ahora,
      detalle: "Resultado liberado para visualización o entrega",
      metadatos: {
        confirmoAlertasCriticas:
          resultadoLaboratorio.confirmoAlertasCriticasLiberacion === true,
      },
    });

    // ====== Guardar ======

    await resultadoLaboratorio.save({
      session,
    });

    // ====== Sincronizar estados de solicitud ======

    const estadoOperativo = await sincronizarEstadosSolicitudLaboratorio({
      solicitud,
      uid,
      nombreUsuario,
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg:
        resumenAlertas.criticas > 0
          ? "Resultado liberado correctamente. Existen alertas críticas detectadas"
          : "Resultado de laboratorio liberado correctamente",

      estadoResultado: resultadoLaboratorio.estadoResultado,

      estadoUnidadLaboratorio:
        obtenerUnidadLaboratorio({
          solicitud,
          claveUnidad: resultadoLaboratorio.claveUnidad,
        })?.estado ?? null,

      estadoSolicitud: solicitud.estado,

      estadoOperativo,

      resumenAlertas,

      resultado: resultadoLaboratorio,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al liberar resultado de laboratorio:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo liberar el resultado de laboratorio",
    });
  } finally {
    await session.endSession();
  }
};

// ====== Anular resultado de laboratorio ======

const anularResultadoLaboratorio = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { resultadoLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    const { motivoAnulacion } = req.body;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    // ====== Validar motivo ======

    if (typeof motivoAnulacion !== "string" || !motivoAnulacion.trim()) {
      throw new Error("El motivo de anulación es obligatorio");
    }

    // ====== Obtener resultado ======

    const resultadoLaboratorio = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).session(session);

    if (!resultadoLaboratorio) {
      throw new Error("El resultado de laboratorio no existe");
    }

    // ====== Validar estado actual ======

    if (resultadoLaboratorio.estadoResultado === "ANULADO") {
      throw new Error("El resultado de laboratorio ya se encuentra ANULADO");
    }

    const estadosPermitidos = [
      "PENDIENTE",
      "EN PROCESO",
      "COMPLETO",
      "VALIDADO",
      "LIBERADO",
    ];

    if (!estadosPermitidos.includes(resultadoLaboratorio.estadoResultado)) {
      throw new Error(
        `No se puede anular un resultado en estado ${resultadoLaboratorio.estadoResultado}`,
      );
    }

    // ====== Obtener solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      resultadoLaboratorio.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    const ahora = new Date();

    // ====== Conservar estado previo ======

    resultadoLaboratorio.estadoPrevioAnulacion =
      resultadoLaboratorio.estadoResultado;

    // ====== Anular resultado ======

    resultadoLaboratorio.estadoResultado = "ANULADO";

    resultadoLaboratorio.anuladoPor = uid;

    resultadoLaboratorio.usuarioAnulacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaAnulacion = ahora;

    resultadoLaboratorio.motivoAnulacion = motivoAnulacion.trim();

    // ====== Auditoría ======

    resultadoLaboratorio.updatedBy = uid;

    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaActualizacion = ahora;

    // ====== Guardar ======

    await resultadoLaboratorio.save({
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg: "Resultado de laboratorio anulado correctamente",

      estadoPrevioAnulacion: resultadoLaboratorio.estadoPrevioAnulacion,

      estadoResultado: resultadoLaboratorio.estadoResultado,

      motivoAnulacion: resultadoLaboratorio.motivoAnulacion,

      resultado: resultadoLaboratorio,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al anular resultado de laboratorio:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo anular el resultado de laboratorio",
    });
  } finally {
    await session.endSession();
  }
};


// ====== Obtener bandeja de Gestión de Resultados ======

const obtenerBandejaResultadosLaboratorio = async (req, res = response) => {
  try {
    const { fechaInicio, fechaFin, terminoBusqueda } = req.query;
    const { uid, nombreUsuario } = req.user;

    // ====== Validar fechas ======

    if (!fechaInicio || !fechaFin) {
      throw new Error("Debe indicar la fecha de inicio y la fecha fin");
    }

    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);

    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      throw new Error("El rango de fechas no es válido");
    }

    if (inicio.getTime() > fin.getTime()) {
      throw new Error("La fecha de inicio no puede ser mayor que la fecha fin");
    }

    // ====== Construir filtro ======

    const filtroSolicitud = {
      tipo: "Laboratorio",
      fechaEmision: {
        $gte: inicio,
        $lte: fin,
      },
    };

    const terminoNormalizado = String(terminoBusqueda ?? "").trim();

    if (terminoNormalizado) {
      const regex = new RegExp(escaparRegex(terminoNormalizado), "i");

      filtroSolicitud.$or = [
        { codigoLaboratorio: regex },
        { codSolicitud: regex },
        { hc: regex },
        { tipoDoc: regex },
        { nroDoc: regex },
        { nombreCliente: regex },
        { apePatCliente: regex },
        { apeMatCliente: regex },
        { codProgramacion: regex },
        { razonSocialEmpresa: regex },
        { codProtocolo: regex },
        { nombreProtocolo: regex },
      ];
    }

    // ====== Obtener solicitudes ======

    const solicitudes = await SolicitudAtencion.find(filtroSolicitud)
      .select(
        [
          "_id",
          "codSolicitud",
          "codigoLaboratorio",
          "origenAtencion",
          "tipo",
          "estado",
          "fechaEmision",
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
          "unidadesLaboratorio",
        ].join(" "),
      )
      .populate({
        path: "programacionEmpresaId",
        select: [
          "_id",
          "codProgramacion",
          "empresaId",
          "rucEmpresa",
          "razonSocialEmpresa",
          "pacienteId",
          "hc",
          "tipoDoc",
          "nroDoc",
          "nombreCliente",
          "apePatCliente",
          "apeMatCliente",
          "sede",
          "prioridad",
          "tipoEvaluacion",
          "tipoAtencion",
          "estadoProgramacion",
          "codProtocolo",
          "nombreProtocolo",
        ].join(" "),
      })
      .sort({
        fechaEmision: -1,
        codSolicitud: -1,
      })
      .lean();

    const solicitudIds = solicitudes.map((solicitud) => solicitud._id);

    // ====== Cargar muestras y claves de resultados ======

    const [muestras, resultadosExistentes] =
      solicitudIds.length > 0
        ? await Promise.all([
            MuestraLaboratorio.find({
              solicitudAtencionId: {
                $in: solicitudIds,
              },
            })
              .select(
                [
                  "_id",
                  "solicitudAtencionId",
                  "claveMuestraPlan",
                  "numeroRecipiente",
                  "numeroIntento",
                  "muestraAnteriorId",
                  "estadoMuestra",
                  "codMuestra",
                  "codigoEtiqueta",
                  "createdAt",
                  "coberturas.claveUnidad",
                ].join(" "),
              )
              .lean(),
            ResultadoLaboratorio.find({
              solicitudAtencionId: {
                $in: solicitudIds,
              },
            })
              .select("_id solicitudAtencionId claveUnidad")
              .lean(),
          ])
        : [[], []];

    // ====== Inicializar resultados faltantes en bloque ======

    const clavesResultado = new Set(
      resultadosExistentes.map(
        (resultado) =>
          `${resultado.solicitudAtencionId.toString()}:${resultado.claveUnidad}`,
      ),
    );

    const operacionesInicializacion = [];

    for (const solicitud of solicitudes) {
      if (solicitud.estado === "ANULADO") {
        continue;
      }

      const unidades = Array.isArray(solicitud.unidadesLaboratorio)
        ? solicitud.unidadesLaboratorio
        : [];

      for (const unidad of unidades) {
        if (unidad.estado === "ANULADO" || !unidad.snapshotClinico) {
          continue;
        }

        const claveResultado =
          `${solicitud._id.toString()}:` + `${unidad.claveUnidad}`;

        if (clavesResultado.has(claveResultado)) {
          continue;
        }

        const datosResultado = construirResultadoDesdeUnidad({
          solicitud,
          unidad,
          uid,
          nombreUsuario,
        });

        const documento = new ResultadoLaboratorio(datosResultado);
        const errorValidacion = documento.validateSync();

        if (errorValidacion) {
          throw errorValidacion;
        }

        operacionesInicializacion.push({
          updateOne: {
            filter: {
              solicitudAtencionId: solicitud._id,
              claveUnidad: unidad.claveUnidad,
            },
            update: {
              $setOnInsert: documento.toObject({
                depopulate: true,
                versionKey: false,
              }),
            },
            upsert: true,
          },
        });

        clavesResultado.add(claveResultado);
      }
    }

    if (operacionesInicializacion.length > 0) {
      try {
        await ResultadoLaboratorio.bulkWrite(operacionesInicializacion, {
          ordered: false,
        });
      } catch (error) {
        // ====== Tolerar carrera de inicialización ======

        if (error?.code !== 11000) {
          throw error;
        }
      }
    }

    // ====== Cargar detalle completo una sola vez ======

    const resultados =
      solicitudIds.length > 0
        ? await ResultadoLaboratorio.find({
            solicitudAtencionId: {
              $in: solicitudIds,
            },
          })
            .sort({
              solicitudAtencionId: 1,
              numeroInstancia: 1,
              createdAt: 1,
            })
            .lean()
        : [];

    // ====== Agrupar datos por solicitud ======

    const muestrasPorSolicitud = new Map();
    const resultadosPorSolicitud = new Map();

    muestras.forEach((muestra) => {
      const clave = muestra.solicitudAtencionId.toString();

      if (!muestrasPorSolicitud.has(clave)) {
        muestrasPorSolicitud.set(clave, []);
      }

      muestrasPorSolicitud.get(clave).push(muestra);
    });

    resultados.forEach((resultado) => {
      const clave = resultado.solicitudAtencionId.toString();

      if (!resultadosPorSolicitud.has(clave)) {
        resultadosPorSolicitud.set(clave, []);
      }

      resultadosPorSolicitud.get(clave).push(resultado);
    });

    // ====== Construir bandeja con detalle precargado ======

    const bandeja = [];

    for (const solicitud of solicitudes) {
      const claveSolicitud = solicitud._id.toString();
      const muestrasSolicitud = muestrasPorSolicitud.get(claveSolicitud) ?? [];
      const resultadosSolicitud =
        resultadosPorSolicitud.get(claveSolicitud) ?? [];

      const estadoOperativo = construirEstadoOperativoLaboratorio({
        solicitud,
        muestras: muestrasSolicitud,
        resultados: resultadosSolicitud,
      });

      const resultadosConHabilitacion =
        await adjuntarHabilitacionMuestraResultados({
          solicitud,
          resultados: resultadosSolicitud,
          muestrasSolicitud,
        });

      const unidadesActivas = Array.isArray(solicitud.unidadesLaboratorio)
        ? solicitud.unidadesLaboratorio.filter(
            (unidad) => unidad.estado !== "ANULADO",
          )
        : [];

      const clavesResultadosSolicitud = new Set(
        resultadosSolicitud.map((resultado) => resultado.claveUnidad),
      );

      const inicializados = unidadesActivas.every((unidad) =>
        clavesResultadosSolicitud.has(unidad.claveUnidad),
      );

      const esEmpresa = solicitud.origenAtencion === "EMPRESA";
      const programacion =
        esEmpresa &&
        solicitud.programacionEmpresaId &&
        typeof solicitud.programacionEmpresaId === "object"
          ? solicitud.programacionEmpresaId
          : null;
      const pacienteOrigen = esEmpresa && programacion ? programacion : solicitud;

      bandeja.push({
        solicitud: {
          _id: solicitud._id,
          codSolicitud: solicitud.codSolicitud,
          codigoLaboratorio: solicitud.codigoLaboratorio ?? null,
          origenAtencion: solicitud.origenAtencion,
          tipo: solicitud.tipo,
          estado: solicitud.estado,
          estadoOperativo,
          fechaEmision: solicitud.fechaEmision,
          paciente: {
            hc: pacienteOrigen.hc ?? solicitud.hc ?? null,
            clienteId:
              obtenerId(solicitud.clienteId) ??
              obtenerId(programacion?.pacienteId) ??
              null,
            tipoDoc: pacienteOrigen.tipoDoc ?? solicitud.tipoDoc ?? null,
            nroDoc: pacienteOrigen.nroDoc ?? solicitud.nroDoc ?? null,
            nombreCliente:
              pacienteOrigen.nombreCliente ?? solicitud.nombreCliente ?? "",
            apePatCliente:
              pacienteOrigen.apePatCliente ?? solicitud.apePatCliente ?? "",
            apeMatCliente:
              pacienteOrigen.apeMatCliente ?? solicitud.apeMatCliente ?? "",
            sexoPaciente: solicitud.sexoPaciente ?? null,
            fechaNacimientoPaciente: solicitud.fechaNacimientoPaciente ?? null,
          },
          empresa: esEmpresa
            ? {
                programacionEmpresaId: obtenerId(solicitud.programacionEmpresaId),
                codProgramacion:
                  programacion?.codProgramacion ??
                  solicitud.codProgramacion ??
                  null,
                codProtocolo:
                  programacion?.codProtocolo ??
                  solicitud.codProtocolo ??
                  null,
                nombreProtocolo:
                  programacion?.nombreProtocolo ??
                  solicitud.nombreProtocolo ??
                  null,
                empresaId:
                  obtenerId(programacion?.empresaId) ??
                  obtenerId(solicitud.empresaId) ??
                  null,
                rucEmpresa: programacion?.rucEmpresa ?? null,
                razonSocialEmpresa:
                  programacion?.razonSocialEmpresa ??
                  solicitud.razonSocialEmpresa ??
                  "",
                sede: programacion?.sede ?? null,
                prioridad: programacion?.prioridad ?? null,
                tipoEvaluacion: programacion?.tipoEvaluacion ?? null,
                tipoAtencion: programacion?.tipoAtencion ?? null,
                estadoProgramacion: programacion?.estadoProgramacion ?? null,
              }
            : null,
        },
        resultados: {
          inicializados,
          totalDocumentos: resultadosSolicitud.length,
          resumen: estadoOperativo.resumen?.resultados ?? null,
          detalle: resultadosConHabilitacion,
        },
      });
    }

    const resumen = {
      totalSolicitudes: bandeja.length,
      particulares: bandeja.filter(
        (item) => item.solicitud.origenAtencion === "PARTICULAR",
      ).length,
      empresas: bandeja.filter(
        (item) => item.solicitud.origenAtencion === "EMPRESA",
      ).length,
      pendientesMuestras: bandeja.filter(
        (item) => item.solicitud.estadoOperativo.codigo === "PENDIENTE_MUESTRAS",
      ).length,
      resultadosDisponiblesParcialmente: bandeja.filter(
        (item) =>
          item.solicitud.estadoOperativo.codigo ===
          "RESULTADOS_DISPONIBLES_PARCIALMENTE",
      ).length,
      atendidos: bandeja.filter(
        (item) => item.solicitud.estado === "ATENDIDO",
      ).length,
      resultadosInicializadosEnBandeja: operacionesInicializacion.length,
    };

    return res.status(200).json({
      ok: true,
      msg: "Bandeja de Gestión de Resultados obtenida correctamente",
      resumen,
      solicitudes: bandeja,
    });
  } catch (error) {
    console.error("Error al obtener bandeja de Gestión de Resultados:", error);

    return res.status(400).json({
      ok: false,
      msg:
        error.message ||
        "No se pudo obtener la bandeja de Gestión de Resultados",
    });
  }
};

// ====== Obtener resultados por solicitud ======

const obtenerResultadosPorSolicitud = async (req, res = response) => {
  try {
    const { solicitudAtencionId } = req.params;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(solicitudAtencionId)) {
      throw new Error("El id de la solicitud de atención no es válido");
    }

    // ====== Obtener solicitud ======

    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .select(
        [
          "_id",
          "codSolicitud",
          "tipo",
          "estado",
          "unidadesLaboratorio",
        ].join(" "),
      )
      .lean();

    if (!solicitud) {
      throw new Error("La solicitud de atención no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud indicada no corresponde a Laboratorio");
    }

    // ====== Obtener resultados ======

    const resultados = await ResultadoLaboratorio.find({
      solicitudAtencionId: solicitud._id,
    })
      .sort({
        numeroInstancia: 1,
        createdAt: 1,
      })
      .lean();

    // ====== Cargar muestras operativas ======

    const muestrasSolicitud = await obtenerMuestrasSolicitudParaResultados({
      solicitudAtencionId: solicitud._id,
    });

    // ====== Adjuntar habilitación de muestras ======

    const resultadosConHabilitacion =
      await adjuntarHabilitacionMuestraResultados({
        solicitud,
        resultados,
        muestrasSolicitud,
      });

    // ====== Resolver estado operativo ======

    const estadoOperativo = await resolverEstadoOperativoSolicitud({
      solicitud,
      muestras: muestrasSolicitud,
      resultados,
    });

    // ====== Construir resumen ======

    const resumen = {
      total: resultados.length,

      pendientes: resultados.filter(
        (resultado) => resultado.estadoResultado === "PENDIENTE",
      ).length,

      enProceso: resultados.filter(
        (resultado) => resultado.estadoResultado === "EN PROCESO",
      ).length,

      completos: resultados.filter(
        (resultado) => resultado.estadoResultado === "COMPLETO",
      ).length,

      validados: resultados.filter(
        (resultado) => resultado.estadoResultado === "VALIDADO",
      ).length,

      liberados: resultados.filter(
        (resultado) => resultado.estadoResultado === "LIBERADO",
      ).length,

      anulados: resultados.filter(
        (resultado) => resultado.estadoResultado === "ANULADO",
      ).length,

      habilitadosPorMuestra: resultadosConHabilitacion.filter(
        (resultado) => resultado.habilitacionMuestra?.habilitada === true,
      ).length,

      bloqueadosPorMuestra: resultadosConHabilitacion.filter(
        (resultado) => resultado.habilitacionMuestra?.habilitada === false,
      ).length,
    };

    // ====== Respuesta ======

    return res.status(200).json({
      ok: true,

      msg:
        resultados.length > 0
          ? "Resultados de laboratorio obtenidos correctamente"
          : "La solicitud aún no posee resultados de laboratorio inicializados",

      solicitudAtencionId: solicitud._id,

      codSolicitud: solicitud.codSolicitud,

      estadoSolicitud: solicitud.estado,

      estadoOperativo,

      resumen,

      resultados: resultadosConHabilitacion,
    });
  } catch (error) {
    console.error(
      "Error al obtener resultados de laboratorio por solicitud:",
      error,
    );

    return res.status(400).json({
      ok: false,

      msg:
        error.message || "No se pudieron obtener los resultados de laboratorio",
    });
  }
};

// ====== Obtener resultado por id ======

const obtenerResultadoPorId = async (req, res = response) => {
  try {
    const { resultadoLaboratorioId } = req.params;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    // ====== Obtener resultado ======

    const resultado = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).lean();

    if (!resultado) {
      throw new Error("El resultado de laboratorio no existe");
    }

    // ====== Obtener solicitud para habilitación ======

    const solicitud = await SolicitudAtencion.findById(
      resultado.solicitudAtencionId,
    )
      .select(
        [
          "_id",
          "codSolicitud",
          "tipo",
          "estado",
          "unidadesLaboratorio",
        ].join(" "),
      )
      .lean();

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    const habilitacionMuestra = await resolverHabilitacionMuestraUnidad({
      solicitud,
      claveUnidad: resultado.claveUnidad,
    });

    // ====== Resolver estado operativo ======

    const estadoOperativo = await resolverEstadoOperativoSolicitud({
      solicitud,
    });

    // ====== Resumen de alertas ======

    const items = Array.isArray(resultado.resultadosItems)
      ? resultado.resultadosItems
      : [];

    const alertasDetectadas = items.flatMap((item) =>
      Array.isArray(item.alertasDetectadas) ? item.alertasDetectadas : [],
    );

    const resumenAlertas = {
      total: alertasDetectadas.length,

      informativas: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "INFORMATIVA",
      ).length,

      advertencias: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "ADVERTENCIA",
      ).length,

      criticas: alertasDetectadas.filter(
        (alerta) => alerta.nivelAlerta === "CRITICA",
      ).length,
    };

    // ====== Respuesta ======

    const resultadoConConfiguracion = adjuntarConfiguracionClinicaResultado({
      solicitud,
      resultado,
    });

    return res.status(200).json({
      ok: true,

      msg: "Resultado de laboratorio obtenido correctamente",

      estadoSolicitud: solicitud.estado,

      estadoOperativo,

      resumenAlertas,

      resultado: {
        ...resultadoConConfiguracion,
        estadoUnidadLaboratorio:
          obtenerUnidadLaboratorio({
            solicitud,
            claveUnidad: resultado.claveUnidad,
          })?.estado ?? null,
        habilitacionMuestra,
      },
    });
  } catch (error) {
    console.error("Error al obtener resultado de laboratorio:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo obtener el resultado de laboratorio",
    });
  }
};

// ====== Obtener resultados liberados por solicitud ======

const obtenerResultadosLiberadosPorSolicitud = async (req, res = response) => {
  try {
    const { solicitudAtencionId } = req.params;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(solicitudAtencionId)) {
      throw new Error("El id de la solicitud de atención no es válido");
    }

    // ====== Obtener solicitud ======

    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .select(
        [
          "_id",
          "codSolicitud",
          "tipo",
          "estado",
          "fechaEmision",
          "hc",
          "clienteId",
          "tipoDoc",
          "nroDoc",
          "nombreCliente",
          "apePatCliente",
          "apeMatCliente",
          "sexoPaciente",
          "fechaNacimientoPaciente",
          "unidadesLaboratorio",
        ].join(" "),
      )
      .lean();

    if (!solicitud) {
      throw new Error("La solicitud de atención no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud indicada no corresponde a Laboratorio");
    }

    // ====== Obtener resultados liberados ======

    const resultados = await ResultadoLaboratorio.find({
      solicitudAtencionId: solicitud._id,
      estadoResultado: "LIBERADO",
    })
      .sort({
        numeroInstancia: 1,
        createdAt: 1,
      })
      .lean();

    // ====== Resolver estado operativo ======

    const estadoOperativo = await resolverEstadoOperativoSolicitud({
      solicitud,
    });

    // ====== Construir resumen ======

    const alertas = resultados.flatMap((resultado) => {
      const items = Array.isArray(resultado.resultadosItems)
        ? resultado.resultadosItems
        : [];

      return items.flatMap((item) =>
        Array.isArray(item.alertasDetectadas) ? item.alertasDetectadas : [],
      );
    });

    const resumen = {
      totalLiberados: resultados.length,

      totalAlertas: alertas.length,

      informativas: alertas.filter(
        (alerta) => alerta.nivelAlerta === "INFORMATIVA",
      ).length,

      advertencias: alertas.filter(
        (alerta) => alerta.nivelAlerta === "ADVERTENCIA",
      ).length,

      criticas: alertas.filter((alerta) => alerta.nivelAlerta === "CRITICA")
        .length,
    };

    // ====== Respuesta ======

    return res.status(200).json({
      ok: true,

      msg:
        resultados.length > 0
          ? "Resultados liberados obtenidos correctamente"
          : "La solicitud no posee resultados liberados",

      solicitud: {
        _id: solicitud._id,

        codSolicitud: solicitud.codSolicitud,

        estado: solicitud.estado,

        estadoOperativo,

        fechaEmision: solicitud.fechaEmision,

        paciente: {
          hc: solicitud.hc,

          clienteId: solicitud.clienteId,

          tipoDoc: solicitud.tipoDoc,

          nroDoc: solicitud.nroDoc,

          nombreCliente: solicitud.nombreCliente,

          apePatCliente: solicitud.apePatCliente,

          apeMatCliente: solicitud.apeMatCliente,

          sexoPaciente: solicitud.sexoPaciente,

          fechaNacimientoPaciente: solicitud.fechaNacimientoPaciente,
        },
      },

      resumen,

      resultados,
    });
  } catch (error) {
    console.error(
      "Error al obtener resultados liberados de laboratorio:",
      error,
    );

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudieron obtener los resultados liberados",
    });
  }
};

// ====== Inicializar resultados de una solicitud ======

const inicializarResultadosSolicitud = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { solicitudAtencionId } = req.params;

    const { uid, nombreUsuario } = req.user;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(solicitudAtencionId)) {
      throw new Error("El id de la solicitud de atención no es válido");
    }

    // ====== Obtener orden ======

    const solicitud =
      await SolicitudAtencion.findById(solicitudAtencionId).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención no existe");
    }

    // ====== Validar solicitud laboratorio ======

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud indicada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se pueden inicializar resultados de una solicitud anulada",
      );
    }

    const unidades = Array.isArray(solicitud.unidadesLaboratorio)
      ? solicitud.unidadesLaboratorio
      : [];

    if (unidades.length === 0) {
      throw new Error("La solicitud no contiene unidades de laboratorio");
    }

    // ====== Considerar solo unidades activas ======

    const unidadesActivas = unidades.filter(
      (unidad) => unidad.estado !== "ANULADO",
    );

    const unidadesAnuladas = unidades.length - unidadesActivas.length;

    // ====== Validar snapshots activos ======

    const unidadSinSnapshot = unidadesActivas.find(
      (unidad) => !unidad.snapshotClinico,
    );

    if (unidadSinSnapshot) {
      throw new Error(
        `La unidad ${unidadSinSnapshot.claveUnidad} no posee snapshot clínico`,
      );
    }

    // ====== Buscar resultados existentes ======

    const resultadosExistentes = await ResultadoLaboratorio.find({
      solicitudAtencionId: solicitud._id,
    })
      .session(session)
      .lean();

    const clavesExistentes = new Set(
      resultadosExistentes.map((resultado) => resultado.claveUnidad),
    );

    // ====== Crear solo unidades faltantes ======

    const resultadosNuevos = [];

    for (const unidad of unidadesActivas) {
      if (clavesExistentes.has(unidad.claveUnidad)) {
        continue;
      }

      const datosResultado = construirResultadoDesdeUnidad({
        solicitud,
        unidad,
        uid,
        nombreUsuario,
      });

      const resultado = new ResultadoLaboratorio(datosResultado);

      await resultado.save({
        session,
      });

      resultadosNuevos.push(resultado);
    }

    // ====== Sincronizar estados de solicitud ======

    const estadoOperativo = await sincronizarEstadosSolicitudLaboratorio({
      solicitud,
      uid,
      nombreUsuario,
      session,
    });

    await session.commitTransaction();

    // ====== Obtener estado final ======

    const resultadosFinales = await ResultadoLaboratorio.find({
      solicitudAtencionId: solicitud._id,
    })
      .sort({
        numeroInstancia: 1,
        createdAt: 1,
      })
      .lean();

    const resultadosConHabilitacion =
      await adjuntarHabilitacionMuestraResultados({
        solicitud,
        resultados: resultadosFinales,
      });

    return res.status(200).json({
      ok: true,

      msg:
        resultadosNuevos.length > 0
          ? "Resultados de laboratorio inicializados correctamente"
          : unidadesActivas.length === 0
            ? "La solicitud no posee unidades de laboratorio activas para inicializar"
            : "Los resultados de laboratorio ya estaban inicializados",

      estadoSolicitud: solicitud.estado,

      estadoOperativo,

      resumen: {
        unidadesLaboratorio: unidades.length,

        unidadesActivas: unidadesActivas.length,

        unidadesAnuladas,

        resultadosCreados: resultadosNuevos.length,

        resultadosExistentes: resultadosFinales.length,
      },

      resultados: resultadosConHabilitacion,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al inicializar resultados de laboratorio:", error);

    return res.status(400).json({
      ok: false,

      msg:
        error.message ||
        "No se pudieron inicializar los resultados de laboratorio",
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  obtenerBandejaResultadosLaboratorio,
  inicializarResultadosSolicitud,
  registrarEditarResultadoItem,
  registrarResultadosMasivos,
  revisarResultadoAntesValidacion,
  validarResultadosMasivamente,
  validarResultadoLaboratorio,
  liberarResultadosMasivamente,
  liberarResultadoLaboratorio,
  anularResultadoLaboratorio,
  obtenerResultadosPorSolicitud,
  obtenerResultadoPorId,
  obtenerResultadosLiberadosPorSolicitud,
};
