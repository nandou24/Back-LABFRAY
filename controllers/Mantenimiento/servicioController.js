const { response } = require("express");
const mongoose = require("mongoose");

const Servicio = require("../../models/Mantenimiento/Servicio");
const PruebaLab = require("../../models/Mantenimiento/PruebaLab");

// ====== Constantes ======

const TIPOS_SERVICIO = [
  "Laboratorio",
  "Ecografía",
  "Rayos X",
  "Consulta",
  "Procedimiento",
];

const TIPOS_EXAMEN = [
  "LABORATORIO",
  "ECOGRAFIA",
  "RAYOS_X",
  "CONSULTA",
  "PROCEDIMIENTO",
];

const MODALIDADES_INSTANCIAS = [
  "UNICA",
  "MUESTRAS_INDEPENDIENTES",
  "REPETICIONES_MISMA_MUESTRA",
];

// ====== Utilitarios ======

const escaparRegex = (valor = "") => {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// ====== Prefijo del servicio ======

const obtenerPrefijoServicio = (claseServicio, tipoServicio) => {
  if (claseServicio === "PAQUETE") {
    return "PAQ";
  }

  switch (tipoServicio) {
    case "Laboratorio":
      return "LAB";

    case "Ecografía":
      return "ECO";

    case "Rayos X":
      return "RX";

    case "Consulta":
      return "CON";

    case "Procedimiento":
      return "PRO";

    default:
      return null;
  }
};

// ====== Generar código ======

const generarCodigoServicio = async (claseServicio, tipoServicio) => {
  const prefijo = obtenerPrefijoServicio(claseServicio, tipoServicio);

  if (!prefijo) {
    throw new Error("No se pudo determinar el prefijo del servicio");
  }

  const regexCodigo = new RegExp(`^${prefijo}\\d{4}$`);

  const ultimoServicio = await Servicio.findOne({
    codServicio: regexCodigo,
  })
    .sort({
      codServicio: -1,
    })
    .select("codServicio")
    .lean();

  let correlativo = 1;

  if (ultimoServicio?.codServicio) {
    const ultimoCorrelativo = Number(
      ultimoServicio.codServicio.slice(prefijo.length),
    );

    if (!Number.isNaN(ultimoCorrelativo)) {
      correlativo = ultimoCorrelativo + 1;
    }
  }

  if (correlativo > 9999) {
    throw new Error(
      "El número máximo de servicios ha sido alcanzado para este tipo de servicio",
    );
  }

  return `${prefijo}${correlativo.toString().padStart(4, "0")}`;
};

// ====== Normalizar componente ======

const normalizarComponenteClinico = (componente) => {
  const modalidad = componente.modalidadInstancias ?? "UNICA";

  const numeroInstancias =
    modalidad === "UNICA" ? 1 : Number(componente.numeroInstancias ?? 1);

  const etiquetas =
    modalidad === "UNICA"
      ? []
      : Array.isArray(componente.etiquetasInstancias)
        ? componente.etiquetasInstancias.map((etiqueta) =>
            String(etiqueta ?? "").trim(),
          )
        : [];

  return {
    tipoExamen: componente.tipoExamen ?? null,

    referenciaId: componente.referenciaId || null,

    codExamen: String(componente.codExamen ?? "").trim(),

    nombreExamen: String(componente.nombreExamen ?? "").trim(),

    numeroInstancias,

    modalidadInstancias: modalidad,

    etiquetasInstancias: etiquetas,
  };
};

// ====== Normalizar payload ======

const normalizarDatosServicio = (body) => {
  const claseServicio = body.claseServicio ?? "INDIVIDUAL";

  const examenesServicio = Array.isArray(body.examenesServicio)
    ? body.examenesServicio.map(normalizarComponenteClinico)
    : [];

  const profesionesAsociadas = Array.isArray(body.profesionesAsociadas)
    ? body.profesionesAsociadas.map((profesion) => ({
        profesionId: profesion.profesionId,
        especialidadId: profesion.especialidadId || null,
      }))
    : [];

  const serviciosIncluidos = Array.isArray(body.serviciosIncluidos)
    ? body.serviciosIncluidos.map((servicio) => ({
        servicioId: servicio.servicioId,
        cantidad: Number(servicio.cantidad ?? 1),
      }))
    : [];

  return {
    claseServicio,

    tipoServicio: claseServicio === "PAQUETE" ? null : body.tipoServicio,

    nombreServicio: String(body.nombreServicio ?? "").trim(),

    descripcionServicio: String(body.descripcionServicio ?? "").trim(),

    precioServicio: Number(body.precioServicio),

    estadoServicio: body.estadoServicio ?? true,

    favoritoServicio: body.favoritoServicio ?? false,

    favoritoServicioEmpresa: body.favoritoServicioEmpresa ?? false,

    requiereSeleccionProfesional: body.requiereSeleccionProfesional ?? false,

    profesionesAsociadas,

    examenesServicio,

    serviciosIncluidos,
  };
};

// ====== Validar nombre duplicado ======

const validarNombreDuplicado = async (
  nombreServicio,
  servicioIdExcluir = null,
) => {
  const nombre = String(nombreServicio ?? "").trim();

  const filtro = {
    nombreServicio: {
      $regex: `^${escaparRegex(nombre)}$`,
      $options: "i",
    },
  };

  if (servicioIdExcluir) {
    filtro._id = {
      $ne: servicioIdExcluir,
    };
  }

  return Servicio.findOne(filtro).lean();
};

// ====== Validar configuración profesional ======

const validarConfiguracionProfesional = (datos) => {
  if (
    datos.requiereSeleccionProfesional &&
    datos.profesionesAsociadas.length === 0
  ) {
    return "Debe agregar al menos una profesión asociada cuando el servicio requiere selección de profesional";
  }

  return null;
};

// ====== Validar componentes clínicos ======

const validarComponentesClinicos = async (componentes) => {
  const claves = new Set();

  const referenciasLaboratorio = [];

  for (const componente of componentes) {
    if (
      !componente.tipoExamen ||
      !TIPOS_EXAMEN.includes(componente.tipoExamen)
    ) {
      return "Todos los componentes clínicos deben indicar un tipo válido";
    }

    if (!componente.codExamen || !componente.nombreExamen) {
      return "Todos los componentes clínicos deben tener código y nombre";
    }

    // ====== Evitar duplicados ======

    const clave =
      `${componente.tipoExamen}|` +
      `${componente.referenciaId || componente.codExamen}`;

    if (claves.has(clave)) {
      return `El componente ${componente.codExamen} está duplicado`;
    }

    claves.add(clave);

    // ====== Instancia única ======

    if (componente.modalidadInstancias === "UNICA") {
      if (Number(componente.numeroInstancias) !== 1) {
        return `El componente ${componente.codExamen} con modalidad UNICA debe tener una sola instancia`;
      }

      if (componente.etiquetasInstancias.length > 0) {
        return `El componente ${componente.codExamen} con modalidad UNICA no debe tener etiquetas de instancia`;
      }
    }

    // ====== Instancias múltiples ======

    if (componente.modalidadInstancias !== "UNICA") {
      if (
        !Number.isInteger(componente.numeroInstancias) ||
        componente.numeroInstancias < 2
      ) {
        return `El componente ${componente.codExamen} debe tener al menos dos instancias`;
      }

      if (
        componente.etiquetasInstancias.length !== componente.numeroInstancias
      ) {
        return `El componente ${componente.codExamen} debe tener una etiqueta por cada instancia`;
      }

      const etiquetaVacia = componente.etiquetasInstancias.some(
        (etiqueta) => !etiqueta,
      );

      if (etiquetaVacia) {
        return `Todas las instancias del componente ${componente.codExamen} deben tener una etiqueta`;
      }
    }

    // ====== Configuración de laboratorio ======

    if (componente.tipoExamen === "LABORATORIO") {
      const referencia = componente.referenciaId;

      if (!referencia) {
        return `El componente de laboratorio ${componente.codExamen} no tiene referencia a PruebaLab`;
      }

      if (!mongoose.Types.ObjectId.isValid(referencia)) {
        return `La referencia de laboratorio del componente ${componente.codExamen} no es válida`;
      }

      referenciasLaboratorio.push(referencia.toString());
    } else {
      // Las modalidades basadas en muestras,
      // por ahora solo aplican a Laboratorio.
      if (
        componente.modalidadInstancias !== "UNICA" ||
        componente.numeroInstancias !== 1 ||
        componente.etiquetasInstancias.length
      ) {
        return `La configuración de instancias múltiples solo está habilitada para componentes de laboratorio`;
      }
    }
  }

  // ====== Validar existencia PruebaLab ======

  const idsUnicos = [...new Set(referenciasLaboratorio)];

  if (idsUnicos.length > 0) {
    const cantidadPruebas = await PruebaLab.countDocuments({
      _id: {
        $in: idsUnicos,
      },
    });

    if (cantidadPruebas !== idsUnicos.length) {
      return "Una o más referencias de laboratorio no existen";
    }
  }

  return null;
};

// ====== Validar paquete ======

const validarPaquete = async (datos, servicioActualId = null) => {
  if (datos.claseServicio !== "PAQUETE") {
    if (datos.serviciosIncluidos.length > 0) {
      return "Un servicio individual no puede contener servicios incluidos";
    }

    return null;
  }

  if (datos.examenesServicio.length > 0) {
    return "Un paquete no debe contener componentes clínicos directamente";
  }

  if (datos.serviciosIncluidos.length === 0) {
    return "El paquete debe contener al menos un servicio";
  }

  const ids = datos.serviciosIncluidos.map((item) =>
    item.servicioId.toString(),
  );

  const idsUnicos = [...new Set(ids)];

  if (ids.length !== idsUnicos.length) {
    return "Un mismo servicio no puede agregarse más de una vez al paquete";
  }

  if (servicioActualId && idsUnicos.includes(servicioActualId.toString())) {
    return "Un paquete no puede incluirse a sí mismo";
  }

  const servicios = await Servicio.find({
    _id: {
      $in: idsUnicos,
    },
  })
    .select("_id claseServicio codServicio nombreServicio")
    .lean();

  if (servicios.length !== idsUnicos.length) {
    return "Uno o más servicios incluidos no existen";
  }

  const paqueteAnidado = servicios.find(
    (servicio) => servicio.claseServicio === "PAQUETE",
  );

  if (paqueteAnidado) {
    return `El servicio ${paqueteAnidado.codServicio} es un paquete. No se permiten paquetes dentro de paquetes`;
  }

  return null;
};

// ====== Validar estructura general ======

const validarEstructuraServicio = async (datos, servicioActualId = null) => {
  if (!["INDIVIDUAL", "PAQUETE"].includes(datos.claseServicio)) {
    return "Clase de servicio no válida";
  }

  if (datos.claseServicio === "INDIVIDUAL") {
    if (!TIPOS_SERVICIO.includes(datos.tipoServicio)) {
      return "Tipo de servicio no válido";
    }
  }

  if (!datos.nombreServicio) {
    return "Nombre de servicio es obligatorio";
  }

  if (Number.isNaN(datos.precioServicio) || datos.precioServicio < 0) {
    return "Precio de servicio no válido";
  }

  const errorProfesional = validarConfiguracionProfesional(datos);

  if (errorProfesional) {
    return errorProfesional;
  }

  const errorComponentes = await validarComponentesClinicos(
    datos.examenesServicio,
  );

  if (errorComponentes) {
    return errorComponentes;
  }

  const errorPaquete = await validarPaquete(datos, servicioActualId);

  if (errorPaquete) {
    return errorPaquete;
  }

  return null;
};

// ====== Crear servicio ======

const crearServicio = async (req, res = response) => {
  const { uid, nombreUsuario } = req.user;

  try {
    const datos = normalizarDatosServicio(req.body);

    // ====== Validar estructura ======

    const errorEstructura = await validarEstructuraServicio(datos);

    if (errorEstructura) {
      return res.status(400).json({
        ok: false,
        msg: errorEstructura,
      });
    }

    // ====== Validar nombre duplicado ======

    const servicioExistente = await validarNombreDuplicado(
      datos.nombreServicio,
    );

    if (servicioExistente) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un servicio con ese nombre",
      });
    }

    // ====== Generar código ======

    const codigoServicio = await generarCodigoServicio(
      datos.claseServicio,
      datos.tipoServicio,
    );

    // ====== Crear ======

    const nuevoServicio = new Servicio({
      ...datos,

      codServicio: codigoServicio,

      createdBy: uid,

      usuarioRegistro: nombreUsuario,

      fechaRegistro: new Date(),
    });

    await nuevoServicio.save();

    return res.status(201).json({
      ok: true,
      servicio: nuevoServicio,
    });
  } catch (error) {
    console.error("Error al crear servicio:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        ok: false,
        msg: "Ya existe un servicio con el código o nombre indicado",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar el servicio",
    });
  }
};

// ====== Listar servicios ======

const mostrarUltimosServicios = async (req, res = response) => {
  try {
    const servicios = await Servicio.find().sort({
      createdAt: -1,
    });

    return res.json({
      ok: true,
      servicios,
    });
  } catch (error) {
    console.error("Error al listar servicios:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta de servicios",
    });
  }
};

// ====== Favoritos ======

const mostrarServiciosFavoritos = async (req, res = response) => {
  try {
    const servicios = await Servicio.find({
      favoritoServicio: true,
    }).sort({
      nombreServicio: 1,
    });

    return res.json({
      ok: true,
      servicios,
    });
  } catch (error) {
    console.error("Error al listar servicios favoritos:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

// ====== Favoritos empresa ======

const mostrarServiciosFavoritosEmpresa = async (req, res = response) => {
  try {
    const servicios = await Servicio.find({
      favoritoServicioEmpresa: true,
    }).sort({
      nombreServicio: 1,
    });

    return res.json({
      ok: true,
      servicios,
    });
  } catch (error) {
    console.error("Error al listar favoritos empresa:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

// ====== Buscar servicio ======

const encontrarTermino = async (req, res = response) => {
  const termino = String(req.query.search ?? "").trim();

  try {
    if (!termino) {
      return res.json({
        ok: true,
        search: termino,
        servicios: [],
      });
    }

    const regex = new RegExp(escaparRegex(termino), "i");

    const servicios = await Servicio.find({
      $or: [
        {
          nombreServicio: regex,
        },
        {
          codServicio: regex,
        },
      ],
    }).sort({
      nombreServicio: 1,
    });

    return res.json({
      ok: true,
      search: termino,
      servicios,
    });
  } catch (error) {
    console.error("Error al buscar servicio:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

// ====== Expandir servicios individuales ======

const expandirServiciosIndividuales = async (idsServicios) => {
  const idsEntrada = [...new Set(idsServicios.map((id) => id.toString()))];

  // ====== Servicios solicitados ======

  const serviciosIniciales = await Servicio.find({
    _id: {
      $in: idsEntrada,
    },
  });

  const mapaInicial = new Map();

  serviciosIniciales.forEach((servicio) => {
    mapaInicial.set(servicio._id.toString(), servicio);
  });

  // ====== Obtener IDs incluidos ======

  const idsIncluidos = new Set();

  serviciosIniciales.forEach((servicio) => {
    if (servicio.claseServicio !== "PAQUETE") {
      return;
    }

    servicio.serviciosIncluidos.forEach((incluido) => {
      idsIncluidos.add(incluido.servicioId.toString());
    });
  });

  // ====== Consultar servicios incluidos ======

  let serviciosIncluidos = [];

  if (idsIncluidos.size > 0) {
    serviciosIncluidos = await Servicio.find({
      _id: {
        $in: [...idsIncluidos],
      },

      claseServicio: "INDIVIDUAL",
    });
  }

  const mapaIncluidos = new Map();

  serviciosIncluidos.forEach((servicio) => {
    mapaIncluidos.set(servicio._id.toString(), servicio);
  });

  // ====== Expandir ======

  const resultado = [];

  idsEntrada.forEach((idServicio) => {
    const servicio = mapaInicial.get(idServicio);

    if (!servicio) {
      return;
    }

    // ====== Servicio individual directo ======

    if (servicio.claseServicio === "INDIVIDUAL") {
      resultado.push({
        servicio,

        cantidad: 1,

        origen: {
          claseServicio: "INDIVIDUAL",

          servicioOrigenId: servicio._id,

          codServicioOrigen: servicio.codServicio,

          nombreServicioOrigen: servicio.nombreServicio,
        },
      });

      return;
    }

    // ====== Servicios del paquete ======

    servicio.serviciosIncluidos.forEach((incluido) => {
      const servicioIncluido = mapaIncluidos.get(
        incluido.servicioId.toString(),
      );

      if (!servicioIncluido) {
        return;
      }

      resultado.push({
        servicio: servicioIncluido,

        cantidad: Number(incluido.cantidad ?? 1),

        origen: {
          claseServicio: "PAQUETE",

          servicioOrigenId: servicio._id,

          codServicioOrigen: servicio.codServicio,

          nombreServicioOrigen: servicio.nombreServicio,
        },
      });
    });
  });

  return resultado;
};

// ====== Obtener servicios expandidos ======

const obtenerServiciosExpandidos = async (req, res = response) => {
  let servicioIds = req.query.servicioIds;

  if (typeof servicioIds === "string") {
    servicioIds = [servicioIds];
  }

  try {
    // ====== Validar IDs ======

    if (!Array.isArray(servicioIds) || servicioIds.length === 0) {
      return res.status(400).json({
        ok: false,
        msg: "Debe proporcionar al menos un servicio válido",
      });
    }

    const idsInvalidos = servicioIds.some(
      (id) => !mongoose.Types.ObjectId.isValid(id),
    );

    if (idsInvalidos) {
      return res.status(400).json({
        ok: false,
        msg: "Uno o más IDs de servicio no son válidos",
      });
    }

    // ====== Expandir ======

    const expandidos = await expandirServiciosIndividuales(servicioIds);

    if (expandidos.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: "No se encontraron servicios para expandir",
      });
    }

    // ====== Respuesta ======

    const serviciosExpandidos = expandidos.map(
      ({ servicio, cantidad, origen }) => ({
        servicioId: servicio._id,

        codServicio: servicio.codServicio,

        claseServicio: servicio.claseServicio,

        tipoServicio: servicio.tipoServicio,

        nombreServicio: servicio.nombreServicio,

        descripcionServicio: servicio.descripcionServicio,

        precioServicio: servicio.precioServicio,

        estadoServicio: servicio.estadoServicio,

        requiereSeleccionProfesional: servicio.requiereSeleccionProfesional,

        profesionesAsociadas: servicio.profesionesAsociadas ?? [],

        examenesServicio: servicio.examenesServicio ?? [],

        cantidad,

        origen,
      }),
    );

    return res.json({
      ok: true,
      serviciosExpandidos,
    });
  } catch (error) {
    console.error("Error al expandir servicios:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error interno al expandir servicios",
    });
  }
};

// ====== Obtener pruebas laboratorio por servicios ======

const obtenerItemsLaboratorioPorServicio = async (req, res = response) => {
  let servicioIds = req.query.servicioIds;

  if (typeof servicioIds === "string") {
    servicioIds = [servicioIds];
  }

  try {
    // ====== Validar IDs ======

    if (!Array.isArray(servicioIds) || servicioIds.length === 0) {
      return res.status(400).json({
        ok: false,
        msg: "Debe proporcionar al menos un servicio válido",
      });
    }

    const idsInvalidos = servicioIds.some(
      (id) => !mongoose.Types.ObjectId.isValid(id),
    );

    if (idsInvalidos) {
      return res.status(400).json({
        ok: false,
        msg: "Uno o más IDs de servicio no son válidos",
      });
    }

    // ====== Expandir servicios ======

    const serviciosExpandidos =
      await expandirServiciosIndividuales(servicioIds);

    if (serviciosExpandidos.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: "No se encontraron servicios con los IDs proporcionados",
      });
    }

    // ====== Obtener referencias Laboratorio ======

    const referencias = new Set();

    const componentesLaboratorio = [];

    serviciosExpandidos.forEach(({ servicio, cantidad, origen }) => {
      const componentes = servicio.examenesServicio ?? [];

      componentes.forEach((componente) => {
        if (componente.tipoExamen !== "LABORATORIO") {
          return;
        }

        if (!componente.referenciaId) {
          return;
        }

        referencias.add(componente.referenciaId.toString());

        componentesLaboratorio.push({
          servicioId: servicio._id,

          codServicio: servicio.codServicio,

          nombreServicio: servicio.nombreServicio,

          cantidadServicio: cantidad,

          origenServicio: origen,

          referenciaId: componente.referenciaId,

          codExamen: componente.codExamen,

          nombreExamen: componente.nombreExamen,

          numeroInstancias: componente.numeroInstancias ?? 1,

          modalidadInstancias: componente.modalidadInstancias ?? "UNICA",

          etiquetasInstancias: componente.etiquetasInstancias ?? [],
        });
      });
    });

    // ====== Sin pruebas asociadas ======

    if (referencias.size === 0) {
      return res.json({
        ok: true,

        msg: "Los servicios no tienen pruebas de laboratorio asociadas",

        pruebasLab: [],

        componentesLaboratorio: [],
      });
    }

    // ====== Consultar PruebaLab ======

    const pruebasLab = await PruebaLab.find({
      _id: {
        $in: [...referencias],
      },
    }).populate("gruposResultado.items.itemLabId");

    return res.json({
      ok: true,

      pruebasLab,

      componentesLaboratorio,
    });
  } catch (error) {
    console.error(
      "Error al obtener pruebas de laboratorio por servicios:",
      error,
    );

    return res.status(500).json({
      ok: false,
      msg: "Error interno al obtener pruebas de laboratorio",
    });
  }
};

// ====== Buscar componentes por tipo ======

const encontrarTipoExamen = async (req, res = response) => {
  const tipo = String(req.query.search ?? "").trim();

  try {
    switch (tipo) {
      // ====== Laboratorio ======

      case "Laboratorio": {
        const examenes = await PruebaLab.find().sort({
          nombrePruebaLab: 1,
        });

        return res.json({
          ok: true,
          maestroDisponible: true,
          examenes,
        });
      }

      // ====== Maestros pendientes ======

      case "Ecografía":
      case "Consulta":
      case "Consulta Médica":
      case "Procedimiento":
      case "Rayos X":
        return res.json({
          ok: true,
          maestroDisponible: false,
          examenes: [],
          msg: `El maestro clínico para ${tipo} todavía no está implementado`,
        });

      default:
        return res.status(400).json({
          ok: false,
          maestroDisponible: false,
          examenes: [],
          msg: "Tipo de componente no válido",
        });
    }
  } catch (error) {
    console.error("Error al obtener componentes por tipo:", error);

    return res.status(500).json({
      ok: false,
      examenes: [],
      msg: "Error interno al obtener componentes por tipo",
    });
  }
};

// ====== Actualizar servicio ======

const actualizarServicio = async (req, res = response) => {
  const codigoServicio = req.params.codServicio;

  const { uid, nombreUsuario } = req.user;

  try {
    // ====== Buscar servicio ======

    const servicio = await Servicio.findOne({
      codServicio: codigoServicio,
    });

    if (!servicio) {
      return res.status(404).json({
        ok: false,
        msg: "Servicio no encontrado con ese código",
      });
    }

    const datos = normalizarDatosServicio(req.body);

    // ====== Clase y tipo son inmutables ======

    if (datos.claseServicio !== servicio.claseServicio) {
      return res.status(400).json({
        ok: false,
        msg: "No se puede modificar la clase de un servicio existente",
      });
    }

    const tipoActual = servicio.tipoServicio ?? null;

    const tipoNuevo = datos.tipoServicio ?? null;

    if (tipoActual !== tipoNuevo) {
      return res.status(400).json({
        ok: false,
        msg: "No se puede modificar el tipo de un servicio existente",
      });
    }

    // ====== Validar estructura ======

    const errorEstructura = await validarEstructuraServicio(
      datos,
      servicio._id,
    );

    if (errorEstructura) {
      return res.status(400).json({
        ok: false,
        msg: errorEstructura,
      });
    }

    // ====== Nombre duplicado ======

    const servicioDuplicado = await validarNombreDuplicado(
      datos.nombreServicio,
      servicio._id,
    );

    if (servicioDuplicado) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe otro servicio con ese nombre",
      });
    }

    // ====== Actualizar ======

    servicio.set({
      ...datos,

      updatedBy: uid,

      usuarioActualizacion: nombreUsuario,

      fechaActualizacion: new Date(),
    });

    await servicio.save();

    return res.status(200).json({
      ok: true,
      servicio,
    });
  } catch (error) {
    console.error("Error al actualizar servicio:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        ok: false,
        msg: "Ya existe un servicio con los datos indicados",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar el servicio",
    });
  }
};

// ====== Exportar ======

module.exports = {
  crearServicio,
  mostrarUltimosServicios,
  encontrarTermino,
  encontrarTipoExamen,
  actualizarServicio,
  mostrarServiciosFavoritos,
  mostrarServiciosFavoritosEmpresa,
  obtenerServiciosExpandidos,
  obtenerItemsLaboratorioPorServicio,
};
