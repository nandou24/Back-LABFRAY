const mongoose = require("mongoose");
const { response } = require("express");

const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");

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

    // ====== Auditoría ======

    createdBy: uid,

    usuarioRegistro: nombreUsuario ?? null,

    fechaRegistro: new Date(),
  };
};

// ====== Normalizar valor según tipo ======

const normalizarValorResultado = ({ valor, tipoResultado, snapshotItem }) => {
  // ====== Numérico ======

  if (tipoResultado === "NUMERICO") {
    if (valor === null || valor === undefined || valor === "") {
      throw new Error("El valor numérico es obligatorio");
    }

    const valorNumerico = Number(valor);

    if (!Number.isFinite(valorNumerico)) {
      throw new Error("El resultado debe ser un valor numérico válido");
    }

    return valorNumerico;
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

  const pendientes = items.filter((item) => item.estado === "PENDIENTE").length;

  if (pendientes === items.length) {
    return "PENDIENTE";
  }

  if (pendientes > 0) {
    return "EN PROCESO";
  }

  return "COMPLETO";
};

// ====== Obtener Item desde snapshot de la orden ======

const obtenerItemSnapshotResultado = ({
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
    const valorNumerico = Number(valor);

    if (!Number.isFinite(valorNumerico)) {
      return false;
    }

    if (tipoReferencia === "RANGO") {
      const valorMin = Number(referencia.valorMin);

      const valorMax = Number(referencia.valorMax);

      if (!Number.isFinite(valorMin) || !Number.isFinite(valorMax)) {
        return false;
      }

      return valorNumerico >= valorMin && valorNumerico <= valorMax;
    }

    const valorLimite = Number(referencia.valorLimite);

    if (!Number.isFinite(valorLimite)) {
      return false;
    }

    if (tipoReferencia === "MENOR_QUE") {
      return valorNumerico < valorLimite;
    }

    if (tipoReferencia === "MENOR_IGUAL_QUE") {
      return valorNumerico <= valorLimite;
    }

    if (tipoReferencia === "MAYOR_QUE") {
      return valorNumerico > valorLimite;
    }

    if (tipoReferencia === "MAYOR_IGUAL_QUE") {
      return valorNumerico >= valorLimite;
    }
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

  const valorNumerico = Number(valor);

  if (!Number.isFinite(valorNumerico)) {
    return "FUERA_REFERENCIA";
  }

  if (tipoReferencia === "RANGO") {
    const valorMin = Number(referencia.valorMin);

    const valorMax = Number(referencia.valorMax);

    if (Number.isFinite(valorMin) && valorNumerico < valorMin) {
      return "BAJO";
    }

    if (Number.isFinite(valorMax) && valorNumerico > valorMax) {
      return "ALTO";
    }

    return "FUERA_REFERENCIA";
  }

  if (tipoReferencia === "MENOR_QUE" || tipoReferencia === "MENOR_IGUAL_QUE") {
    return "ALTO";
  }

  if (tipoReferencia === "MAYOR_QUE" || tipoReferencia === "MAYOR_IGUAL_QUE") {
    return "BAJO";
  }

  return "FUERA_REFERENCIA";
};

// ====== Evaluar referencia del resultado ======

const evaluarReferenciaResultado = ({ solicitud, snapshotItem, valor }) => {
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
        ? `Resultado clasificado en referencia: ${referencia.descripcion}`
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

    const valorNumerico = Number(valor);

    if (!Number.isFinite(valorNumerico)) {
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
      return valorNumerico < valor1;
    }

    if (condicion === "MENOR_IGUAL_QUE") {
      return valorNumerico <= valor1;
    }

    if (condicion === "MAYOR_QUE") {
      return valorNumerico > valor1;
    }

    if (condicion === "MAYOR_IGUAL_QUE") {
      return valorNumerico >= valor1;
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

    return valorNumerico < valor1 || valorNumerico > valor2;
  }

  // ====== Igual o distinto ======

  if (condicion === "IGUAL_A" || condicion === "DISTINTO_DE") {
    let sonIguales;

    if (tipoResultado === "NUMERICO") {
      const valorNumerico = Number(valor);
      const valorRegla = Number(regla.valor1);

      if (!Number.isFinite(valorNumerico) || !Number.isFinite(valorRegla)) {
        throw new Error(
          `La regla de alerta ${regla.descripcion || condicion} no posee un valor numérico válido`,
        );
      }

      sonIguales = valorNumerico === valorRegla;
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

    // ====== Normalizar valor ======

    const valorNormalizado = normalizarValorResultado({
      valor,
      tipoResultado: resultadoItem.tipoResultado,
      snapshotItem,
    });

    const ahora = new Date();

    const primeraCaptura = !resultadoItem.fechaRegistroResultado;

    // ====== Registrar valor ======

    resultadoItem.valor = valorNormalizado;

    if (Object.prototype.hasOwnProperty.call(req.body, "observacion")) {
      resultadoItem.observacion =
        typeof observacion === "string" ? observacion.trim() : "";
    }

    resultadoItem.estado = "REGISTRADO";

    // ====== Trazabilidad primera captura ======

    if (primeraCaptura) {
      resultadoItem.registradoPor = uid;

      resultadoItem.usuarioRegistroResultado = nombreUsuario ?? null;

      resultadoItem.fechaRegistroResultado = ahora;
    } else {
      // ====== Trazabilidad edición ======

      resultadoItem.actualizadoPor = uid;

      resultadoItem.usuarioActualizacionResultado = nombreUsuario ?? null;

      resultadoItem.fechaActualizacionResultado = ahora;
    }

    // ====== Evaluar referencia clínica ======

    const evaluacionReferencia = evaluarReferenciaResultado({
      solicitud,
      snapshotItem,
      valor: valorNormalizado,
    });

    resultadoItem.evaluacionReferencia = evaluacionReferencia;

    // ====== Detectar alertas ======

    resultadoItem.alertasDetectadas = detectarAlertasResultado({
      solicitud,
      snapshotItem,
      valor: valorNormalizado,
      fechaDeteccion: ahora,
    });

    // ====== Recalcular estado general ======

    resultadoLaboratorio.estadoResultado =
      recalcularEstadoResultado(resultadoLaboratorio);

    // ====== Auditoría ======

    resultadoLaboratorio.updatedBy = uid;

    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaActualizacion = ahora;

    // ====== Guardar resultado ======

    await resultadoLaboratorio.save({
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg: primeraCaptura
        ? "Resultado del Item registrado correctamente"
        : "Resultado del Item actualizado correctamente",

      estadoResultado: resultadoLaboratorio.estadoResultado,

      item: resultadoItem,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al registrar resultado de laboratorio:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo registrar el resultado del Item",
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

    const ahora = new Date();

    const itemsActualizados = [];

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

      // ====== Normalizar valor ======

      const valorNormalizado = normalizarValorResultado({
        valor,
        tipoResultado: resultadoItem.tipoResultado,
        snapshotItem,
      });

      const primeraCaptura = !resultadoItem.fechaRegistroResultado;

      // ====== Registrar valor ======

      resultadoItem.valor = valorNormalizado;

      if (Object.prototype.hasOwnProperty.call(itemRecibido, "observacion")) {
        resultadoItem.observacion =
          typeof observacion === "string" ? observacion.trim() : "";
      }

      resultadoItem.estado = "REGISTRADO";

      // ====== Trazabilidad ======

      if (primeraCaptura) {
        resultadoItem.registradoPor = uid;

        resultadoItem.usuarioRegistroResultado = nombreUsuario ?? null;

        resultadoItem.fechaRegistroResultado = ahora;
      } else {
        resultadoItem.actualizadoPor = uid;

        resultadoItem.usuarioActualizacionResultado = nombreUsuario ?? null;

        resultadoItem.fechaActualizacionResultado = ahora;
      }

      // ====== Evaluar referencia clínica ======

      const evaluacionReferencia = evaluarReferenciaResultado({
        solicitud,
        snapshotItem,
        valor: valorNormalizado,
      });

      resultadoItem.evaluacionReferencia = evaluacionReferencia;

      // ====== Detectar alertas ======

      resultadoItem.alertasDetectadas = detectarAlertasResultado({
        solicitud,
        snapshotItem,
        valor: valorNormalizado,
        fechaDeteccion: ahora,
      });

      itemsActualizados.push(resultadoItem);
    }

    // ====== Recalcular estado general ======

    resultadoLaboratorio.estadoResultado =
      recalcularEstadoResultado(resultadoLaboratorio);

    // ====== Auditoría ======

    resultadoLaboratorio.updatedBy = uid;

    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;

    resultadoLaboratorio.fechaActualizacion = ahora;

    // ====== Guardar una sola vez ======

    await resultadoLaboratorio.save({
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

      itemsActualizados: itemsActualizados.length,

      items: itemsActualizados,
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
      (item) => item.estado !== "REGISTRADO",
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
        !item.evaluacionReferencia ||
        item.evaluacionReferencia.estado === "PENDIENTE",
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

    // ====== Guardar ======

    await resultadoLaboratorio.save({
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

    // ====== Guardar ======

    await resultadoLaboratorio.save({
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
      .select("_id codSolicitud tipo estado")
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

      resumen,

      resultados,
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

    return res.status(200).json({
      ok: true,

      msg: "Resultado de laboratorio obtenido correctamente",

      resumenAlertas,

      resultado,
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

    // ====== Validar snapshots ======

    const unidadSinSnapshot = unidades.find(
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

    for (const unidad of unidades) {
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

    await session.commitTransaction();

    // ====== Obtener estado final ======

    const resultadosFinales = await ResultadoLaboratorio.find({
      solicitudAtencionId: solicitud._id,
    }).sort({
      numeroInstancia: 1,
      createdAt: 1,
    });

    return res.status(200).json({
      ok: true,

      msg:
        resultadosNuevos.length > 0
          ? "Resultados de laboratorio inicializados correctamente"
          : "Los resultados de laboratorio ya estaban inicializados",

      resumen: {
        unidadesLaboratorio: unidades.length,

        resultadosCreados: resultadosNuevos.length,

        resultadosExistentes: resultadosFinales.length,
      },

      resultados: resultadosFinales,
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
  inicializarResultadosSolicitud,
  registrarEditarResultadoItem,
  registrarResultadosMasivos,
  validarResultadoLaboratorio,
  liberarResultadoLaboratorio,
  anularResultadoLaboratorio,
  obtenerResultadosPorSolicitud,
  obtenerResultadoPorId,
  obtenerResultadosLiberadosPorSolicitud,
};
