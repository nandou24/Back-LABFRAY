const { response } = require("express");
const ItemLab = require("../../models/Mantenimiento/ItemLab");
const bcrypt = require("bcryptjs");
const { generarJWT } = require("../../helpers/jwt");
const jwt = require("jsonwebtoken");

// ====== Normalizar identidad del Item ======
const normalizarIdentidadItem = (valor = "") => String(valor ?? "").trim();

// ====== Buscar Item duplicado por nombre + contexto ======
const buscarItemDuplicado = async ({
  nombreInforme,
  contextoAnalitico,
  excluirId = null,
}) => {
  const filtro = {
    nombreInforme: normalizarIdentidadItem(nombreInforme),
    contextoAnalitico: normalizarIdentidadItem(contextoAnalitico).toUpperCase(),
  };

  if (excluirId) {
    filtro._id = { $ne: excluirId };
  }

  return ItemLab.findOne(filtro).collation({
    locale: "es",
    strength: 2,
  });
};

// ====== Formatos numéricos permitidos ======
const FORMATOS_CAPTURA_NUMERICA = new Set([
  "VALOR",
  "RANGO",
  "MAYOR_QUE",
  "MAYOR_IGUAL_QUE",
  "MENOR_QUE",
  "MENOR_IGUAL_QUE",
]);

// ====== Normalizar lista de textos ======
const normalizarListaTexto = (valores = []) => [
  ...new Map(
    (Array.isArray(valores) ? valores : [])
      .map((valor) => String(valor ?? "").trim())
      .filter(Boolean)
      .map((valor) => [valor.toUpperCase(), valor]),
  ).values(),
];

// ====== Normalizar precisión numérica ======
const normalizarPrecisionNumerica = (valor = "DECIMAL") => {
  const precision = String(valor ?? "DECIMAL").trim().toUpperCase();
  return ["ENTERO", "DECIMAL"].includes(precision) ? precision : null;
};

// ====== Validar entero cuando corresponda ======
const validarPrecisionNumerica = (valor, precision) =>
  precision !== "ENTERO" || Number.isInteger(valor);

// ====== Resolver opción canónica ======
const obtenerOpcionCanonica = (valor, opciones = []) => {
  const buscado = String(valor ?? "").trim().toUpperCase();
  if (!buscado) return null;

  return (
    opciones.find(
      (opcion) => String(opcion ?? "").trim().toUpperCase() === buscado,
    ) ?? null
  );
};

// ====== Normalizar formatos numéricos ======
const normalizarFormatosNumericos = ({ formatosEntrada, formatoDefault }) => {
  const formatos = [
    ...new Set(
      (Array.isArray(formatosEntrada) ? formatosEntrada : ["VALOR"])
        .map((formato) => String(formato ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ];

  if (!formatos.length) {
    return { error: "Debe existir al menos un formato de captura numérica" };
  }

  const formatoInvalido = formatos.find(
    (formato) => !FORMATOS_CAPTURA_NUMERICA.has(formato),
  );

  if (formatoInvalido) {
    return {
      error: `El formato de captura numérica ${formatoInvalido} no es válido`,
    };
  }

  const formato = String(formatoDefault ?? formatos[0] ?? "VALOR")
    .trim()
    .toUpperCase();

  if (!FORMATOS_CAPTURA_NUMERICA.has(formato)) {
    return { error: "El formato numérico predeterminado no es válido" };
  }

  if (!formatos.includes(formato)) {
    return {
      error:
        "El formato predeterminado debe estar incluido entre los formatos permitidos",
    };
  }

  return { formatos, formatoDefault: formato };
};

// ====== Validar configuración de captura numérica ======
const validarConfiguracionCapturaNumerica = (datos = {}) => {
  const tipoResultado = datos.tipoResultado ?? "TEXTO";

  if (tipoResultado !== "NUMERICO") {
    datos.formatosCapturaNumerica = ["VALOR"];
    datos.formatoCapturaNumericaDefault = "VALOR";
    datos.precisionNumerica = "DECIMAL";
    datos.valoresCualitativosAlternativos = [];
    datos.valoresCualitativosReferencia = [];
    return null;
  }

  const normalizados = normalizarFormatosNumericos({
    formatosEntrada: datos.formatosCapturaNumerica,
    formatoDefault: datos.formatoCapturaNumericaDefault,
  });

  if (normalizados.error) return normalizados.error;

  datos.formatosCapturaNumerica = normalizados.formatos;
  datos.formatoCapturaNumericaDefault = normalizados.formatoDefault;

  const precisionNumerica = normalizarPrecisionNumerica(datos.precisionNumerica);
  if (!precisionNumerica) {
    return "La precisión numérica debe ser ENTERO o DECIMAL";
  }
  datos.precisionNumerica = precisionNumerica;

  const alternativas = normalizarListaTexto(
    datos.valoresCualitativosAlternativos,
  );
  const referencias = normalizarListaTexto(datos.valoresCualitativosReferencia);

  const referenciaInvalida = referencias.find(
    (valor) => !obtenerOpcionCanonica(valor, alternativas),
  );

  if (referenciaInvalida) {
    return `El valor cualitativo de referencia ${referenciaInvalida} no existe entre las alternativas permitidas`;
  }

  datos.valoresCualitativosAlternativos = alternativas;
  datos.valoresCualitativosReferencia = referencias.map(
    (valor) => obtenerOpcionCanonica(valor, alternativas) ?? valor,
  );

  return null;
};

// ====== Validar configuración estructurada ======
const validarConfiguracionEstructurada = (datos = {}) => {
  const tipoResultado = datos.tipoResultado ?? "TEXTO";

  if (tipoResultado !== "ESTRUCTURADO") {
    datos.configuracionEstructurada = null;
    return null;
  }

  const entrada = datos.configuracionEstructurada;

  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    return "Debe configurar los hallazgos del Item estructurado";
  }

  const hallazgos = normalizarListaTexto(entrada.hallazgos);

  if (!hallazgos.length) {
    return "Un Item estructurado debe tener al menos un hallazgo configurado";
  }

  const valorAusencia = String(
    entrada.valorAusencia ?? "NO SE OBSERVAN",
  ).trim();

  const hallazgosNormalesEntrada = normalizarListaTexto(
    entrada.hallazgosNormales,
  );

  const hallazgoNormalInvalido = hallazgosNormalesEntrada.find(
    (hallazgo) => !obtenerOpcionCanonica(hallazgo, hallazgos),
  );

  if (hallazgoNormalInvalido) {
    return `El hallazgo normal ${hallazgoNormalInvalido} no existe en el catálogo de hallazgos`;
  }

  const hallazgosNormales = hallazgosNormalesEntrada.map(
    (hallazgo) => obtenerOpcionCanonica(hallazgo, hallazgos) ?? hallazgo,
  );

  if (!valorAusencia) {
    return "Debe indicar el texto utilizado cuando no existen hallazgos";
  }

  const cuantificacionEntrada = entrada.cuantificacion ?? {};
  const tipoCuantificacion = String(
    cuantificacionEntrada.tipo ?? "CATEGORICA",
  )
    .trim()
    .toUpperCase();

  if (!["CATEGORICA", "NUMERICA"].includes(tipoCuantificacion)) {
    return "El tipo de cuantificación de hallazgos no es válido";
  }

  let cuantificacion;

  if (tipoCuantificacion === "CATEGORICA") {
    const opciones = normalizarListaTexto(cuantificacionEntrada.opciones);

    if (!opciones.length) {
      return "La cuantificación categórica debe tener al menos una opción";
    }

    cuantificacion = {
      tipo: "CATEGORICA",
      precisionNumerica: "DECIMAL",
      opciones,
      formatosCapturaNumerica: ["VALOR"],
      formatoCapturaNumericaDefault: "VALOR",
    };
  } else {
    const normalizados = normalizarFormatosNumericos({
      formatosEntrada: cuantificacionEntrada.formatosCapturaNumerica,
      formatoDefault: cuantificacionEntrada.formatoCapturaNumericaDefault,
    });

    if (normalizados.error) return normalizados.error;

    const precisionNumerica = normalizarPrecisionNumerica(
      cuantificacionEntrada.precisionNumerica,
    );
    if (!precisionNumerica) {
      return "La precisión numérica de los hallazgos debe ser ENTERO o DECIMAL";
    }

    cuantificacion = {
      tipo: "NUMERICA",
      precisionNumerica,
      opciones: [],
      formatosCapturaNumerica: normalizados.formatos,
      formatoCapturaNumericaDefault: normalizados.formatoDefault,
    };
  }

  datos.configuracionEstructurada = {
    subtipo: "HALLAZGOS",
    permiteMultiples: entrada.permiteMultiples !== false,
    valorAusencia,
    ausenciaEsReferencia: entrada.ausenciaEsReferencia === true,
    hallazgosNormales,
    permitirOtroHallazgo: entrada.permitirOtroHallazgo === true,
    hallazgos,
    cuantificacion,
  };

  return null;
};

// ====== Normalizar valor numérico por formato ======
const normalizarValorNumericoConfigurado = ({
  valor,
  formatosPermitidos,
  formatoDefault,
  precisionNumerica = "DECIMAL",
}) => {
  if (valor === null || valor === undefined || valor === "") {
    return { valor: null };
  }

  const formatos = Array.isArray(formatosPermitidos)
    ? formatosPermitidos
    : ["VALOR"];

  const tipoObjeto =
    valor && typeof valor === "object" && !Array.isArray(valor)
      ? String(valor.tipo ?? "").trim().toUpperCase()
      : "";

  const formato = tipoObjeto || formatoDefault || "VALOR";

  if (!formatos.includes(formato)) {
    return { error: `El formato ${formato} no está permitido` };
  }

  if (formato === "RANGO") {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
      return { error: "Debe indicar ambos extremos del rango" };
    }

    const desde = Number(valor.desde);
    const hasta = Number(valor.hasta);

    if (!Number.isFinite(desde) || !Number.isFinite(hasta)) {
      return { error: "Los extremos del rango deben ser numéricos" };
    }

    if (
      !validarPrecisionNumerica(desde, precisionNumerica) ||
      !validarPrecisionNumerica(hasta, precisionNumerica)
    ) {
      return { error: "Este Item solo permite valores enteros" };
    }

    if (desde > hasta) {
      return { error: "El valor inicial no puede ser mayor que el valor final" };
    }

    return {
      valor: { tipo: "RANGO", desde, hasta },
    };
  }

  const numero = Number(
    valor && typeof valor === "object" && !Array.isArray(valor) && "valor" in valor
      ? valor.valor
      : valor,
  );

  if (!Number.isFinite(numero)) {
    return { error: "El valor debe ser un número válido" };
  }

  if (!validarPrecisionNumerica(numero, precisionNumerica)) {
    return { error: "Este Item solo permite valores enteros" };
  }

  if (formato === "VALOR") return { valor: numero };

  return {
    valor: { tipo: formato, valor: numero },
  };
};

// ====== Validar valor por defecto de resultado ======
const validarValorPorDefectoResultado = (datos = {}) => {
  const tipoResultado = datos.tipoResultado ?? "TEXTO";
  const valor = datos.valorPorDefectoResultado;

  // ====== Numérico ======
  if (tipoResultado === "NUMERICO") {
    if (valor === null || valor === undefined || valor === "") {
      datos.valorPorDefectoResultado = null;
      return null;
    }

    const alternativas = Array.isArray(datos.valoresCualitativosAlternativos)
      ? datos.valoresCualitativosAlternativos
      : [];

    const esCualitativo =
      valor &&
      typeof valor === "object" &&
      !Array.isArray(valor) &&
      String(valor.tipo ?? "").toUpperCase() === "CUALITATIVO";

    if (esCualitativo) {
      const opcion = obtenerOpcionCanonica(valor.valor, alternativas);

      if (!opcion) {
        return "El valor cualitativo por defecto no existe entre las alternativas permitidas";
      }

      datos.valorPorDefectoResultado = {
        tipo: "CUALITATIVO",
        valor: opcion,
      };
      return null;
    }

    const normalizado = normalizarValorNumericoConfigurado({
      valor,
      formatosPermitidos: datos.formatosCapturaNumerica,
      formatoDefault: datos.formatoCapturaNumericaDefault,
      precisionNumerica: datos.precisionNumerica,
    });

    if (normalizado.error) return normalizado.error;

    datos.valorPorDefectoResultado = normalizado.valor;
    return null;
  }

  // ====== Estructurado ======
  if (tipoResultado === "ESTRUCTURADO") {
    if (valor === null || valor === undefined || valor === "") {
      datos.valorPorDefectoResultado = null;
      return null;
    }

    const configuracion = datos.configuracionEstructurada;

    if (
      !configuracion ||
      !valor ||
      typeof valor !== "object" ||
      Array.isArray(valor) ||
      String(valor.tipo ?? "").toUpperCase() !== "HALLAZGOS"
    ) {
      return "El valor por defecto estructurado no es válido";
    }

    const modo = String(valor.modo ?? "").trim().toUpperCase();

    if (modo === "AUSENCIA") {
      datos.valorPorDefectoResultado = {
        tipo: "HALLAZGOS",
        modo: "AUSENCIA",
        valorAusencia: configuracion.valorAusencia,
        hallazgos: [],
      };
      return null;
    }

    if (modo !== "DETALLE") {
      return "El modo del valor por defecto estructurado no es válido";
    }

    const entradaHallazgos = Array.isArray(valor.hallazgos)
      ? valor.hallazgos
      : [];

    if (!entradaHallazgos.length) {
      return "El valor por defecto en modo detalle debe tener al menos un hallazgo";
    }

    if (!configuracion.permiteMultiples && entradaHallazgos.length > 1) {
      return "Este Item estructurado solo permite un hallazgo";
    }

    const usados = new Set();
    const hallazgosNormalizados = [];

    for (const entradaHallazgo of entradaHallazgos) {
      const hallazgoSolicitado = String(entradaHallazgo?.hallazgo ?? "").trim();
      const hallazgoCanonico = obtenerOpcionCanonica(
        hallazgoSolicitado,
        configuracion.hallazgos,
      );

      if (!hallazgoCanonico && !configuracion.permitirOtroHallazgo) {
        return `El hallazgo ${hallazgoSolicitado || "indicado"} no está configurado para este Item`;
      }

      const hallazgo = hallazgoCanonico ?? hallazgoSolicitado;

      if (!hallazgo) return "Debe indicar el nombre del hallazgo";

      const clave = hallazgo.toUpperCase();
      if (usados.has(clave)) {
        return `El hallazgo ${hallazgo} está repetido`;
      }
      usados.add(clave);

      if (configuracion.cuantificacion.tipo === "CATEGORICA") {
        const valorEntrada =
          entradaHallazgo?.valor && typeof entradaHallazgo.valor === "object"
            ? entradaHallazgo.valor.valor
            : entradaHallazgo?.valor;
        const opcion = obtenerOpcionCanonica(
          valorEntrada,
          configuracion.cuantificacion.opciones,
        );

        if (!opcion) {
          return `La cuantificación de ${hallazgo} no existe entre las opciones permitidas`;
        }

        hallazgosNormalizados.push({
          hallazgo,
          valor: { tipo: "CATEGORICO", valor: opcion },
        });
      } else {
        const normalizado = normalizarValorNumericoConfigurado({
          valor: entradaHallazgo?.valor,
          formatosPermitidos:
            configuracion.cuantificacion.formatosCapturaNumerica,
          formatoDefault:
            configuracion.cuantificacion.formatoCapturaNumericaDefault,
          precisionNumerica: configuracion.cuantificacion.precisionNumerica,
        });

        if (normalizado.error) {
          return `${hallazgo}: ${normalizado.error}`;
        }

        hallazgosNormalizados.push({
          hallazgo,
          valor: normalizado.valor,
        });
      }
    }

    datos.valorPorDefectoResultado = {
      tipo: "HALLAZGOS",
      modo: "DETALLE",
      hallazgos: hallazgosNormalizados,
    };
    return null;
  }

  // ====== Texto / categórico ======
  const valorTexto = String(valor ?? "").trim();

  if (!valorTexto) {
    datos.valorPorDefectoResultado = "";
    return null;
  }

  if (tipoResultado === "CATEGORICO") {
    const opciones = Array.isArray(datos.opcionesResultado)
      ? datos.opcionesResultado
      : [];

    const opcionCanonica = obtenerOpcionCanonica(valorTexto, opciones);

    if (!opcionCanonica) {
      return "El valor por defecto debe existir entre las opciones del resultado categórico";
    }

    datos.valorPorDefectoResultado = opcionCanonica;
    return null;
  }

  datos.valorPorDefectoResultado = valorTexto;
  return null;
};

const crearItemLab = async (req, res = response) => {
  console.log("Datos recibidos:", req.body);

  const {
    codItemLab,
    nombreInforme,
    metodoItemLab,
    plantillaValores,
    unidadesRef,
    poseeValidacion,
    perteneceAPrueba,
    paramValidacion,
    ordenImpresion,
    grupoItemLab,
  } = req.body;

  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  try {
    const errorCapturaNumerica = validarConfiguracionCapturaNumerica(req.body);

    if (errorCapturaNumerica) {
      return res.status(400).json({
        ok: false,
        msg: errorCapturaNumerica,
      });
    }

    const errorEstructurado = validarConfiguracionEstructurada(req.body);

    if (errorEstructurado) {
      return res.status(400).json({
        ok: false,
        msg: errorEstructurado,
      });
    }

    const errorValorPorDefecto = validarValorPorDefectoResultado(req.body);

    if (errorValorPorDefecto) {
      return res.status(400).json({
        ok: false,
        msg: errorValorPorDefecto,
      });
    }

    // ====== Validar identidad clínica del Item ======
    req.body.nombreInforme = normalizarIdentidadItem(nombreInforme);
    req.body.contextoAnalitico = normalizarIdentidadItem(
      req.body.contextoAnalitico,
    ).toUpperCase();

    const itemExistente = await buscarItemDuplicado({
      nombreInforme: req.body.nombreInforme,
      contextoAnalitico: req.body.contextoAnalitico,
    });

    if (itemExistente) {
      const contexto = req.body.contextoAnalitico || "GENERAL";

      return res.status(400).json({
        ok: false,
        msg: `Ya existe el Item "${req.body.nombreInforme}" en el contexto analítico ${contexto}`,
      });
    }

    // Validar que no exista el mismo número de orden de impresión
    if (ordenImpresion && perteneceAPrueba) {
      let consultaValidacion = {
        ordenImpresion: ordenImpresion,
        perteneceAPrueba: perteneceAPrueba,
      };

      // Si se proporciona grupoItemLab, incluirlo en la validación
      if (grupoItemLab) {
        consultaValidacion.grupoItemLab = grupoItemLab;
      }

      const itemConMismoOrden = await ItemLab.findOne(consultaValidacion);

      console.log("Item con mismo orden:", itemConMismoOrden);

      if (itemConMismoOrden) {
        const mensajeError = grupoItemLab
          ? `Ya existe el item "${itemConMismoOrden.nombreInforme}" con el orden de impresión ${ordenImpresion} para el mismo grupo y prueba`
          : `Ya existe el item "${itemConMismoOrden.nombreInforme}" con el orden de impresión ${ordenImpresion} para la misma prueba`;

        return res.status(400).json({
          ok: false,
          msg: mensajeError,
        });
      }
    }

    //creando codigo prueba
    // Buscar el último item

    const ultimoItem = await ItemLab.findOne().sort({ codItemLab: -1 });

    // 2. Generar el nuevo código
    let nuevoCodigo = 1; // Código inicial si no hay ítems

    if (ultimoItem) {
      // Extraemos solo el número del código, ejemplo: de "IL0005" extraemos "5"
      const numeroUltimo =
        parseInt(ultimoItem.codItemLab.replace("IL", "")) || 0;
      nuevoCodigo = numeroUltimo + 1;
    }

    // Formateamos: IL + número con 4 cifras
    const codItemLabFormateado = `IL${String(nuevoCodigo).padStart(4, "0")}`;
    console.log("Nuevo código generado:", codItemLabFormateado);

    // Crear la prueba con el código
    const nuevoItemLab = new ItemLab({
      ...req.body,
      codItemLab: codItemLabFormateado, // Agregar el código de la prueba generado
      createdBy: uid, // uid del usuario que creó el item
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó el item
      fechaRegistro: new Date(), // Fecha de registro
    });

    // console.log("Datos a grabar"+nuevoItemLab)

    await nuevoItemLab.save();
    // console.log(dbUser, "pasoo registro");
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      uid: nuevoItemLab.id,
      //token: token,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimosItems = async (req, res = response) => {
  try {
    const itemsLab = await ItemLab.find()
      .populate("perteneceAPrueba", "codPruebaLab nombrePruebaLab")
      .sort({ createdAt: -1 });

    return res.json({
      ok: true,
      itemsLab,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTermino = async (req, res = response) => {
  const termino = req.query.search;
  // console.log('TERMINO DE BUSQUEDA '+ termino)

  try {
    const itemsLab = await ItemLab.find({
      //nroDoc: { $regex: termino, $options: 'i'}

      $or: [
        { nombreInforme: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nombre"
        { nombreHojaTrabajo: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "método"
        { perteneceA: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "observación"
        // Agrega más campos si es necesario
      ],
    }).populate("perteneceAPrueba", "codPruebaLab nombrePruebaLab");
    return res.json({
      ok: true,
      itemsLab, //! favoritos: favoritos
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const actualizarItem = async (req, res = response) => {
  const codigo = req.params.codigo; //recupera la hc
  const datosActualizados = req.body; //recupera los datos a grabar
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  try {
    // console.log('Datos recibidos:', req.body);

    // Obtener el item actual para validaciones
    const itemActual = await ItemLab.findOne({ codItemLab: codigo });

    if (!itemActual) {
      return res.status(404).json({
        ok: false,
        msg: "Item no encontrado con ese código",
      });
    }

    // ====== Validar identidad clínica del Item ======
    const nombreInformeEfectivo = normalizarIdentidadItem(
      datosActualizados.nombreInforme ?? itemActual.nombreInforme,
    );
    const contextoAnaliticoEfectivo = normalizarIdentidadItem(
      Object.prototype.hasOwnProperty.call(datosActualizados, "contextoAnalitico")
        ? datosActualizados.contextoAnalitico
        : itemActual.contextoAnalitico,
    ).toUpperCase();

    const itemDuplicado = await buscarItemDuplicado({
      nombreInforme: nombreInformeEfectivo,
      contextoAnalitico: contextoAnaliticoEfectivo,
      excluirId: itemActual._id,
    });

    if (itemDuplicado) {
      const contexto = contextoAnaliticoEfectivo || "GENERAL";

      return res.status(400).json({
        ok: false,
        msg: `Ya existe el Item "${nombreInformeEfectivo}" en el contexto analítico ${contexto}`,
      });
    }

    datosActualizados.nombreInforme = nombreInformeEfectivo;
    datosActualizados.contextoAnalitico = contextoAnaliticoEfectivo;

    const configuracionResultado = {
      tipoResultado:
        datosActualizados.tipoResultado ?? itemActual.tipoResultado ?? "TEXTO",
      opcionesResultado:
        datosActualizados.opcionesResultado ?? itemActual.opcionesResultado ?? [],
      valorPorDefectoResultado: Object.prototype.hasOwnProperty.call(
        datosActualizados,
        "valorPorDefectoResultado",
      )
        ? datosActualizados.valorPorDefectoResultado
        : itemActual.valorPorDefectoResultado,
      formatosCapturaNumerica: Object.prototype.hasOwnProperty.call(
        datosActualizados,
        "formatosCapturaNumerica",
      )
        ? datosActualizados.formatosCapturaNumerica
        : itemActual.formatosCapturaNumerica,
      formatoCapturaNumericaDefault: Object.prototype.hasOwnProperty.call(
        datosActualizados,
        "formatoCapturaNumericaDefault",
      )
        ? datosActualizados.formatoCapturaNumericaDefault
        : itemActual.formatoCapturaNumericaDefault,
      precisionNumerica: Object.prototype.hasOwnProperty.call(
        datosActualizados,
        "precisionNumerica",
      )
        ? datosActualizados.precisionNumerica
        : itemActual.precisionNumerica,
      valoresCualitativosAlternativos: Object.prototype.hasOwnProperty.call(
        datosActualizados,
        "valoresCualitativosAlternativos",
      )
        ? datosActualizados.valoresCualitativosAlternativos
        : itemActual.valoresCualitativosAlternativos,
      valoresCualitativosReferencia: Object.prototype.hasOwnProperty.call(
        datosActualizados,
        "valoresCualitativosReferencia",
      )
        ? datosActualizados.valoresCualitativosReferencia
        : itemActual.valoresCualitativosReferencia,
      configuracionEstructurada: Object.prototype.hasOwnProperty.call(
        datosActualizados,
        "configuracionEstructurada",
      )
        ? datosActualizados.configuracionEstructurada
        : itemActual.configuracionEstructurada,
    };

    const errorCapturaNumerica =
      validarConfiguracionCapturaNumerica(configuracionResultado);

    if (errorCapturaNumerica) {
      return res.status(400).json({
        ok: false,
        msg: errorCapturaNumerica,
      });
    }

    const errorEstructurado =
      validarConfiguracionEstructurada(configuracionResultado);

    if (errorEstructurado) {
      return res.status(400).json({
        ok: false,
        msg: errorEstructurado,
      });
    }

    const errorValorPorDefecto =
      validarValorPorDefectoResultado(configuracionResultado);

    if (errorValorPorDefecto) {
      return res.status(400).json({
        ok: false,
        msg: errorValorPorDefecto,
      });
    }

    datosActualizados.valorPorDefectoResultado =
      configuracionResultado.valorPorDefectoResultado;
    datosActualizados.formatosCapturaNumerica =
      configuracionResultado.formatosCapturaNumerica;
    datosActualizados.formatoCapturaNumericaDefault =
      configuracionResultado.formatoCapturaNumericaDefault;
    datosActualizados.precisionNumerica = configuracionResultado.precisionNumerica;
    datosActualizados.valoresCualitativosAlternativos =
      configuracionResultado.valoresCualitativosAlternativos;
    datosActualizados.valoresCualitativosReferencia =
      configuracionResultado.valoresCualitativosReferencia;
    datosActualizados.configuracionEstructurada =
      configuracionResultado.configuracionEstructurada;

    // Validar que no exista el mismo número de orden de impresión (excluyendo el item actual)
    if (
      datosActualizados.ordenImpresion &&
      datosActualizados.perteneceAPrueba
    ) {
      let consultaValidacion = {
        ordenImpresion: datosActualizados.ordenImpresion,
        perteneceAPrueba: datosActualizados.perteneceAPrueba,
        _id: { $ne: itemActual._id }, // Excluir el item actual
      };

      // Si se proporciona grupoItemLab, incluirlo en la validación
      if (datosActualizados.grupoItemLab) {
        consultaValidacion.grupoItemLab = datosActualizados.grupoItemLab;
      }

      const itemConMismoOrden = await ItemLab.findOne(consultaValidacion);

      console.log("Item con mismo orden en actualización:", itemConMismoOrden);

      if (itemConMismoOrden) {
        const mensajeError = datosActualizados.grupoItemLab
          ? `Ya existe el item "${itemConMismoOrden.nombreInforme}" con el orden de impresión ${datosActualizados.ordenImpresion} para el mismo grupo y prueba`
          : `Ya existe el item "${itemConMismoOrden.nombreInforme}" con el orden de impresión ${datosActualizados.ordenImpresion} para la misma prueba`;

        return res.status(400).json({
          ok: false,
          msg: mensajeError,
        });
      }
    }

    const itemLab = await ItemLab.findOneAndUpdate(
      { codItemLab: codigo },
      {
        $set: datosActualizados,
        updatedBy: uid, // uid del usuario que actualiza el item
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza el item
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true }, // Devuelve el documento actualizado
    );

    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.error("Error al actualizar el item: ", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};

// const eliminarItem = async (req, res = response) => {
//   const itemLabId = req.params.itemLabId; // Recupera el ID del item
//   const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
//   console.log("ID del item a eliminar:", itemLabId);

//   try {
//     const itemLab = await ItemLab.findByIdAndDelete(itemLabId);

//     if (!itemLab) {
//       return res.status(404).json({
//         ok: false,
//         msg: "Item no encontrado",
//       });
//     }

//     //Generar respuesta exitosa
//     return res.status(200).json({
//       ok: true,
//       msg: "Item eliminado",
//     });
//   } catch (error) {
//     console.error("Error al eliminar el item: ", error);
//     return res.status(500).json({
//       ok: false,
//       msg: "Error al momento de eliminar back end",
//     });
//   }
// };

module.exports = {
  crearItemLab,
  mostrarUltimosItems,
  encontrarTermino,
  actualizarItem,
  // eliminarItem,
};
