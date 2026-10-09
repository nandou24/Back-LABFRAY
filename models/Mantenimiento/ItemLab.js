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

// ====== Configuración de resultados estructurados ======
const cuantificacionHallazgoSchema = new Schema(
  {
    tipo: {
      type: String,
      enum: ["CATEGORICA", "NUMERICA"],
      required: true,
    },
    precisionNumerica: {
      type: String,
      enum: ["ENTERO", "DECIMAL"],
      default: "DECIMAL",
    },
    opciones: {
      type: [String],
      default: [],
    },
    formatosCapturaNumerica: {
      type: [String],
      enum: [
        "VALOR",
        "RANGO",
        "MAYOR_QUE",
        "MAYOR_IGUAL_QUE",
        "MENOR_QUE",
        "MENOR_IGUAL_QUE",
      ],
      default: ["VALOR"],
    },
    formatoCapturaNumericaDefault: {
      type: String,
      enum: [
        "VALOR",
        "RANGO",
        "MAYOR_QUE",
        "MAYOR_IGUAL_QUE",
        "MENOR_QUE",
        "MENOR_IGUAL_QUE",
      ],
      default: "VALOR",
    },
  },
  { _id: false },
);

const configuracionEstructuradaSchema = new Schema(
  {
    subtipo: {
      type: String,
      enum: ["HALLAZGOS"],
      default: "HALLAZGOS",
    },
    permiteMultiples: {
      type: Boolean,
      default: true,
    },
    valorAusencia: {
      type: String,
      default: "NO SE OBSERVAN",
      trim: true,
    },
    ausenciaEsReferencia: {
      type: Boolean,
      default: false,
    },
    // ====== Hallazgos permitidos como referencia clínica ======
    hallazgosNormales: {
      type: [String],
      default: [],
    },
    permitirOtroHallazgo: {
      type: Boolean,
      default: false,
    },
    hallazgos: {
      type: [String],
      default: [],
    },
    cuantificacion: {
      type: cuantificacionHallazgoSchema,
      required: true,
    },
  },
  { _id: false },
);

const ItemLabSchema = Schema(
  {
    codItemLab: { type: String, unique: true },
    nombreInforme: { type: String, required: true, trim: true },
    nombreHojaTrabajo: { type: String, required: true, trim: true },
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
      enum: ["NUMERICO", "TEXTO", "CATEGORICO", "ESTRUCTURADO"],
      default: "TEXTO",
      required: true,
    },

    opcionesResultado: {
      type: [String],
      default: [],
    },

    // ====== Formatos permitidos para captura numérica ======
    formatosCapturaNumerica: {
      type: [
        {
          type: String,
          enum: [
            "VALOR",
            "RANGO",
            "MAYOR_QUE",
            "MAYOR_IGUAL_QUE",
            "MENOR_QUE",
            "MENOR_IGUAL_QUE",
          ],
        },
      ],
      default: ["VALOR"],
    },

    formatoCapturaNumericaDefault: {
      type: String,
      enum: [
        "VALOR",
        "RANGO",
        "MAYOR_QUE",
        "MAYOR_IGUAL_QUE",
        "MENOR_QUE",
        "MENOR_IGUAL_QUE",
      ],
      default: "VALOR",
    },


    // ====== Precisión permitida para captura numérica ======
    precisionNumerica: {
      type: String,
      enum: ["ENTERO", "DECIMAL"],
      default: "DECIMAL",
    },

    // ====== Alternativas cualitativas para Items numéricos ======
    valoresCualitativosAlternativos: {
      type: [String],
      default: [],
    },

    valoresCualitativosReferencia: {
      type: [String],
      default: [],
    },

    // ====== Configuración de hallazgos estructurados ======
    configuracionEstructurada: {
      type: configuracionEstructuradaSchema,
      default: null,
    },

    // ====== Valor inicial sugerido para captura ======
    // Texto/categórico: string. Numérico: number u objeto estructurado.
    valorPorDefectoResultado: {
      type: Schema.Types.Mixed,
      default: null,
    },

    permiteValorNoListado: {
      type: Boolean,
      default: false,
    },

    // ====== Item opcional en la prueba ======
    esOpcional: {
      type: Boolean,
      default: false,
    },

    // ====== Presentación de referencia en informe ======
    mostrarReferenciaInforme: {
      type: Boolean,
      default: true,
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
