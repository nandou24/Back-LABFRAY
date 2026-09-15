const mongoose = require("mongoose");
const { Schema } = mongoose;

// ====== Referencia aplicada ======

const ReferenciaAplicadaSchema = new Schema(
  {
    descripcion: {
      type: String,
      default: "",
    },

    sexo: {
      type: String,
      enum: ["TODOS", "MASCULINO", "FEMENINO"],
      default: "TODOS",
    },

    edadMin: {
      type: Number,
      default: null,
    },

    edadMax: {
      type: Number,
      default: null,
    },

    unidadEdad: {
      type: String,
      enum: ["DIAS", "MESES", "ANIOS"],
      default: "ANIOS",
    },

    tipoReferencia: {
      type: String,
      enum: [
        "RANGO",
        "MENOR_QUE",
        "MENOR_IGUAL_QUE",
        "MAYOR_QUE",
        "MAYOR_IGUAL_QUE",
        "VALORES_PERMITIDOS",
        "TEXTO",
      ],
      default: null,
    },

    valorMin: {
      type: Number,
      default: null,
    },

    valorMax: {
      type: Number,
      default: null,
    },

    valorLimite: {
      type: Number,
      default: null,
    },

    valoresPermitidos: {
      type: [String],
      default: [],
    },

    textoReferencia: {
      type: String,
      default: "",
    },
  },
  {
    _id: false,
  },
);

// ====== Evaluación del resultado ======

const EvaluacionReferenciaSchema = new Schema(
  {
    estado: {
      type: String,
      enum: [
        "PENDIENTE",
        "DENTRO_REFERENCIA",
        "FUERA_REFERENCIA",
        "BAJO",
        "ALTO",
        "VALOR_PERMITIDO",
        "VALOR_NO_PERMITIDO",
        "NO_APLICA",
      ],
      default: "PENDIENTE",
    },

    referenciaAplicada: {
      type: ReferenciaAplicadaSchema,
      default: null,
    },

    mensaje: {
      type: String,
      default: "",
    },
  },
  {
    _id: false,
  },
);

// ====== Alerta detectada ======

const AlertaDetectadaSchema = new Schema(
  {
    descripcion: {
      type: String,
      default: "",
    },

    condicion: {
      type: String,
      enum: [
        "MENOR_QUE",
        "MENOR_IGUAL_QUE",
        "MAYOR_QUE",
        "MAYOR_IGUAL_QUE",
        "FUERA_DE_RANGO",
        "IGUAL_A",
        "DISTINTO_DE",
      ],
      default: null,
    },

    valor1: {
      type: Schema.Types.Mixed,
      default: null,
    },

    valor2: {
      type: Schema.Types.Mixed,
      default: null,
    },

    nivelAlerta: {
      type: String,
      enum: ["INFORMATIVA", "ADVERTENCIA", "CRITICA"],
      required: true,
    },

    mensaje: {
      type: String,
      default: "",
    },

    fechaDeteccion: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  },
);

// ====== Resultado de Item ======

const ResultadoItemSchema = new Schema(
  {
    claveItemResultado: {
      type: String,
      required: true,
      trim: true,
    },

    // ====== Ubicación en snapshot ======

    indiceGrupo: {
      type: Number,
      required: true,
      min: 0,
    },

    indiceItem: {
      type: Number,
      required: true,
      min: 0,
    },

    nombreGrupo: {
      type: String,
      default: "",
    },

    ordenGrupo: {
      type: Number,
      default: 0,
    },

    ordenItem: {
      type: Number,
      default: 0,
    },

    // ====== Identidad del Item ======

    itemLabId: {
      type: Schema.Types.ObjectId,
      ref: "itemsLabCollection",
      required: true,
    },

    codItemLab: {
      type: String,
      default: null,
    },

    nombreInforme: {
      type: String,
      required: true,
    },

    tipoResultado: {
      type: String,
      enum: ["NUMERICO", "TEXTO", "CATEGORICO"],
      required: true,
    },

    unidadesRef: {
      type: String,
      default: "",
    },

    // ====== Resultado transaccional ======

    valor: {
      type: Schema.Types.Mixed,
      default: null,
    },

    observacion: {
      type: String,
      default: "",
    },

    estado: {
      type: String,
      enum: ["PENDIENTE", "REGISTRADO", "VALIDADO", "ANULADO"],
      default: "PENDIENTE",
    },

    // ====== Evaluación clínica ======

    evaluacionReferencia: {
      type: EvaluacionReferenciaSchema,
      default: () => ({
        estado: "PENDIENTE",
      }),
    },

    alertasDetectadas: {
      type: [AlertaDetectadaSchema],
      default: [],
    },

    // ====== Trazabilidad del Item ======

    registradoPor: {
      type: String,
      default: null,
    },

    usuarioRegistroResultado: {
      type: String,
      default: null,
    },

    fechaRegistroResultado: {
      type: Date,
      default: null,
    },

    actualizadoPor: {
      type: String,
      default: null,
    },

    usuarioActualizacionResultado: {
      type: String,
      default: null,
    },

    fechaActualizacionResultado: {
      type: Date,
      default: null,
    },
  },
  {
    _id: true,
  },
);

// ====== Resultado de laboratorio ======

const ResultadoLaboratorioSchema = new Schema(
  {
    // ====== Orden de laboratorio ======

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

    claveUnidad: {
      type: String,
      required: true,
      trim: true,
    },

    // ====== Identidad clínica ======

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

    numeroInstancia: {
      type: Number,
      required: true,
      min: 1,
    },

    etiquetaInstancia: {
      type: String,
      default: null,
    },

    // ====== Resultados ======

    resultadosItems: {
      type: [ResultadoItemSchema],
      default: [],
    },

    observacionGeneral: {
      type: String,
      default: "",
    },

    // ====== Estado ======

    estadoResultado: {
      type: String,
      enum: [
        "PENDIENTE",
        "EN PROCESO",
        "COMPLETO",
        "VALIDADO",
        "LIBERADO",
        "ANULADO",
      ],
      default: "PENDIENTE",
      index: true,
    },

    // ====== Validación ======

    validadoPor: {
      type: String,
      default: null,
    },

    usuarioValidacion: {
      type: String,
      default: null,
    },

    fechaValidacion: {
      type: Date,
      default: null,
    },

    observacionValidacion: {
      type: String,
      default: "",
    },

    // ====== Liberación ======

    liberadoPor: {
      type: String,
      default: null,
    },

    usuarioLiberacion: {
      type: String,
      default: null,
    },

    fechaLiberacion: {
      type: Date,
      default: null,
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

// ====== Una unidad solo puede tener un resultado ======

ResultadoLaboratorioSchema.index(
  {
    solicitudAtencionId: 1,
    claveUnidad: 1,
  },
  {
    unique: true,
  },
);

// ====== Evitar claves Item repetidas ======

ResultadoLaboratorioSchema.path("resultadosItems").validate(function (items) {
  if (!Array.isArray(items)) {
    return true;
  }

  const claves = items.map((item) => item.claveItemResultado);

  return new Set(claves).size === claves.length;
}, "Existen Items de resultado duplicados");

// ====== Modelo ======

module.exports = mongoose.model(
  "ResultadoLaboratorio",
  ResultadoLaboratorioSchema,
);
