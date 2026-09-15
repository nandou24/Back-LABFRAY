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

    // ====== Reiniciar alertas ======

    resultadoItem.alertasDetectadas = [];

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

      // ====== Reiniciar alertas ======

      resultadoItem.alertasDetectadas = [];

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
};
