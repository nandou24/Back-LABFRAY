const crypto = require("crypto");
const mongoose = require("mongoose");
const { response } = require("express");

const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");

const MuestraLaboratorio = require("../../models/Gestion/MuestraLaboratorio");
const {
  subirArchivoStorage,
  eliminarArchivo,
} = require("../../utils/aws/s3Storage");

// ====== Obtener id normalizado ======

const obtenerId = (valor) => {
  if (!valor) {
    return null;
  }

  return valor._id ?? valor;
};

// ====== Construir clave de opción ======

const construirClaveOpcion = (opcion) => {
  const tipoMuestraId = obtenerId(opcion?.tipoMuestraId);

  const tuboEnvaseId = obtenerId(opcion?.tuboEnvaseId);

  if (!tipoMuestraId || !tuboEnvaseId) {
    return null;
  }

  return `${tipoMuestraId.toString()}:` + `${tuboEnvaseId.toString()}`;
};

// ====== Normalizar opción histórica ======

const normalizarOpcionMuestra = (opcion) => {
  const tipoMuestraId = obtenerId(opcion.tipoMuestraId);

  const tuboEnvaseId = obtenerId(opcion.tuboEnvaseId);

  if (!tipoMuestraId || !tuboEnvaseId) {
    throw new Error(
      "Existe una opción de muestra sin TipoMuestra o TuboEnvase",
    );
  }

  if (!opcion.tipoMuestra) {
    throw new Error("Existe una opción de muestra sin snapshot de TipoMuestra");
  }

  if (!opcion.tuboEnvase) {
    throw new Error("Existe una opción de muestra sin snapshot de TuboEnvase");
  }

  return {
    tipoMuestraId,

    tipoMuestra: {
      codTipoMuestra: opcion.tipoMuestra.codTipoMuestra ?? null,

      nombreTipoMuestra: opcion.tipoMuestra.nombreTipoMuestra ?? "",

      descripcionTipoMuestra: opcion.tipoMuestra.descripcionTipoMuestra ?? "",

      estadoTipoMuestra: opcion.tipoMuestra.estadoTipoMuestra ?? "ACTIVO",
    },

    tuboEnvaseId,

    tuboEnvase: {
      codTuboEnvase: opcion.tuboEnvase.codTuboEnvase ?? null,

      nombreTuboEnvase: opcion.tuboEnvase.nombreTuboEnvase ?? "",

      descripcionTuboEnvase: opcion.tuboEnvase.descripcionTuboEnvase ?? "",

      color: opcion.tuboEnvase.color ?? "",

      aditivo: opcion.tuboEnvase.aditivo ?? "",

      capacidad: opcion.tuboEnvase.capacidad ?? null,

      unidadCapacidad: opcion.tuboEnvase.unidadCapacidad ?? null,

      estadoTuboEnvase: opcion.tuboEnvase.estadoTuboEnvase ?? "ACTIVO",
    },
  };
};

// ====== Obtener opción válida para todas las coberturas ======

const obtenerOpcionComunSeleccionada = ({
  muestra,
  tipoMuestraId,
  tuboEnvaseId,
}) => {
  const coberturas = Array.isArray(muestra.coberturas)
    ? muestra.coberturas
    : [];

  if (coberturas.length === 0) {
    throw new Error("La muestra no posee coberturas clínicas");
  }

  let opcionSeleccionada = null;

  for (const cobertura of coberturas) {
    const opciones = Array.isArray(cobertura.opcionesPermitidas)
      ? cobertura.opcionesPermitidas
      : [];

    const opcion = opciones.find((item) => {
      const tipoId = obtenerId(item.tipoMuestraId);

      const tuboId = obtenerId(item.tuboEnvaseId);

      return (
        tipoId &&
        tuboId &&
        tipoId.toString() === tipoMuestraId.toString() &&
        tuboId.toString() === tuboEnvaseId.toString()
      );
    });

    if (!opcion) {
      throw new Error(
        `La combinación de muestra y recipiente no es válida para ${cobertura.codPruebaLab} - ${cobertura.nombrePruebaLab}`,
      );
    }

    if (!opcionSeleccionada) {
      opcionSeleccionada = opcion;
    }
  }

  if (!opcionSeleccionada) {
    throw new Error("No se pudo resolver la opción histórica de la muestra");
  }

  return normalizarOpcionMuestra(opcionSeleccionada);
};

// ====== Obtener Items de unidad ======

const obtenerItemsUnidad = (unidad) => {
  const grupos = Array.isArray(unidad.snapshotClinico?.gruposResultado)
    ? unidad.snapshotClinico.gruposResultado
    : [];

  const ids = new Set();

  grupos.forEach((grupo) => {
    const items = Array.isArray(grupo.items) ? grupo.items : [];

    items.forEach((item) => {
      const itemLabId = obtenerId(item.itemLabId);

      if (itemLabId) {
        ids.add(itemLabId.toString());
      }
    });
  });

  return ids;
};

// ====== Construir cobertura ======

const construirCobertura = ({ unidad, requerimiento, indiceRequerimiento }) => {
  const snapshot = unidad.snapshotClinico;

  const opcionesOriginales = Array.isArray(requerimiento.opciones)
    ? requerimiento.opciones
    : [];

  if (opcionesOriginales.length === 0) {
    throw new Error(
      `El requerimiento ${indiceRequerimiento + 1} ` +
        `de ${unidad.codExamen} no posee opciones de muestra`,
    );
  }

  const opcionesPermitidas = opcionesOriginales.map(normalizarOpcionMuestra);

  const alcance = requerimiento.alcance ?? "TODA_PRUEBA";

  const itemsAsociadosOriginales = Array.isArray(requerimiento.itemsAsociados)
    ? requerimiento.itemsAsociados
    : [];

  const itemsAsociados = itemsAsociadosOriginales
    .map(obtenerId)
    .filter(Boolean);

  // ====== Validar Items específicos ======

  if (alcance === "ITEMS_ESPECIFICOS") {
    if (itemsAsociados.length === 0) {
      throw new Error(
        `El requerimiento ${indiceRequerimiento + 1} ` +
          `de ${unidad.codExamen} es ITEMS_ESPECIFICOS ` +
          "pero no posee Items asociados",
      );
    }

    const itemsUnidad = obtenerItemsUnidad(unidad);

    const itemInvalido = itemsAsociados.find(
      (itemLabId) => !itemsUnidad.has(itemLabId.toString()),
    );

    if (itemInvalido) {
      throw new Error(
        `El requerimiento ${indiceRequerimiento + 1} ` +
          `de ${unidad.codExamen} contiene un Item ` +
          "que no pertenece al snapshot clínico",
      );
    }
  }

  const cantidadRecipientes = Number(requerimiento.cantidadRecipientes ?? 1);

  if (!Number.isInteger(cantidadRecipientes) || cantidadRecipientes < 1) {
    throw new Error(
      `El requerimiento ${indiceRequerimiento + 1} ` +
        `de ${unidad.codExamen} posee una cantidad ` +
        "de recipientes inválida",
    );
  }

  return {
    claveCobertura: `${unidad.claveUnidad}:` + `REQ:${indiceRequerimiento}`,

    claveUnidad: unidad.claveUnidad,

    // ====== Servicio ======

    servicioId: obtenerId(unidad.servicioId),

    codServicio: unidad.codServicio,

    nombreServicio: unidad.nombreServicio,

    // ====== Prueba ======

    pruebaLabId: obtenerId(snapshot.pruebaLabId ?? unidad.pruebaLabId),

    codPruebaLab: snapshot.codPruebaLab ?? unidad.codExamen,

    nombrePruebaLab: snapshot.nombrePruebaLab ?? unidad.nombreExamen,

    // ====== Instancia ======

    modalidadInstancias: unidad.modalidadInstancias,

    numeroInstancia: unidad.numeroInstancia,

    etiquetaInstancia: unidad.etiquetaInstancia ?? null,

    // ====== Requerimiento ======

    indiceRequerimiento,

    descripcionRequerimiento: requerimiento.descripcion ?? "",

    alcance,

    opcionesPermitidas,

    itemsAsociados,

    cantidadRecipientes,

    volumenMinimo: requerimiento.volumenMinimo ?? null,

    unidadVolumen: requerimiento.unidadVolumen ?? null,

    permiteCompartirMuestra: requerimiento.permiteCompartirMuestra !== false,

    observacion: requerimiento.observacion ?? "",
  };
};

// ====== Crear slots físicos ======

const construirSlotsMuestra = (unidadesLaboratorio) => {
  const slots = [];

  let unidadesConMuestra = 0;
  let requerimientosProcesados = 0;

  unidadesLaboratorio.forEach((unidad) => {
    if (unidad.estado === "ANULADO") {
      return;
    }

    const snapshot = unidad.snapshotClinico;

    if (!snapshot) {
      throw new Error(
        `La unidad ${unidad.claveUnidad} no posee snapshot clínico`,
      );
    }

    if (snapshot.requiereMuestra !== true) {
      return;
    }

    unidadesConMuestra += 1;

    const requerimientos = Array.isArray(snapshot.requerimientosMuestra)
      ? snapshot.requerimientosMuestra
      : [];

    if (requerimientos.length === 0) {
      throw new Error(
        `La prueba ${unidad.codExamen} requiere muestra ` +
          "pero no posee requerimientos históricos",
      );
    }

    requerimientos.forEach((requerimiento, indiceRequerimiento) => {
      const cobertura = construirCobertura({
        unidad,
        requerimiento,
        indiceRequerimiento,
      });

      requerimientosProcesados += 1;

      for (
        let numeroRecipiente = 1;
        numeroRecipiente <= cobertura.cantidadRecipientes;
        numeroRecipiente += 1
      ) {
        const clavesOpciones = new Set(
          cobertura.opcionesPermitidas
            .map(construirClaveOpcion)
            .filter(Boolean),
        );

        if (clavesOpciones.size === 0) {
          throw new Error(
            `El requerimiento ${indiceRequerimiento + 1} ` +
              `de ${unidad.codExamen} no posee opciones válidas`,
          );
        }

        slots.push({
          claveSlot: `${cobertura.claveCobertura}:` + `REC:${numeroRecipiente}`,

          cobertura,

          numeroRecipienteRequerimiento: numeroRecipiente,

          opcionesComunes: clavesOpciones,

          permiteAgrupar:
            cobertura.permiteCompartirMuestra === true &&
            cobertura.modalidadInstancias !== "MUESTRAS_INDEPENDIENTES",
        });
      }
    });
  });

  slots.sort((a, b) => a.claveSlot.localeCompare(b.claveSlot));

  return {
    slots,
    unidadesConMuestra,
    requerimientosProcesados,
  };
};

// ====== Intersectar opciones ======

const intersectarOpciones = (opcionesA, opcionesB) => {
  return new Set([...opcionesA].filter((clave) => opcionesB.has(clave)));
};

// ====== Agrupar slots compatibles ======

const construirPlanesMuestra = (slots) => {
  const planes = [];

  slots.forEach((slot) => {
    let agregado = false;

    if (slot.permiteAgrupar) {
      for (const plan of planes) {
        if (!plan.permiteAgrupar) {
          continue;
        }

        // ====== No fusionar dos recipientes del mismo requerimiento ======

        if (plan.clavesCobertura.has(slot.cobertura.claveCobertura)) {
          continue;
        }

        const opcionesComunes = intersectarOpciones(
          plan.opcionesComunes,
          slot.opcionesComunes,
        );

        if (opcionesComunes.size === 0) {
          continue;
        }

        plan.slots.push(slot);

        plan.coberturas.push(slot.cobertura);

        plan.clavesCobertura.add(slot.cobertura.claveCobertura);

        plan.opcionesComunes = opcionesComunes;

        agregado = true;

        break;
      }
    }

    if (!agregado) {
      planes.push({
        slots: [slot],

        coberturas: [slot.cobertura],

        clavesCobertura: new Set([slot.cobertura.claveCobertura]),

        opcionesComunes: new Set(slot.opcionesComunes),

        permiteAgrupar: slot.permiteAgrupar,
      });
    }
  });

  // ====== Orden estable ======

  planes.sort((a, b) => {
    const claveA = a.slots[0]?.claveSlot ?? "";

    const claveB = b.slots[0]?.claveSlot ?? "";

    return claveA.localeCompare(claveB);
  });

  return planes.map((plan) => {
    const clavesSlots = plan.slots.map((slot) => slot.claveSlot).sort();

    const basePlan = clavesSlots.join("|");

    const hash = crypto.createHash("sha256").update(basePlan).digest("hex");

    return {
      claveMuestraPlan: `MPL-${hash}`,

      coberturas: plan.coberturas,

      opcionesComunes: [...plan.opcionesComunes],
    };
  });
};

// ====== Contar estados de muestras ======

const construirConteoEstadosMuestra = (muestras = []) => {
  const conteo = {
    pendientes: 0,
    recolectadas: 0,
    recepcionadas: 0,
    aceptadas: 0,
    rechazadas: 0,
    anuladas: 0,
  };

  muestras.forEach((muestra) => {
    switch (muestra.estadoMuestra) {
      case "PENDIENTE":
        conteo.pendientes += 1;
        break;

      case "RECOLECTADA":
        conteo.recolectadas += 1;
        break;

      case "RECEPCIONADA":
        conteo.recepcionadas += 1;
        break;

      case "ACEPTADA":
        conteo.aceptadas += 1;
        break;

      case "RECHAZADA":
        conteo.rechazadas += 1;
        break;

      case "ANULADA":
        conteo.anuladas += 1;
        break;

      default:
        break;
    }
  });

  return conteo;
};

// ====== Agrupar intentos por recipiente ======

const construirPlanesConsultaMuestra = (muestras = []) => {
  const grupos = new Map();

  muestras.forEach((muestra) => {
    const clavePlan = muestra.claveMuestraPlan ?? muestra._id.toString();

    if (!grupos.has(clavePlan)) {
      grupos.set(clavePlan, {
        claveMuestraPlan: clavePlan,
        intentos: [],
      });
    }

    grupos.get(clavePlan).intentos.push(muestra);
  });

  const planes = [];

  for (const grupo of grupos.values()) {
    const intentosOrdenados = grupo.intentos.sort((a, b) => {
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

    const intentoVigente = intentosOrdenados[intentosOrdenados.length - 1];

    const intentoVigenteId = intentoVigente?._id?.toString();

    planes.push({
      claveMuestraPlan: grupo.claveMuestraPlan,

      numeroRecipiente: intentoVigente?.numeroRecipiente ?? null,

      totalIntentos: intentosOrdenados.length,

      intentoVigente: intentoVigente
        ? {
            _id: intentoVigente._id,

            codMuestra: intentoVigente.codMuestra,

            codigoEtiqueta: intentoVigente.codigoEtiqueta,

            numeroIntento: intentoVigente.numeroIntento,

            estadoMuestra: intentoVigente.estadoMuestra,
          }
        : null,

      requiereReintento: intentoVigente?.estadoMuestra === "RECHAZADA",

      intentos: intentosOrdenados.map((intento) => ({
        ...intento,

        esVigente: intento._id.toString() === intentoVigenteId,
      })),
    });
  }

  planes.sort((a, b) => {
    const recipienteA = Number(a.numeroRecipiente ?? 0);

    const recipienteB = Number(b.numeroRecipiente ?? 0);

    if (recipienteA !== recipienteB) {
      return recipienteA - recipienteB;
    }

    return String(a.claveMuestraPlan).localeCompare(String(b.claveMuestraPlan));
  });

  return planes;
};

// ====== Construir resumen operativo ======

const construirResumenOperativoMuestras = (muestras, planes) => {
  const vigentes = planes
    .map((plan) => plan.intentos.find((intento) => intento.esVigente === true))
    .filter(Boolean);

  return {
    totalDocumentos: muestras.length,

    recipientesPlanificados: planes.length,

    documentos: {
      total: muestras.length,

      ...construirConteoEstadosMuestra(muestras),
    },

    vigentes: {
      total: vigentes.length,

      ...construirConteoEstadosMuestra(vigentes),
    },
  };
};

// ====== Resumen de solicitud ======

const construirSolicitudMuestraResponse = (solicitud) => {
  return {
    _id: solicitud._id,

    codSolicitud: solicitud.codSolicitud,

    codigoLaboratorio: solicitud.codigoLaboratorio ?? null,

    tipo: solicitud.tipo,

    estado: solicitud.estado,

    fechaEmision: solicitud.fechaEmision,

    paciente: {
      hc: solicitud.hc ?? null,

      clienteId: solicitud.clienteId ?? null,

      tipoDoc: solicitud.tipoDoc ?? null,

      nroDoc: solicitud.nroDoc ?? null,

      nombreCliente: solicitud.nombreCliente ?? "",

      apePatCliente: solicitud.apePatCliente ?? "",

      apeMatCliente: solicitud.apeMatCliente ?? "",

      sexoPaciente: solicitud.sexoPaciente ?? null,

      fechaNacimientoPaciente: solicitud.fechaNacimientoPaciente ?? null,
    },
  };
};

// ====== Validar etapa de evidencia ======

const validarEtapaEvidenciaMuestra = ({ muestra, etapa }) => {
  switch (etapa) {
    case "RECOLECCION":
      if (!muestra.recolectadoPor || !muestra.fechaRecoleccion) {
        throw new Error(
          "La muestra todavía no posee una recolección registrada",
        );
      }

      break;

    case "RECEPCION":
      if (!muestra.recibidoPor || !muestra.fechaRecepcion) {
        throw new Error("La muestra todavía no posee una recepción registrada");
      }

      break;

    case "ACEPTACION":
      if (!muestra.aceptadoPor || !muestra.fechaAceptacion) {
        throw new Error("La muestra no posee una aceptación registrada");
      }

      break;

    case "RECHAZO":
      if (!muestra.rechazadoPor || !muestra.fechaRechazo) {
        throw new Error("La muestra no posee un rechazo registrado");
      }

      break;

    default:
      throw new Error("La etapa de evidencia fotográfica no es válida");
  }
};

// ====== Inicializar muestras de solicitud ======

const inicializarMuestrasSolicitud = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { solicitudAtencionId } = req.params;

    const { uid, nombreUsuario } = req.user;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(solicitudAtencionId)) {
      throw new Error("El id de la solicitud de atención no es válido");
    }

    // ====== Obtener solicitud ======

    const solicitud =
      await SolicitudAtencion.findById(solicitudAtencionId).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención no existe");
    }

    // ====== Validar solicitud ======

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud indicada no corresponde a Laboratorio");
    }

    // ====== Validar código laboratorio ======

    if (!solicitud.codigoLaboratorio) {
      throw new Error("La solicitud no posee código de laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se pueden inicializar muestras de una solicitud anulada",
      );
    }

    const unidades = Array.isArray(solicitud.unidadesLaboratorio)
      ? solicitud.unidadesLaboratorio
      : [];

    if (unidades.length === 0) {
      throw new Error("La solicitud no contiene unidades de laboratorio");
    }

    // ====== Construir slots ======

    const { slots, unidadesConMuestra, requerimientosProcesados } =
      construirSlotsMuestra(unidades);

    // ====== Construir planes ======

    const planes = construirPlanesMuestra(slots);

    // ====== Obtener muestras existentes ======

    const muestrasExistentes = await MuestraLaboratorio.find({
      solicitudAtencionId: solicitud._id,
    })
      .session(session)
      .lean();

    const clavesPlanesExistentes = new Set(
      muestrasExistentes.map((muestra) => muestra.claveMuestraPlan),
    );

    // ====== Crear planes faltantes ======

    const muestrasNuevas = [];

    for (let indicePlan = 0; indicePlan < planes.length; indicePlan += 1) {
      const plan = planes[indicePlan];

      if (clavesPlanesExistentes.has(plan.claveMuestraPlan)) {
        continue;
      }

      const numeroPlan = indicePlan + 1;

      const codMuestra =
        `MUE-${solicitud.codSolicitud}-` +
        `${numeroPlan.toString().padStart(3, "0")}`;

      // ====== Código visible de etiqueta ======

      const codigoEtiqueta =
        `${solicitud.codigoLaboratorio}-` +
        `${numeroPlan.toString().padStart(2, "0")}`;

      const muestra = new MuestraLaboratorio({
        // ====== Solicitud ======

        solicitudAtencionId: solicitud._id,

        codSolicitud: solicitud.codSolicitud,

        codigoLaboratorio: solicitud.codigoLaboratorio,

        // ====== Identidad física ======

        codMuestra,

        codigoEtiqueta,

        claveMuestraPlan: plan.claveMuestraPlan,

        numeroRecipiente: numeroPlan,

        numeroIntento: 1,

        muestraAnteriorId: null,

        // ====== Cobertura ======

        coberturas: plan.coberturas,

        // ====== Opción real pendiente ======

        tipoMuestraId: null,

        tipoMuestra: null,

        tuboEnvaseId: null,

        tuboEnvase: null,

        volumenRecolectado: null,

        unidadVolumenRecolectado: null,

        // ====== Estado ======

        estadoMuestra: "PENDIENTE",

        observacionGeneral: "",

        // ====== Auditoría ======

        createdBy: uid,

        usuarioRegistro: nombreUsuario ?? null,

        fechaRegistro: new Date(),
      });

      await muestra.save({
        session,
      });

      muestrasNuevas.push(muestra);
    }

    await session.commitTransaction();

    // ====== Obtener estado final ======

    const muestrasFinales = await MuestraLaboratorio.find({
      solicitudAtencionId: solicitud._id,
    }).sort({
      numeroRecipiente: 1,
      numeroIntento: 1,
      createdAt: 1,
    });

    return res.status(200).json({
      ok: true,

      msg:
        planes.length === 0
          ? "La solicitud no requiere muestras de laboratorio"
          : muestrasNuevas.length > 0
            ? "Muestras de laboratorio inicializadas correctamente"
            : "Las muestras de laboratorio ya estaban inicializadas",

      resumen: {
        unidadesLaboratorio: unidades.length,

        unidadesConMuestra,

        requerimientosMuestra: requerimientosProcesados,

        recipientesRequeridos: slots.length,

        planesMuestra: planes.length,

        muestrasCreadas: muestrasNuevas.length,

        muestrasExistentes: muestrasFinales.length - muestrasNuevas.length,

        totalMuestras: muestrasFinales.length,
      },

      muestras: muestrasFinales,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al inicializar muestras de laboratorio:", error);

    return res.status(400).json({
      ok: false,

      msg:
        error.message ||
        "No se pudieron inicializar las muestras de laboratorio",
    });
  } finally {
    await session.endSession();
  }
};

// ====== Registrar recolección de muestra ======

const recolectarMuestra = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { muestraLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    const {
      tipoMuestraId,
      tuboEnvaseId,
      volumenRecolectado,
      unidadVolumenRecolectado,
      observacionRecoleccion,
    } = req.body;

    // ====== Validar id de muestra ======

    if (!mongoose.Types.ObjectId.isValid(muestraLaboratorioId)) {
      throw new Error("El id de la muestra de laboratorio no es válido");
    }

    // ====== Validar opción física ======

    if (!mongoose.Types.ObjectId.isValid(tipoMuestraId)) {
      throw new Error("Debe seleccionar un tipo de muestra válido");
    }

    if (!mongoose.Types.ObjectId.isValid(tuboEnvaseId)) {
      throw new Error("Debe seleccionar un tubo o envase válido");
    }

    // ====== Validar volumen opcional ======

    const tieneVolumen =
      volumenRecolectado !== undefined &&
      volumenRecolectado !== null &&
      volumenRecolectado !== "";

    const tieneUnidad =
      unidadVolumenRecolectado !== undefined &&
      unidadVolumenRecolectado !== null &&
      String(unidadVolumenRecolectado).trim() !== "";

    if (tieneVolumen !== tieneUnidad) {
      throw new Error(
        "Si registra volumen recolectado debe indicar también su unidad",
      );
    }

    let volumenNormalizado = null;
    let unidadNormalizada = null;

    if (tieneVolumen) {
      volumenNormalizado = Number(volumenRecolectado);

      if (!Number.isFinite(volumenNormalizado) || volumenNormalizado <= 0) {
        throw new Error("El volumen recolectado debe ser mayor a cero");
      }

      const unidadesPermitidas = {
        ul: "uL",
        ml: "mL",
        l: "L",
      };

      unidadNormalizada =
        unidadesPermitidas[
          String(unidadVolumenRecolectado).trim().toLowerCase()
        ];

      if (!unidadNormalizada) {
        throw new Error("La unidad de volumen recolectado no es válida");
      }
    }

    // ====== Validar observación ======

    if (
      observacionRecoleccion !== undefined &&
      observacionRecoleccion !== null &&
      typeof observacionRecoleccion !== "string"
    ) {
      throw new Error("La observación de recolección debe ser un texto");
    }

    // ====== Obtener muestra ======

    const muestra =
      await MuestraLaboratorio.findById(muestraLaboratorioId).session(session);

    if (!muestra) {
      throw new Error("La muestra de laboratorio no existe");
    }

    // ====== Validar estado ======

    if (muestra.estadoMuestra !== "PENDIENTE") {
      throw new Error(
        `No se puede registrar la recolección de una muestra en estado ${muestra.estadoMuestra}`,
      );
    }

    // ====== Validar solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      muestra.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se puede registrar la recolección de una solicitud anulada",
      );
    }

    // ====== Resolver opción histórica ======

    const opcionSeleccionada = obtenerOpcionComunSeleccionada({
      muestra,
      tipoMuestraId,
      tuboEnvaseId,
    });

    const ahora = new Date();

    // ====== Registrar opción utilizada ======

    muestra.tipoMuestraId = opcionSeleccionada.tipoMuestraId;

    muestra.tipoMuestra = opcionSeleccionada.tipoMuestra;

    muestra.tuboEnvaseId = opcionSeleccionada.tuboEnvaseId;

    muestra.tuboEnvase = opcionSeleccionada.tuboEnvase;

    // ====== Registrar volumen opcional ======

    muestra.volumenRecolectado = volumenNormalizado;

    muestra.unidadVolumenRecolectado = unidadNormalizada;

    // ====== Registrar recolección ======

    muestra.estadoMuestra = "RECOLECTADA";

    muestra.recolectadoPor = uid;

    muestra.usuarioRecoleccion = nombreUsuario ?? null;

    muestra.fechaRecoleccion = ahora;

    muestra.observacionRecoleccion =
      typeof observacionRecoleccion === "string"
        ? observacionRecoleccion.trim()
        : "";

    // ====== Auditoría ======

    muestra.updatedBy = uid;

    muestra.usuarioActualizacion = nombreUsuario ?? null;

    muestra.fechaActualizacion = ahora;

    // ====== Guardar ======

    await muestra.save({
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg: "Muestra recolectada correctamente",

      estadoMuestra: muestra.estadoMuestra,

      muestra,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al registrar recolección de muestra:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo registrar la recolección de muestra",
    });
  } finally {
    await session.endSession();
  }
};

// ====== Registrar recepción de muestra ======

const recibirMuestra = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { muestraLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    const { observacionRecepcion } = req.body;

    // ====== Validar id de muestra ======

    if (!mongoose.Types.ObjectId.isValid(muestraLaboratorioId)) {
      throw new Error("El id de la muestra de laboratorio no es válido");
    }

    // ====== Validar observación ======

    if (
      observacionRecepcion !== undefined &&
      observacionRecepcion !== null &&
      typeof observacionRecepcion !== "string"
    ) {
      throw new Error("La observación de recepción debe ser un texto");
    }

    // ====== Obtener muestra ======

    const muestra =
      await MuestraLaboratorio.findById(muestraLaboratorioId).session(session);

    if (!muestra) {
      throw new Error("La muestra de laboratorio no existe");
    }

    // ====== Validar estado ======

    if (muestra.estadoMuestra !== "RECOLECTADA") {
      throw new Error(
        `No se puede registrar la recepción de una muestra en estado ${muestra.estadoMuestra}`,
      );
    }

    // ====== Validar trazabilidad de recolección ======

    if (!muestra.recolectadoPor || !muestra.fechaRecoleccion) {
      throw new Error("La muestra no posee trazabilidad válida de recolección");
    }

    // ====== Validar identificación física ======

    if (!muestra.tipoMuestraId || !muestra.tuboEnvaseId) {
      throw new Error(
        "La muestra recolectada no posee tipo de muestra o recipiente registrado",
      );
    }

    // ====== Validar solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      muestra.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se puede registrar la recepción de una solicitud anulada",
      );
    }

    const ahora = new Date();

    // ====== Registrar recepción ======

    muestra.estadoMuestra = "RECEPCIONADA";

    muestra.recibidoPor = uid;

    muestra.usuarioRecepcion = nombreUsuario ?? null;

    muestra.fechaRecepcion = ahora;

    muestra.observacionRecepcion =
      typeof observacionRecepcion === "string"
        ? observacionRecepcion.trim()
        : "";

    // ====== Auditoría ======

    muestra.updatedBy = uid;

    muestra.usuarioActualizacion = nombreUsuario ?? null;

    muestra.fechaActualizacion = ahora;

    // ====== Guardar ======

    await muestra.save({
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg: "Muestra recepcionada correctamente",

      estadoMuestra: muestra.estadoMuestra,

      muestra,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al registrar recepción de muestra:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo registrar la recepción de muestra",
    });
  } finally {
    await session.endSession();
  }
};

// ====== Registrar aceptación de muestra ======

const aceptarMuestra = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { muestraLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    const { observacionAceptacion } = req.body;

    // ====== Validar id de muestra ======

    if (!mongoose.Types.ObjectId.isValid(muestraLaboratorioId)) {
      throw new Error("El id de la muestra de laboratorio no es válido");
    }

    // ====== Validar observación ======

    if (
      observacionAceptacion !== undefined &&
      observacionAceptacion !== null &&
      typeof observacionAceptacion !== "string"
    ) {
      throw new Error("La observación de aceptación debe ser un texto");
    }

    // ====== Obtener muestra ======

    const muestra =
      await MuestraLaboratorio.findById(muestraLaboratorioId).session(session);

    if (!muestra) {
      throw new Error("La muestra de laboratorio no existe");
    }

    // ====== Validar estado ======

    if (muestra.estadoMuestra !== "RECEPCIONADA") {
      throw new Error(
        `No se puede aceptar una muestra en estado ${muestra.estadoMuestra}`,
      );
    }

    // ====== Validar trazabilidad de recolección ======

    if (!muestra.recolectadoPor || !muestra.fechaRecoleccion) {
      throw new Error("La muestra no posee trazabilidad válida de recolección");
    }

    // ====== Validar trazabilidad de recepción ======

    if (!muestra.recibidoPor || !muestra.fechaRecepcion) {
      throw new Error("La muestra no posee trazabilidad válida de recepción");
    }

    // ====== Validar identificación física ======

    if (!muestra.tipoMuestraId || !muestra.tuboEnvaseId) {
      throw new Error(
        "La muestra no posee tipo de muestra o recipiente registrado",
      );
    }

    // ====== Validar solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      muestra.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se puede aceptar una muestra de una solicitud anulada",
      );
    }

    const ahora = new Date();

    // ====== Registrar aceptación ======

    muestra.estadoMuestra = "ACEPTADA";

    muestra.aceptadoPor = uid;

    muestra.usuarioAceptacion = nombreUsuario ?? null;

    muestra.fechaAceptacion = ahora;

    muestra.observacionAceptacion =
      typeof observacionAceptacion === "string"
        ? observacionAceptacion.trim()
        : "";

    // ====== Auditoría ======

    muestra.updatedBy = uid;

    muestra.usuarioActualizacion = nombreUsuario ?? null;

    muestra.fechaActualizacion = ahora;

    // ====== Guardar ======

    await muestra.save({
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg: "Muestra aceptada correctamente",

      estadoMuestra: muestra.estadoMuestra,

      muestra,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al registrar aceptación de muestra:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo registrar la aceptación de muestra",
    });
  } finally {
    await session.endSession();
  }
};

// ====== Registrar rechazo de muestra ======

const rechazarMuestra = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { muestraLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    const { motivoRechazo } = req.body;

    // ====== Validar id de muestra ======

    if (!mongoose.Types.ObjectId.isValid(muestraLaboratorioId)) {
      throw new Error("El id de la muestra de laboratorio no es válido");
    }

    // ====== Validar motivo ======

    if (typeof motivoRechazo !== "string") {
      throw new Error("Debe indicar el motivo de rechazo de la muestra");
    }

    const motivoNormalizado = motivoRechazo.trim();

    if (!motivoNormalizado) {
      throw new Error("Debe indicar el motivo de rechazo de la muestra");
    }

    // ====== Obtener muestra ======

    const muestra =
      await MuestraLaboratorio.findById(muestraLaboratorioId).session(session);

    if (!muestra) {
      throw new Error("La muestra de laboratorio no existe");
    }

    // ====== Validar estado ======

    if (muestra.estadoMuestra !== "RECEPCIONADA") {
      throw new Error(
        `No se puede rechazar una muestra en estado ${muestra.estadoMuestra}`,
      );
    }

    // ====== Validar trazabilidad de recolección ======

    if (!muestra.recolectadoPor || !muestra.fechaRecoleccion) {
      throw new Error("La muestra no posee trazabilidad válida de recolección");
    }

    // ====== Validar trazabilidad de recepción ======

    if (!muestra.recibidoPor || !muestra.fechaRecepcion) {
      throw new Error("La muestra no posee trazabilidad válida de recepción");
    }

    // ====== Validar solicitud original ======

    const solicitud = await SolicitudAtencion.findById(
      muestra.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se puede rechazar una muestra de una solicitud anulada",
      );
    }

    const ahora = new Date();

    // ====== Registrar rechazo ======

    muestra.estadoMuestra = "RECHAZADA";

    muestra.rechazadoPor = uid;

    muestra.usuarioRechazo = nombreUsuario ?? null;

    muestra.fechaRechazo = ahora;

    muestra.motivoRechazo = motivoNormalizado;

    // ====== Auditoría ======

    muestra.updatedBy = uid;

    muestra.usuarioActualizacion = nombreUsuario ?? null;

    muestra.fechaActualizacion = ahora;

    // ====== Guardar ======

    await muestra.save({
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,

      msg: "Muestra rechazada correctamente",

      estadoMuestra: muestra.estadoMuestra,

      requiereNuevaMuestra: true,

      muestra,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al registrar rechazo de muestra:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo registrar el rechazo de muestra",
    });
  } finally {
    await session.endSession();
  }
};

// ====== Generar reintento de muestra ======

const generarReintentoMuestra = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { muestraLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(muestraLaboratorioId)) {
      throw new Error("El id de la muestra de laboratorio no es válido");
    }

    // ====== Obtener muestra rechazada ======

    const muestraAnterior =
      await MuestraLaboratorio.findById(muestraLaboratorioId).session(session);

    if (!muestraAnterior) {
      throw new Error("La muestra de laboratorio no existe");
    }

    // ====== Validar estado ======

    if (muestraAnterior.estadoMuestra !== "RECHAZADA") {
      throw new Error(
        `No se puede generar un reintento de una muestra en estado ${muestraAnterior.estadoMuestra}`,
      );
    }

    // ====== Validar identificación ======

    if (!muestraAnterior.codigoLaboratorio) {
      throw new Error("La muestra no posee código de laboratorio");
    }

    if (!muestraAnterior.claveMuestraPlan) {
      throw new Error("La muestra no posee una clave de planificación válida");
    }

    // ====== Validar solicitud ======

    const solicitud = await SolicitudAtencion.findById(
      muestraAnterior.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se puede generar un reintento de una solicitud anulada",
      );
    }

    // ====== Validar reintento existente ======

    const reintentoExistente = await MuestraLaboratorio.findOne({
      muestraAnteriorId: muestraAnterior._id,
    }).session(session);

    if (reintentoExistente) {
      await session.commitTransaction();

      return res.status(200).json({
        ok: true,

        msg: "El reintento de la muestra ya había sido generado",

        creada: false,

        muestraAnterior: {
          _id: muestraAnterior._id,
          codigoEtiqueta: muestraAnterior.codigoEtiqueta,
          numeroIntento: muestraAnterior.numeroIntento,
          estadoMuestra: muestraAnterior.estadoMuestra,
        },

        muestra: reintentoExistente,
      });
    }

    // ====== Validar último intento ======

    const ultimoIntento = await MuestraLaboratorio.findOne({
      solicitudAtencionId: muestraAnterior.solicitudAtencionId,

      claveMuestraPlan: muestraAnterior.claveMuestraPlan,
    })
      .sort({
        numeroIntento: -1,
      })
      .session(session);

    if (
      ultimoIntento &&
      ultimoIntento._id.toString() !== muestraAnterior._id.toString()
    ) {
      throw new Error(
        "La muestra posee un intento posterior y no puede generar otro reintento desde este registro",
      );
    }

    // ====== Calcular intento ======

    const nuevoNumeroIntento = Number(muestraAnterior.numeroIntento) + 1;

    const numeroRecipiente = Number(muestraAnterior.numeroRecipiente);

    if (!Number.isInteger(nuevoNumeroIntento) || nuevoNumeroIntento < 2) {
      throw new Error("No se pudo determinar el número del nuevo intento");
    }

    if (!Number.isInteger(numeroRecipiente) || numeroRecipiente < 1) {
      throw new Error("La muestra posee un número de recipiente inválido");
    }

    // ====== Construir códigos ======

    const numeroRecipienteInterno = numeroRecipiente
      .toString()
      .padStart(3, "0");

    const numeroRecipienteEtiqueta = numeroRecipiente
      .toString()
      .padStart(2, "0");

    const codMuestra =
      `MUE-${muestraAnterior.codSolicitud}-` +
      `${numeroRecipienteInterno}-` +
      `R${nuevoNumeroIntento}`;

    const codigoEtiqueta =
      `${muestraAnterior.codigoLaboratorio}-` +
      `${numeroRecipienteEtiqueta}-` +
      `R${nuevoNumeroIntento}`;

    // ====== Copiar planificación histórica ======

    const coberturas = Array.isArray(muestraAnterior.coberturas)
      ? muestraAnterior.coberturas.map((cobertura) =>
          cobertura.toObject ? cobertura.toObject() : cobertura,
        )
      : [];

    if (coberturas.length === 0) {
      throw new Error("La muestra rechazada no posee coberturas clínicas");
    }

    const ahora = new Date();

    // ====== Crear nuevo intento ======

    const nuevaMuestra = new MuestraLaboratorio({
      // ====== Solicitud ======

      solicitudAtencionId: muestraAnterior.solicitudAtencionId,

      codSolicitud: muestraAnterior.codSolicitud,

      codigoLaboratorio: muestraAnterior.codigoLaboratorio,

      // ====== Identidad física ======

      codMuestra,

      codigoEtiqueta,

      claveMuestraPlan: muestraAnterior.claveMuestraPlan,

      numeroRecipiente,

      numeroIntento: nuevoNumeroIntento,

      muestraAnteriorId: muestraAnterior._id,

      // ====== Cobertura histórica ======

      coberturas,

      // ====== Opción real pendiente ======

      tipoMuestraId: null,

      tipoMuestra: null,

      tuboEnvaseId: null,

      tuboEnvase: null,

      volumenRecolectado: null,

      unidadVolumenRecolectado: null,

      // ====== Estado ======

      estadoMuestra: "PENDIENTE",

      observacionGeneral: "",

      // ====== Auditoría ======

      createdBy: uid,

      usuarioRegistro: nombreUsuario ?? null,

      fechaRegistro: ahora,
    });

    await nuevaMuestra.save({
      session,
    });

    await session.commitTransaction();

    return res.status(201).json({
      ok: true,

      msg: "Nuevo intento de muestra generado correctamente",

      creada: true,

      muestraAnterior: {
        _id: muestraAnterior._id,

        codigoEtiqueta: muestraAnterior.codigoEtiqueta,

        numeroIntento: muestraAnterior.numeroIntento,

        estadoMuestra: muestraAnterior.estadoMuestra,

        motivoRechazo: muestraAnterior.motivoRechazo,
      },

      muestra: nuevaMuestra,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al generar reintento de muestra:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo generar el reintento de muestra",
    });
  } finally {
    await session.endSession();
  }
};

// ====== Consultar muestras por solicitud ======

const obtenerMuestrasPorSolicitud = async (req, res = response) => {
  try {
    const { solicitudAtencionId } = req.params;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(solicitudAtencionId)) {
      throw new Error("El id de la solicitud de atención no es válido");
    }

    // ====== Obtener solicitud ======

    const solicitud =
      await SolicitudAtencion.findById(solicitudAtencionId).lean();

    if (!solicitud) {
      throw new Error("La solicitud de atención no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud indicada no corresponde a Laboratorio");
    }

    // ====== Obtener muestras ======

    const muestras = await MuestraLaboratorio.find({
      solicitudAtencionId: solicitud._id,
    })
      .sort({
        numeroRecipiente: 1,
        numeroIntento: 1,
        createdAt: 1,
      })
      .lean();

    // ====== Construir planes ======

    const planes = construirPlanesConsultaMuestra(muestras);

    const resumen = construirResumenOperativoMuestras(muestras, planes);

    return res.status(200).json({
      ok: true,

      msg:
        muestras.length > 0
          ? "Muestras de laboratorio obtenidas correctamente"
          : "La solicitud no posee muestras de laboratorio inicializadas",

      solicitud: construirSolicitudMuestraResponse(solicitud),

      resumen,

      planes,
    });
  } catch (error) {
    console.error("Error al consultar muestras por solicitud:", error);

    return res.status(400).json({
      ok: false,

      msg:
        error.message || "No se pudieron consultar las muestras de laboratorio",
    });
  }
};

// ====== Consultar por código de laboratorio ======

const obtenerMuestrasPorCodigoLaboratorio = async (req, res = response) => {
  try {
    const { codigoLaboratorio } = req.params;

    const codigoNormalizado = String(codigoLaboratorio ?? "")
      .trim()
      .toUpperCase();

    // ====== Validar código ======

    if (!codigoNormalizado) {
      throw new Error("Debe indicar el código de laboratorio");
    }

    // ====== Obtener solicitud ======

    const solicitud = await SolicitudAtencion.findOne({
      codigoLaboratorio: codigoNormalizado,
    }).lean();

    if (!solicitud) {
      throw new Error(
        `No existe una solicitud con código de laboratorio ${codigoNormalizado}`,
      );
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud encontrada no corresponde a Laboratorio");
    }

    // ====== Obtener muestras ======

    const muestras = await MuestraLaboratorio.find({
      solicitudAtencionId: solicitud._id,
    })
      .sort({
        numeroRecipiente: 1,
        numeroIntento: 1,
        createdAt: 1,
      })
      .lean();

    // ====== Construir planes ======

    const planes = construirPlanesConsultaMuestra(muestras);

    const resumen = construirResumenOperativoMuestras(muestras, planes);

    return res.status(200).json({
      ok: true,

      msg:
        muestras.length > 0
          ? "Solicitud y muestras de laboratorio obtenidas correctamente"
          : "La solicitud todavía no posee muestras inicializadas",

      solicitud: construirSolicitudMuestraResponse(solicitud),

      resumen,

      planes,
    });
  } catch (error) {
    console.error(
      "Error al consultar muestras por código de laboratorio:",
      error,
    );

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo consultar el código de laboratorio",
    });
  }
};

// ====== Consultar detalle de muestra ======

const obtenerDetalleMuestra = async (req, res = response) => {
  try {
    const { muestraLaboratorioId } = req.params;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(muestraLaboratorioId)) {
      throw new Error("El id de la muestra de laboratorio no es válido");
    }

    // ====== Obtener muestra ======

    const muestra =
      await MuestraLaboratorio.findById(muestraLaboratorioId).lean();

    if (!muestra) {
      throw new Error("La muestra de laboratorio no existe");
    }

    // ====== Obtener solicitud ======

    const solicitud = await SolicitudAtencion.findById(
      muestra.solicitudAtencionId,
    ).lean();

    if (!solicitud) {
      throw new Error("La solicitud asociada a la muestra no existe");
    }

    // ====== Obtener cadena de intentos ======

    const intentos = await MuestraLaboratorio.find({
      solicitudAtencionId: muestra.solicitudAtencionId,

      claveMuestraPlan: muestra.claveMuestraPlan,
    })
      .sort({
        numeroIntento: 1,
        createdAt: 1,
      })
      .lean();

    const indiceActual = intentos.findIndex(
      (intento) => intento._id.toString() === muestra._id.toString(),
    );

    const intentoVigente = intentos[intentos.length - 1] ?? null;

    const intentoAnterior =
      indiceActual > 0 ? intentos[indiceActual - 1] : null;

    const intentoSiguiente =
      indiceActual >= 0 && indiceActual < intentos.length - 1
        ? intentos[indiceActual + 1]
        : null;

    // ====== Construir cadena ======

    const cadenaIntentos = intentos.map((intento, indice) => ({
      _id: intento._id,

      codMuestra: intento.codMuestra,

      codigoEtiqueta: intento.codigoEtiqueta,

      numeroRecipiente: intento.numeroRecipiente,

      numeroIntento: intento.numeroIntento,

      muestraAnteriorId: intento.muestraAnteriorId,

      estadoMuestra: intento.estadoMuestra,

      motivoRechazo: intento.motivoRechazo ?? null,

      fechaRecoleccion: intento.fechaRecoleccion ?? null,

      fechaRecepcion: intento.fechaRecepcion ?? null,

      fechaAceptacion: intento.fechaAceptacion ?? null,

      fechaRechazo: intento.fechaRechazo ?? null,

      esActual: intento._id.toString() === muestra._id.toString(),

      esVigente: indice === intentos.length - 1,
    }));

    return res.status(200).json({
      ok: true,

      msg: "Detalle de muestra obtenido correctamente",

      solicitud: construirSolicitudMuestraResponse(solicitud),

      muestra: {
        ...muestra,

        esVigente: intentoVigente
          ? intentoVigente._id.toString() === muestra._id.toString()
          : false,
      },

      cadena: {
        totalIntentos: intentos.length,

        intentoVigenteId: intentoVigente?._id ?? null,

        numeroIntentoVigente: intentoVigente?.numeroIntento ?? null,

        intentoAnteriorId: intentoAnterior?._id ?? null,

        intentoSiguienteId: intentoSiguiente?._id ?? null,

        intentos: cadenaIntentos,
      },
    });
  } catch (error) {
    console.error("Error al consultar detalle de muestra:", error);

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo consultar el detalle de la muestra",
    });
  }
};

// ====== Registrar evidencia fotográfica ======

const registrarEvidenciaMuestra = async (req, res = response) => {
  let archivoSubido = null;
  let evidenciaPersistida = false;

  try {
    const { muestraLaboratorioId } = req.params;

    const { uid, nombreUsuario } = req.user;

    const { etapa, observacion } = req.body;

    // ====== Validar id ======

    if (!mongoose.Types.ObjectId.isValid(muestraLaboratorioId)) {
      throw new Error("El id de la muestra de laboratorio no es válido");
    }

    // ====== Validar archivo ======

    if (!req.file) {
      throw new Error("Debe adjuntar una imagen");
    }

    const mimeTypesPermitidos = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);

    if (!mimeTypesPermitidos.has(req.file.mimetype)) {
      throw new Error(
        "Formato de imagen no permitido. Solo se admite JPEG, PNG o WebP",
      );
    }

    if (!Buffer.isBuffer(req.file.buffer) || req.file.buffer.length === 0) {
      throw new Error("La imagen recibida no contiene datos válidos");
    }

    // ====== Validar etapa ======

    if (typeof etapa !== "string" || !etapa.trim()) {
      throw new Error("Debe indicar la etapa de la evidencia");
    }

    const etapaNormalizada = etapa.trim().toUpperCase();

    // ====== Validar observación ======

    if (
      observacion !== undefined &&
      observacion !== null &&
      typeof observacion !== "string"
    ) {
      throw new Error("La observación de la evidencia debe ser un texto");
    }

    const observacionNormalizada =
      typeof observacion === "string" ? observacion.trim() : "";

    // ====== Obtener muestra ======

    const muestra = await MuestraLaboratorio.findById(muestraLaboratorioId);

    if (!muestra) {
      throw new Error("La muestra de laboratorio no existe");
    }

    // ====== Validar muestra anulada ======

    if (muestra.estadoMuestra === "ANULADA") {
      throw new Error(
        "No se pueden registrar evidencias en una muestra anulada",
      );
    }

    // ====== Validar solicitud ======

    const solicitud = await SolicitudAtencion.findById(
      muestra.solicitudAtencionId,
    );

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se pueden registrar evidencias de una solicitud anulada",
      );
    }

    // ====== Validar trazabilidad de etapa ======

    validarEtapaEvidenciaMuestra({
      muestra,
      etapa: etapaNormalizada,
    });

    // ====== Construir prefijo S3 ======

    const keyPrefix =
      `laboratorio/muestras/` + `${muestra._id.toString()}/` + `evidencias`;

    // ====== Subir evidencia a S3 ======

    archivoSubido = await subirArchivoStorage({
      keyPrefix,

      buffer: req.file.buffer,

      mimeType: req.file.mimetype,
    });

    if (!archivoSubido?.archivoId || !archivoSubido?.key) {
      throw new Error(
        "El almacenamiento no devolvió una referencia válida del archivo",
      );
    }

    const ahora = new Date();

    // ====== Registrar metadata ======

    muestra.evidenciasFotograficas.push({
      archivoId: archivoSubido.archivoId,

      storageKey: archivoSubido.key,

      versionId: archivoSubido.versionId ?? null,

      etag: archivoSubido.etag ?? null,

      nombreArchivo:
        typeof req.file.originalname === "string"
          ? req.file.originalname.trim()
          : "",

      mimeType: req.file.mimetype,

      tamanoBytes: req.file.size,

      etapa: etapaNormalizada,

      observacion: observacionNormalizada,

      registradoPor: uid,

      usuarioRegistro: nombreUsuario ?? null,

      fechaRegistro: ahora,
    });

    // ====== Auditoría ======

    muestra.updatedBy = uid;

    muestra.usuarioActualizacion = nombreUsuario ?? null;

    muestra.fechaActualizacion = ahora;

    // ====== Obtener evidencia creada ======

    const evidencia =
      muestra.evidenciasFotograficas[muestra.evidenciasFotograficas.length - 1];

    // ====== Guardar muestra ======

    await muestra.save();

    evidenciaPersistida = true;

    return res.status(201).json({
      ok: true,

      msg: "Evidencia fotográfica registrada correctamente",

      muestraLaboratorioId: muestra._id,

      codigoEtiqueta: muestra.codigoEtiqueta,

      evidencia,
    });
  } catch (error) {
    // ====== Compensar archivo S3 ======

    if (archivoSubido?.key && !evidenciaPersistida) {
      try {
        await eliminarArchivo(
          archivoSubido.key,
          archivoSubido.versionId ?? undefined,
        );
      } catch (errorEliminacion) {
        console.error(
          "No se pudo eliminar de S3 la evidencia huérfana:",
          errorEliminacion,
        );
      }
    }

    console.error(
      "Error al registrar evidencia fotográfica de muestra:",
      error,
    );

    return res.status(400).json({
      ok: false,

      msg: error.message || "No se pudo registrar la evidencia fotográfica",
    });
  }
};

module.exports = {
  inicializarMuestrasSolicitud,
  recolectarMuestra,
  recibirMuestra,
  aceptarMuestra,
  rechazarMuestra,
  generarReintentoMuestra,
  obtenerMuestrasPorSolicitud,
  obtenerMuestrasPorCodigoLaboratorio,
  obtenerDetalleMuestra,
  registrarEvidenciaMuestra,
};
