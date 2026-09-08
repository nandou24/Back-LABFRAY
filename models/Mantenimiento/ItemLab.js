const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const valoresSchema = new mongoose.Schema({
  descrValidacion: { type: String },
  sexo: { type: String },
  edadIndistinta: { type: String },
  edadMin: { type: String },
  edadMax: { type: String },
  descRegla: { type: String },
  valor1: { type: String },
  valor2: { type: String },
});

// ==========================================================
// RANGO / VALOR DE REFERENCIA
// ==========================================================
const referenciaResultadoSchema = new Schema({
  descripcion: {
    type: String,
    default: "",
    trim: true,
  },

  sexo: {
    type: String,
    enum: ["TODOS", "MASCULINO", "FEMENINO"],
    default: "TODOS",
  },

  edadMin: {
    type: Number,
    default: null,
    min: 0,
  },

  edadMax: {
    type: Number,
    default: null,
    min: 0,
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
    required: true,
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
    trim: true,
  },

  activo: {
    type: Boolean,
    default: true,
  },
});

// ==========================================================
// REGLAS QUE GENERAN ALERTAS DURANTE EL REPORTE
// ==========================================================
const reglaAlertaSchema = new Schema({
  descripcion: {
    type: String,
    default: "",
    trim: true,
  },

  sexo: {
    type: String,
    enum: ["TODOS", "MASCULINO", "FEMENINO"],
    default: "TODOS",
  },

  edadMin: {
    type: Number,
    default: null,
    min: 0,
  },

  edadMax: {
    type: Number,
    default: null,
    min: 0,
  },

  unidadEdad: {
    type: String,
    enum: ["DIAS", "MESES", "ANIOS"],
    default: "ANIOS",
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
    required: true,
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
    default: "ADVERTENCIA",
  },

  mensaje: {
    type: String,
    default: "",
    trim: true,
  },

  activo: {
    type: Boolean,
    default: true,
  },
});

const ItemLabSchema = Schema(
  {
    codItemLab: { type: String, unique: true },
    nombreInforme: { type: String, required: true },
    nombreHojaTrabajo: { type: String, required: true },
    metodoItemLab: { type: String, required: true },
    valoresHojaTrabajo: { type: String, default: "" },
    valoresInforme: { type: String, default: "" },
    unidadesRef: { type: String, default: "" },
    ordenImpresion: { type: Number, default: 0 },
    poseeValidacion: { type: Boolean, required: true },
    perteneceAPrueba: {
      type: Schema.Types.ObjectId,
      ref: "pruebasLabCollection",
      default: null,
    },
    grupoItemLab: { type: String },
    paramValidacion: [valoresSchema],
    referenciasResultado: {
      type: [referenciaResultadoSchema],
      default: [],
    },

    reglasAlerta: {
      type: [reglaAlertaSchema],
      default: [],
    },

    contextoAnalitico: {
      type: String,
      default: "",
      trim: true,
      set: (value) => value?.toUpperCase(),
    },

    tipoResultado: {
      type: String,
      enum: ["NUMERICO", "TEXTO", "CATEGORICO"],
      default: "TEXTO",
      required: true,
    },

    opcionesResultado: {
      type: [String],
      default: [],
    },

    estadoItem: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
      required: true,
    },

    // 🔍 Campos de auditoría:
    createdBy: { type: String, required: true }, // uid
    usuarioRegistro: { type: String }, // nombre de usuario
    fechaRegistro: { type: Date, default: Date.now },
    updatedBy: { type: String }, // uid del usuario que actualiza
    usuarioActualizacion: { type: String },
    fechaActualizacion: { type: Date },
  },
  {
    timestamps: true,
  },
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("itemsLabCollection", ItemLabSchema);
