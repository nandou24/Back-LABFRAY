const mongoose = require("mongoose");
const { Schema } = mongoose;

// ====== Snapshot tipo de muestra ======

const TipoMuestraSnapshotSchema = new Schema(
  {
    codTipoMuestra: {
      type: String,
      default: null,
    },

    nombreTipoMuestra: {
      type: String,
      default: "",
    },

    descripcionTipoMuestra: {
      type: String,
      default: "",
    },

    estadoTipoMuestra: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
    },
  },
  {
    _id: false,
  },
);

// ====== Snapshot tubo / envase ======

const TuboEnvaseSnapshotSchema = new Schema(
  {
    codTuboEnvase: {
      type: String,
      default: null,
    },

    nombreTuboEnvase: {
      type: String,
      default: "",
    },

    descripcionTuboEnvase: {
      type: String,
      default: "",
    },

    color: {
      type: String,
      default: "",
    },

    aditivo: {
      type: String,
      default: "",
    },

    capacidad: {
      type: Number,
      default: null,
    },

    unidadCapacidad: {
      type: String,
      default: null,
    },

    estadoTuboEnvase: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
    },
  },
  {
    _id: false,
  },
);

// ====== Opción histórica permitida ======

const OpcionMuestraSnapshotSchema = new Schema(
  {
    tipoMuestraId: {
      type: Schema.Types.ObjectId,
      ref: "tipoMuestraCollection",
      required: true,
    },

    tipoMuestra: {
      type: TipoMuestraSnapshotSchema,
      required: true,
    },

    tuboEnvaseId: {
      type: Schema.Types.ObjectId,
      ref: "tuboEnvaseCollection",
      required: true,
    },

    tuboEnvase: {
      type: TuboEnvaseSnapshotSchema,
      required: true,
    },
  },
  {
    _id: false,
  },
);

// ====== Cobertura del recipiente ======

const CoberturaMuestraSchema = new Schema(
  {
    // ====== Identidad de cobertura ======

    claveCobertura: {
      type: String,
      required: true,
      trim: true,
    },

    claveUnidad: {
      type: String,
      required: true,
      trim: true,
    },

    // ====== Servicio ======

    servicioId: {
      type: Schema.Types.ObjectId,
      ref: "servicioCollection",
      required: true,
    },

    codServicio: {
      type: String,
      required: true,
      trim: true,
    },

    nombreServicio: {
      type: String,
      required: true,
      trim: true,
    },

    // ====== Prueba ======

    pruebaLabId: {
      type: Schema.Types.ObjectId,
      ref: "pruebasLabCollection",
      required: true,
    },

    codPruebaLab: {
      type: String,
      required: true,
      trim: true,
    },

    nombrePruebaLab: {
      type: String,
      required: true,
      trim: true,
    },

    // ====== Instancia clínica ======

    modalidadInstancias: {
      type: String,
      enum: ["UNICA", "MUESTRAS_INDEPENDIENTES", "REPETICIONES_MISMA_MUESTRA"],
      required: true,
    },

    numeroInstancia: {
      type: Number,
      required: true,
      min: 1,
    },

    etiquetaInstancia: {
      type: String,
      default: null,
    },

    // ====== Requerimiento histórico ======

    indiceRequerimiento: {
      type: Number,
      required: true,
      min: 0,
    },

    descripcionRequerimiento: {
      type: String,
      default: "",
      trim: true,
    },

    alcance: {
      type: String,
      enum: ["TODA_PRUEBA", "ITEMS_ESPECIFICOS"],
      required: true,
    },

    opcionesPermitidas: {
      type: [OpcionMuestraSnapshotSchema],
      default: [],
    },

    itemsAsociados: [
      {
        type: Schema.Types.ObjectId,
        ref: "itemsLabCollection",
      },
    ],

    cantidadRecipientes: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    volumenMinimo: {
      type: Number,
      default: null,
      min: 0,
    },

    unidadVolumen: {
      type: String,
      enum: [null, "uL", "mL", "L"],
      default: null,
    },

    permiteCompartirMuestra: {
      type: Boolean,
      default: true,
    },

    observacion: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
  },
);

// ====== Evidencia fotográfica ======

const EvidenciaFotograficaMuestraSchema = new Schema(
  {
    // Identificador entregado por el almacenamiento.
    archivoId: {
      type: String,
      required: true,
      trim: true,
    },

    // ====== Almacenamiento ======

    storageKey: {
      type: String,
      required: true,
      trim: true,
    },

    versionId: {
      type: String,
      default: null,
      trim: true,
    },

    etag: {
      type: String,
      default: null,
      trim: true,
    },

    nombreArchivo: {
      type: String,
      default: "",
      trim: true,
    },

    mimeType: {
      type: String,
      default: "",
      trim: true,
    },

    tamanoBytes: {
      type: Number,
      default: null,
      min: 0,
    },

    etapa: {
      type: String,
      enum: ["RECOLECCION", "RECEPCION", "ACEPTACION", "RECHAZO"],
      required: true,
    },

    observacion: {
      type: String,
      default: "",
      trim: true,
    },

    registradoPor: {
      type: String,
      required: true,
    },

    usuarioRegistro: {
      type: String,
      default: null,
    },

    fechaRegistro: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  },
);

// ====== Muestra física ======

const MuestraLaboratorioSchema = new Schema(
  {
    // ====== Solicitud ======

    solicitudAtencionId: {
      type: Schema.Types.ObjectId,
      ref: "SolicitudAtencion",
      required: true,
      index: true,
    },

    codSolicitud: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // ====== Código laboratorio ======

    codigoLaboratorio: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },

    // ====== Identidad física ======

    codMuestra: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // ====== Código visible de etiqueta ======

    codigoEtiqueta: {
      type: String,
      default: null,
      trim: true,
    },

    // Identifica el recipiente planificado.
    // Se conserva entre intentos de recolección.
    claveMuestraPlan: {
      type: String,
      required: true,
      trim: true,
    },

    numeroRecipiente: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    numeroIntento: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    muestraAnteriorId: {
      type: Schema.Types.ObjectId,
      ref: "MuestraLaboratorio",
      default: null,
    },

    // ====== Cobertura clínica ======

    coberturas: {
      type: [CoberturaMuestraSchema],
      default: [],
    },

    // ====== Opción utilizada realmente ======

    tipoMuestraId: {
      type: Schema.Types.ObjectId,
      ref: "tipoMuestraCollection",
      default: null,
    },

    tipoMuestra: {
      type: TipoMuestraSnapshotSchema,
      default: null,
    },

    tuboEnvaseId: {
      type: Schema.Types.ObjectId,
      ref: "tuboEnvaseCollection",
      default: null,
    },

    tuboEnvase: {
      type: TuboEnvaseSnapshotSchema,
      default: null,
    },

    // ====== Cantidad recolectada ======

    volumenRecolectado: {
      type: Number,
      default: null,
      min: 0,
    },

    unidadVolumenRecolectado: {
      type: String,
      enum: [null, "uL", "mL", "L"],
      default: null,
    },

    // ====== Estado ======

    estadoMuestra: {
      type: String,
      enum: [
        "PENDIENTE",
        "RECOLECTADA",
        "RECEPCIONADA",
        "ACEPTADA",
        "RECHAZADA",
        "ANULADA",
      ],
      default: "PENDIENTE",
      required: true,
      index: true,
    },

    observacionGeneral: {
      type: String,
      default: "",
      trim: true,
    },

    // ====== Evidencias fotográficas ======

    evidenciasFotograficas: {
      type: [EvidenciaFotograficaMuestraSchema],
      default: [],
    },

    // ====== Recolección ======

    recolectadoPor: {
      type: String,
      default: null,
    },

    usuarioRecoleccion: {
      type: String,
      default: null,
    },

    fechaRecoleccion: {
      type: Date,
      default: null,
    },

    observacionRecoleccion: {
      type: String,
      default: "",
      trim: true,
    },
    // ====== Recepción ======

    recibidoPor: {
      type: String,
      default: null,
    },

    usuarioRecepcion: {
      type: String,
      default: null,
    },

    fechaRecepcion: {
      type: Date,
      default: null,
    },

    observacionRecepcion: {
      type: String,
      default: "",
      trim: true,
    },

    // ====== Aceptación ======

    aceptadoPor: {
      type: String,
      default: null,
    },

    usuarioAceptacion: {
      type: String,
      default: null,
    },

    fechaAceptacion: {
      type: Date,
      default: null,
    },

    observacionAceptacion: {
      type: String,
      default: "",
      trim: true,
    },

    // ====== Rechazo ======

    rechazadoPor: {
      type: String,
      default: null,
    },

    usuarioRechazo: {
      type: String,
      default: null,
    },

    fechaRechazo: {
      type: Date,
      default: null,
    },

    motivoRechazo: {
      type: String,
      default: null,
      trim: true,
    },

    // ====== Anulación ======

    estadoPrevioAnulacion: {
      type: String,
      enum: [
        null,
        "PENDIENTE",
        "RECOLECTADA",
        "RECEPCIONADA",
        "ACEPTADA",
        "RECHAZADA",
      ],
      default: null,
    },

    anuladoPor: {
      type: String,
      default: null,
    },

    usuarioAnulacion: {
      type: String,
      default: null,
    },

    fechaAnulacion: {
      type: Date,
      default: null,
    },

    motivoAnulacion: {
      type: String,
      default: null,
      trim: true,
    },

    // ====== Auditoría ======

    createdBy: {
      type: String,
      required: true,
    },

    usuarioRegistro: {
      type: String,
      default: null,
    },

    fechaRegistro: {
      type: Date,
      default: Date.now,
    },

    updatedBy: {
      type: String,
      default: null,
    },

    usuarioActualizacion: {
      type: String,
      default: null,
    },

    fechaActualizacion: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// ====== Índices ======

MuestraLaboratorioSchema.index({
  solicitudAtencionId: 1,
  estadoMuestra: 1,
});

MuestraLaboratorioSchema.index({
  "coberturas.claveUnidad": 1,
});

MuestraLaboratorioSchema.index(
  {
    solicitudAtencionId: 1,
    claveMuestraPlan: 1,
    numeroIntento: 1,
  },
  {
    unique: true,
  },
);

// ====== Índice código etiqueta ======

MuestraLaboratorioSchema.index(
  {
    codigoEtiqueta: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      codigoEtiqueta: {
        $type: "string",
      },
    },
  },
);

module.exports = mongoose.model("MuestraLaboratorio", MuestraLaboratorioSchema);
