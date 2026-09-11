const { response } = require("express");
const PruebaLab = require("../../models/Mantenimiento/PruebaLab");
const mongoose = require("mongoose");
const LaboratorioReferencia = require("../../models/Mantenimiento/LaboratorioReferencia");
const ItemLab = require("../../models/Mantenimiento/ItemLab");
const TipoMuestra = require("../../models/Mantenimiento/TipoMuestra");
const TuboEnvase = require("../../models/Mantenimiento/TuboEnvase");

// ====== Obtener referencias actuales de la prueba ======

const obtenerReferenciasActualesPruebaLab = (prueba) => {
  const items = new Set();
  const tiposMuestra = new Set();
  const tubosEnvases = new Set();

  if (!prueba) {
    return {
      items,
      tiposMuestra,
      tubosEnvases,
    };
  }

  // ====== Items actuales ======

  const grupos = prueba.gruposResultado ?? [];

  for (const grupo of grupos) {
    const itemsGrupo = grupo.items ?? [];

    for (const item of itemsGrupo) {
      const itemId = item.itemLabId?._id ?? item.itemLabId;

      if (itemId) {
        items.add(String(itemId));
      }
    }
  }

  // ====== Muestras y tubos actuales ======

  const requerimientos = prueba.requerimientosMuestra ?? [];

  for (const requerimiento of requerimientos) {
    const opciones = requerimiento.opciones ?? [];

    for (const opcion of opciones) {
      const tipoMuestraId = opcion.tipoMuestraId?._id ?? opcion.tipoMuestraId;
      const tuboEnvaseId = opcion.tuboEnvaseId?._id ?? opcion.tuboEnvaseId;

      if (tipoMuestraId) {
        tiposMuestra.add(String(tipoMuestraId));
      }

      if (tuboEnvaseId) {
        tubosEnvases.add(String(tuboEnvaseId));
      }
    }
  }

  return {
    items,
    tiposMuestra,
    tubosEnvases,
  };
};

// ====== Validar Items y requerimientos de muestra ======

const validarMuestrasPruebaLab = async (datos, pruebaActual = null) => {
  const referenciasActuales = obtenerReferenciasActualesPruebaLab(pruebaActual);

  const grupos = datos.gruposResultado ?? [];

  const itemsComposicion = new Set();

  // ====== Obtener y validar IDs de Items ======

  for (let i = 0; i < grupos.length; i++) {
    const items = grupos[i]?.items ?? [];

    for (let j = 0; j < items.length; j++) {
      const itemId = items[j]?.itemLabId?._id ?? items[j]?.itemLabId;

      if (!itemId || !mongoose.isValidObjectId(itemId)) {
        return {
          ok: false,
          msg: `El Item ${j + 1} del Grupo ${i + 1} no tiene un identificador válido.`,
        };
      }

      itemsComposicion.add(String(itemId));
    }
  }

  // ====== Verificar existencia de Items ======

  const idsItems = [...itemsComposicion];

  const itemsBD = await ItemLab.find({
    _id: {
      $in: idsItems,
    },
  })
    .select("_id codItemLab nombreInforme estadoItem")
    .lean();

  const itemsMap = new Map(itemsBD.map((item) => [String(item._id), item]));

  for (const itemId of idsItems) {
    const item = itemsMap.get(itemId);

    if (!item) {
      return {
        ok: false,
        msg: `Uno de los Items configurados en la prueba ya no existe.`,
      };
    }

    if (
      item.estadoItem === "INACTIVO" &&
      !referenciasActuales.items.has(itemId)
    ) {
      return {
        ok: false,
        msg: `El Item "${item.nombreInforme}" se encuentra INACTIVO y no puede agregarse a la prueba.`,
      };
    }
  }

  // ====== No requiere muestra ======

  const requiereMuestra = datos.requiereMuestra !== false;

  if (!requiereMuestra) {
    return {
      ok: true,
    };
  }

  // ====== Debe existir al menos un requerimiento ======

  const requerimientos = datos.requerimientosMuestra;

  if (!Array.isArray(requerimientos) || requerimientos.length === 0) {
    return {
      ok: false,
      msg: "La prueba requiere muestra y debe tener al menos un requerimiento configurado.",
    };
  }

  const tiposMuestraUtilizados = new Set();

  const tubosEnvasesUtilizados = new Set();

  // ====== Validar requerimientos ======

  for (let i = 0; i < requerimientos.length; i++) {
    const requerimiento = requerimientos[i];

    const numero = i + 1;

    const alcance = requerimiento?.alcance;

    if (!["TODA_PRUEBA", "ITEMS_ESPECIFICOS"].includes(alcance)) {
      return {
        ok: false,
        msg: `El alcance del requerimiento ${numero} no es válido.`,
      };
    }

    // ====== Opciones de muestra ======

    const opciones = requerimiento?.opciones;

    if (!Array.isArray(opciones) || opciones.length === 0) {
      return {
        ok: false,
        msg: `El requerimiento ${numero} debe tener al menos una alternativa de muestra.`,
      };
    }

    for (let j = 0; j < opciones.length; j++) {
      const opcion = opciones[j];

      const tipoMuestraId = opcion?.tipoMuestraId?._id ?? opcion?.tipoMuestraId;

      const tuboEnvaseId = opcion?.tuboEnvaseId?._id ?? opcion?.tuboEnvaseId;

      if (!tipoMuestraId || !mongoose.isValidObjectId(tipoMuestraId)) {
        return {
          ok: false,
          msg: `La alternativa ${j + 1} del requerimiento ${numero} tiene un tipo de muestra no válido.`,
        };
      }

      if (!tuboEnvaseId || !mongoose.isValidObjectId(tuboEnvaseId)) {
        return {
          ok: false,
          msg: `La alternativa ${j + 1} del requerimiento ${numero} tiene un tubo/envase no válido.`,
        };
      }

      tiposMuestraUtilizados.add(String(tipoMuestraId));

      tubosEnvasesUtilizados.add(String(tuboEnvaseId));
    }

    // ====== Items específicos ======

    const itemsAsociados = Array.isArray(requerimiento?.itemsAsociados)
      ? requerimiento.itemsAsociados
      : [];

    if (alcance === "ITEMS_ESPECIFICOS" && itemsAsociados.length === 0) {
      return {
        ok: false,
        msg: `El requerimiento ${numero} debe tener al menos un Item asociado.`,
      };
    }

    if (alcance === "ITEMS_ESPECIFICOS") {
      const itemsAsociadosUnicos = new Set();

      for (const item of itemsAsociados) {
        const itemId = item?._id ?? item;

        if (!itemId || !mongoose.isValidObjectId(itemId)) {
          return {
            ok: false,
            msg: `El requerimiento ${numero} contiene un Item asociado no válido.`,
          };
        }

        const id = String(itemId);

        if (!itemsComposicion.has(id)) {
          return {
            ok: false,
            msg: `El requerimiento ${numero} contiene un Item que no pertenece a la composición de la prueba.`,
          };
        }

        if (itemsAsociadosUnicos.has(id)) {
          return {
            ok: false,
            msg: `El requerimiento ${numero} contiene el mismo Item asociado más de una vez.`,
          };
        }

        itemsAsociadosUnicos.add(id);
      }
    }

    // ====== Cantidad de recipientes ======

    const cantidadRecipientes = Number(requerimiento?.cantidadRecipientes ?? 1);

    if (!Number.isInteger(cantidadRecipientes) || cantidadRecipientes < 1) {
      return {
        ok: false,
        msg: `La cantidad de recipientes del requerimiento ${numero} debe ser un número entero mayor o igual a 1.`,
      };
    }

    // ====== Volumen mínimo ======

    const volumenMinimo = requerimiento?.volumenMinimo;

    const tieneVolumen =
      volumenMinimo !== null &&
      volumenMinimo !== undefined &&
      volumenMinimo !== "";

    if (tieneVolumen) {
      const volumen = Number(volumenMinimo);

      if (!Number.isFinite(volumen) || volumen < 0) {
        return {
          ok: false,
          msg: `El volumen mínimo del requerimiento ${numero} no es válido.`,
        };
      }

      if (!requerimiento?.unidadVolumen) {
        return {
          ok: false,
          msg: `Debe indicar la unidad del volumen mínimo en el requerimiento ${numero}.`,
        };
      }
    }
  }

  // ====== Validar Tipos de Muestra existentes ======

  const idsTiposMuestra = [...tiposMuestraUtilizados];

  const tiposMuestraBD = await TipoMuestra.find({
    _id: {
      $in: idsTiposMuestra,
    },
  })
    .select("_id nombreTipoMuestra estadoTipoMuestra")
    .lean();

  const tiposMuestraMap = new Map(
    tiposMuestraBD.map((tipo) => [String(tipo._id), tipo]),
  );

  for (const tipoId of idsTiposMuestra) {
    const tipo = tiposMuestraMap.get(tipoId);

    if (!tipo) {
      return {
        ok: false,
        msg: "Uno de los tipos de muestra configurados no existe.",
      };
    }

    if (
      tipo.estadoTipoMuestra === "INACTIVO" &&
      !referenciasActuales.tiposMuestra.has(tipoId)
    ) {
      return {
        ok: false,
        msg: `El tipo de muestra "${tipo.nombreTipoMuestra}" se encuentra INACTIVO.`,
      };
    }
  }

  // ====== Validar Tubos / Envases existentes ======

  const idsTubosEnvases = [...tubosEnvasesUtilizados];

  const tubosEnvasesBD = await TuboEnvase.find({
    _id: {
      $in: idsTubosEnvases,
    },
  })
    .select("_id nombreTuboEnvase estadoTuboEnvase")
    .lean();

  const tubosEnvasesMap = new Map(
    tubosEnvasesBD.map((tubo) => [String(tubo._id), tubo]),
  );

  for (const tuboId of idsTubosEnvases) {
    const tubo = tubosEnvasesMap.get(tuboId);

    if (!tubo) {
      return {
        ok: false,
        msg: "Uno de los tubos/envases configurados no existe.",
      };
    }

    if (
      tubo.estadoTuboEnvase === "INACTIVO" &&
      !referenciasActuales.tubosEnvases.has(tuboId)
    ) {
      return {
        ok: false,
        msg: `El tubo/envase "${tubo.nombreTuboEnvase}" se encuentra INACTIVO.`,
      };
    }
  }

  return {
    ok: true,
  };
};

// ====== Normalizar configuración de muestras ======

const normalizarConfiguracionMuestras = (datos) => {
  if (datos.requiereMuestra === false) {
    datos.requerimientosMuestra = [];
  }
};

// ====== Obtener laboratorios configurados actualmente ======

const obtenerLaboratoriosReferenciaActuales = (prueba) => {
  const laboratorios = new Set();

  if (!prueba) {
    return laboratorios;
  }

  const agregarLaboratorio = (procesamiento) => {
    if (!procesamiento || procesamiento.tipo !== "REFERENCIA") {
      return;
    }

    const laboratorioId =
      procesamiento.laboratorioReferenciaId?._id ??
      procesamiento.laboratorioReferenciaId;

    if (laboratorioId) {
      laboratorios.add(String(laboratorioId));
    }
  };

  agregarLaboratorio(prueba.procesamientoDefault);

  const grupos = prueba.gruposResultado ?? [];

  for (const grupo of grupos) {
    agregarLaboratorio(grupo.procesamientoOverride);

    const items = grupo.items ?? [];

    for (const item of items) {
      agregarLaboratorio(item.procesamientoOverride);
    }
  }

  return laboratorios;
};

// ====== Validar procesamiento de PruebaLab ======

const validarProcesamientoPruebaLab = async (datos, pruebaActual = null) => {
  const tiposValidos = new Set(["INTERNO", "REFERENCIA"]);

  const referencias = [];

  // ====== Validar estructura de procesamiento ======

  const validarProcesamiento = (
    procesamiento,
    ubicacion,
    obligatorio = false,
  ) => {
    if (!procesamiento) {
      if (obligatorio) {
        return {
          ok: false,
          msg: `Debe configurar el procesamiento de ${ubicacion}.`,
        };
      }

      return null;
    }

    const tipo = procesamiento.tipo;

    if (!tiposValidos.has(tipo)) {
      return {
        ok: false,
        msg: `El tipo de procesamiento de ${ubicacion} no es válido.`,
      };
    }

    const laboratorioReferenciaId =
      procesamiento.laboratorioReferenciaId?._id ??
      procesamiento.laboratorioReferenciaId;

    // ====== Procesamiento interno ======

    if (tipo === "INTERNO") {
      if (laboratorioReferenciaId) {
        return {
          ok: false,
          msg: `${ubicacion} tiene procesamiento INTERNO y no debe tener laboratorio de referencia.`,
        };
      }

      return null;
    }

    // ====== Procesamiento por referencia ======

    if (!laboratorioReferenciaId) {
      return {
        ok: false,
        msg: `${ubicacion} tiene procesamiento por REFERENCIA y debe indicar un laboratorio de referencia.`,
      };
    }

    if (!mongoose.isValidObjectId(laboratorioReferenciaId)) {
      return {
        ok: false,
        msg: `El laboratorio de referencia configurado en ${ubicacion} no tiene un identificador válido.`,
      };
    }

    referencias.push({
      laboratorioReferenciaId: String(laboratorioReferenciaId),
      ubicacion,
    });

    return null;
  };

  // ====== Procesamiento general ======

  const procesamientoDefault = datos.procesamientoDefault ?? {
    tipo: "INTERNO",
    laboratorioReferenciaId: null,
  };

  let error = validarProcesamiento(procesamientoDefault, "la prueba", true);

  if (error) {
    return error;
  }

  // ====== Procesamiento de grupos e Items ======

  const grupos = datos.gruposResultado ?? [];

  for (let i = 0; i < grupos.length; i++) {
    const grupo = grupos[i];

    error = validarProcesamiento(
      grupo.procesamientoOverride,
      `el Grupo ${i + 1}`,
    );

    if (error) {
      return error;
    }

    const items = grupo.items ?? [];

    for (let j = 0; j < items.length; j++) {
      const item = items[j];

      error = validarProcesamiento(
        item.procesamientoOverride,
        `el Item ${j + 1} del Grupo ${i + 1}`,
      );

      if (error) {
        return error;
      }
    }
  }

  // ====== Si no existen referencias no hay nada más que validar ======

  if (referencias.length === 0) {
    return {
      ok: true,
    };
  }

  // ====== Buscar laboratorios utilizados ======

  const idsUnicos = [
    ...new Set(
      referencias.map((referencia) => referencia.laboratorioReferenciaId),
    ),
  ];

  const laboratorios = await LaboratorioReferencia.find({
    _id: {
      $in: idsUnicos,
    },
  })
    .select(
      "_id codLaboratorioReferencia nombreLaboratorio estadoLaboratorioReferencia",
    )
    .lean();

  const laboratoriosMap = new Map(
    laboratorios.map((laboratorio) => [String(laboratorio._id), laboratorio]),
  );

  // ====== Laboratorios permitidos por configuración histórica ======

  const laboratoriosActuales =
    obtenerLaboratoriosReferenciaActuales(pruebaActual);

  // ====== Validar existencia y estado ======

  for (const referencia of referencias) {
    const laboratorio = laboratoriosMap.get(referencia.laboratorioReferenciaId);

    if (!laboratorio) {
      return {
        ok: false,
        msg: `El laboratorio de referencia configurado en ${referencia.ubicacion} no existe.`,
      };
    }

    if (
      laboratorio.estadoLaboratorioReferencia !== "ACTIVO" &&
      !laboratoriosActuales.has(referencia.laboratorioReferenciaId)
    ) {
      return {
        ok: false,
        msg: `El laboratorio "${laboratorio.nombreLaboratorio}" configurado en ${referencia.ubicacion} se encuentra INACTIVO.`,
      };
    }
  }

  return {
    ok: true,
  };
};

// ====== Validar composición de PruebaLab ======

const validarComposicionPruebaLab = (datos) => {
  const gruposResultado = datos.gruposResultado;

  // ====== Debe existir al menos un grupo ======

  if (!Array.isArray(gruposResultado) || gruposResultado.length === 0) {
    return {
      ok: false,
      msg: "La prueba debe contener al menos un grupo de resultados.",
    };
  }

  const ordenesGrupo = new Map();
  const itemsAsignados = new Map();

  for (let i = 0; i < gruposResultado.length; i++) {
    const grupo = gruposResultado[i];
    const nombreGrupo = grupo?.nombreGrupo?.trim() ?? "";
    const mostrarTitulo = grupo?.mostrarTitulo === true;
    const items = Array.isArray(grupo?.items) ? grupo.items : [];

    // ====== Mostrar título requiere nombre ======

    if (mostrarTitulo && !nombreGrupo) {
      return {
        ok: false,
        msg: `El Grupo ${i + 1} está configurado para mostrar título y debe tener un nombre.`,
      };
    }

    // ====== Cada grupo debe contener al menos un Item ======

    if (items.length === 0) {
      return {
        ok: false,
        msg: nombreGrupo
          ? `El Grupo ${i + 1} "${nombreGrupo}" debe contener al menos un Item.`
          : `El Grupo ${i + 1} debe contener al menos un Item.`,
      };
    }

    // ====== Orden de grupo no repetido ======

    const ordenGrupo = Number(grupo?.ordenGrupo);

    if (ordenesGrupo.has(ordenGrupo)) {
      const grupoAnterior = ordenesGrupo.get(ordenGrupo);

      return {
        ok: false,
        msg: `Los Grupos ${grupoAnterior + 1} y ${
          i + 1
        } tienen el mismo orden ${ordenGrupo}.`,
      };
    }

    ordenesGrupo.set(ordenGrupo, i);

    // ====== Órdenes de Items dentro del grupo ======

    const ordenesItem = new Map();

    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const itemLabId = item?.itemLabId?._id ?? item?.itemLabId;

      if (!itemLabId) {
        return {
          ok: false,
          msg: `El Item ${j + 1} del Grupo ${i + 1} no tiene un itemLabId válido.`,
        };
      }

      const itemId = String(itemLabId);

      // ====== Item no repetido en toda la prueba ======

      if (itemsAsignados.has(itemId)) {
        const anterior = itemsAsignados.get(itemId);

        return {
          ok: false,
          msg: `El mismo Item está asignado más de una vez en la prueba: Grupo ${
            anterior.grupoIndex + 1
          } y Grupo ${i + 1}.`,
        };
      }

      itemsAsignados.set(itemId, {
        grupoIndex: i,
        itemIndex: j,
      });

      // ====== Orden de Item no repetido dentro del grupo ======

      const ordenItem = Number(item?.ordenItem);

      if (ordenesItem.has(ordenItem)) {
        const itemAnterior = ordenesItem.get(ordenItem);

        return {
          ok: false,
          msg: `Los Items ${itemAnterior + 1} y ${
            j + 1
          } del Grupo ${i + 1} tienen el mismo orden ${ordenItem}.`,
        };
      }

      ordenesItem.set(ordenItem, j);
    }
  }

  return {
    ok: true,
  };
};

const crearPruebaLab = async (req, res = response) => {
  const { nombrePruebaLab } = req.body;
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  const prefijoCodigo = "LC";

  try {
    // verificar si la prueba existe
    const pruebaLab = await PruebaLab.findOne({ nombrePruebaLab });

    if (pruebaLab) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una prueba con ese nombre",
      });
    }

    // ====== Validar composición ======

    const validacionComposicion = validarComposicionPruebaLab(req.body);

    if (!validacionComposicion.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacionComposicion.msg,
      });
    }

    // ====== Validar procesamiento ======

    const validacionProcesamiento = await validarProcesamientoPruebaLab(
      req.body,
    );

    if (!validacionProcesamiento.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacionProcesamiento.msg,
      });
    }

    // ====== Normalizar muestras ======

    normalizarConfiguracionMuestras(req.body);

    // ====== Validar muestras ======

    const validacionMuestras = await validarMuestrasPruebaLab(req.body);

    if (!validacionMuestras.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacionMuestras.msg,
      });
    }

    //creando codigo prueba
    // Buscar el última prueba creada en el área
    const ultimaPrueba = await PruebaLab.findOne().sort({ codPruebaLab: -1 });

    // Obtener el correlativo
    let correlativo = 1;
    if (ultimaPrueba) {
      const ultimoCorrelativo = parseInt(ultimaPrueba.codPruebaLab.slice(2, 6));
      correlativo = ultimoCorrelativo + 1;
    }

    if (correlativo > 9999) {
      return res.status(400).json({
        ok: false,
        msg: "El número máximo de pruebas ha sido alcanzado para este área.",
      });
    }

    // Correlativo con seis dígitos, maximo 9999
    const correlativoStr = correlativo.toString().padStart(4, "0");

    // Crear el número de código
    const codigoLab = `${prefijoCodigo}${correlativoStr}`;

    // Crear la prueba con el código
    const nuevaPruebaLab = new PruebaLab({
      ...req.body,
      codPruebaLab: codigoLab, // Agregar el código de la prueba generado
      createdBy: uid, // uid del usuario que creó la prueba
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó la prueba
      fechaRegistro: new Date(), // Fecha de registro
    });

    await nuevaPruebaLab.save();
    // console.log(dbUser, "pasoo registro");
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      uid: nuevaPruebaLab.id,
      //token: token,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimasPruebas = async (req, res = response) => {
  try {
    const pruebasLab = await PruebaLab.find()
      .populate({
        path: "gruposResultado.items.itemLabId",
        select:
          "_id codItemLab nombreInforme nombreHojaTrabajo contextoAnalitico tipoResultado estadoItem",
      })
      .sort({
        createdAt: -1,
      });

    return res.json({
      ok: true,
      pruebasLab,
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
  const termino = req.query.search ?? "";

  try {
    const pruebasLab = await PruebaLab.find({
      $or: [
        {
          nombrePruebaLab: {
            $regex: termino,
            $options: "i",
          },
        },
        {
          codPruebaLab: {
            $regex: termino,
            $options: "i",
          },
        },
      ],
    })
      .populate({
        path: "gruposResultado.items.itemLabId",
        select:
          "_id codItemLab nombreInforme nombreHojaTrabajo contextoAnalitico tipoResultado estadoItem",
      })
      .sort({
        createdAt: -1,
      });

    return res.json({
      ok: true,
      pruebasLab,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const actualizarPrueba = async (req, res = response) => {
  const codPrueba = req.params.codPruebaLab; //recupera el codPrueba
  const datosActualizados = req.body; //recupera los datos a grabar
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
  delete datosActualizados._id; //quita los _id generados por el mongo y que no se pueden modificar

  try {
    // Obtener la prueba actual para validaciones
    const pruebaActual = await PruebaLab.findOne({ codPruebaLab: codPrueba });

    if (!pruebaActual) {
      return res.status(404).json({
        ok: false,
        msg: "Prueba no encontrada con ese código",
      });
    }

    // ====== Normalizar muestras ======

    normalizarConfiguracionMuestras(datosActualizados);

    // ====== Validar muestras ======

    const validacionMuestras = await validarMuestrasPruebaLab(
      datosActualizados,
      pruebaActual,
    );

    if (!validacionMuestras.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacionMuestras.msg,
      });
    }

    // ====== Validar composición ======

    const validacionComposicion =
      validarComposicionPruebaLab(datosActualizados);

    if (!validacionComposicion.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacionComposicion.msg,
      });
    }

    // ====== Validar procesamiento ======

    const validacionProcesamiento = await validarProcesamientoPruebaLab(
      datosActualizados,
      pruebaActual,
    );

    if (!validacionProcesamiento.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacionProcesamiento.msg,
      });
    }

    const pruebaLab = await PruebaLab.findOneAndUpdate(
      { codPruebaLab: codPrueba },
      {
        $set: datosActualizados,
        updatedBy: uid, // uid del usuario que actualiza
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true, runValidators: true },
    );

    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      //uid: dbPaciente.id,
      //token: token,
    });
  } catch (error) {
    console.error("Error al actualizar la prueba: ", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};

module.exports = {
  crearPruebaLab,
  mostrarUltimasPruebas,
  encontrarTermino,
  actualizarPrueba,
};
