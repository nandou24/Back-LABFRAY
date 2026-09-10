const mongoose = require("mongoose");
const { Schema } = require("mongoose");

// ==========================================================
// CONFIGURACIÓN DE PROCESAMIENTO
// INTERNO / REFERENCIA
// ==========================================================
const ProcesamientoSchema = new Schema(
  {
    tipo: {
      type: String,
      enum: ["INTERNO", "REFERENCIA"],
      required: true,
    },

    // Se utilizará posteriormente cuando creemos
    // el mantenimiento de laboratorios de referencia
    laboratorioReferenciaId: {
      type: Schema.Types.ObjectId,
      ref: "laboratorioReferenciaCollection",
      default: null,
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

// ==========================================================
// ITEM DENTRO DE UN GRUPO DE RESULTADOS
// ==========================================================
const ItemGrupoResultadoSchema = new Schema({
  itemLabId: {
    type: Schema.Types.ObjectId,
    ref: "itemsLabCollection",
    required: true,
  },

  ordenItem: {
    type: Number,
    default: 0,
    min: 0,
  },

  mostrarItem: {
    type: Boolean,
    default: true,
  },

  procesamientoOverride: {
    type: ProcesamientoSchema,
    default: null,
  },
});

// ==========================================================
// GRUPO DE RESULTADOS DENTRO DE UNA PRUEBA
// ==========================================================
const GrupoResultadoSchema = new Schema({
  nombreGrupo: {
    type: String,
    default: "",
    trim: true,
  },

  ordenGrupo: {
    type: Number,
    default: 0,
    min: 0,
  },

  mostrarTitulo: {
    type: Boolean,
    default: true,
  },

  procesamientoOverride: {
    type: ProcesamientoSchema,
    default: null,
  },

  items: {
    type: [ItemGrupoResultadoSchema],
    default: [],
  },
});

// ==========================================================
// OPCIÓN VÁLIDA PARA CUMPLIR UN REQUERIMIENTO DE MUESTRA
// ==========================================================
const OpcionMuestraSchema = new Schema(
  {
    tipoMuestraId: {
      type: Schema.Types.ObjectId,
      ref: "tipoMuestraCollection",
      required: true,
    },

    tuboEnvaseId: {
      type: Schema.Types.ObjectId,
      ref: "tuboEnvaseCollection",
      required: true,
    },
  },
  {
    _id: false,
  },
);

// ==========================================================
// REQUERIMIENTO DE MUESTRA DE UNA PRUEBA
// ==========================================================
const RequerimientoMuestraSchema = new Schema({
  descripcion: {
    type: String,
    default: "",
    trim: true,
  },

  alcance: {
    type: String,
    enum: ["TODA_PRUEBA", "ITEMS_ESPECIFICOS"],
    default: "TODA_PRUEBA",
    required: true,
  },

  // Una o varias combinaciones válidas.
  // Cumplir UNA opción satisface este requerimiento.
  opciones: {
    type: [OpcionMuestraSchema],
    default: [],
  },

  // Se utiliza únicamente cuando alcance === "ITEMS_ESPECIFICOS"
  itemsAsociados: [
    {
      type: Schema.Types.ObjectId,
      ref: "itemsLabCollection",
    },
  ],

  cantidadRecipientes: {
    type: Number,
    default: 1,
    min: 1,
  },

  volumenMinimo: {
    type: Number,
    default: null,
    min: 0,
  },

  unidadVolumen: {
    type: String,
    enum: ["uL", "mL", "L"],
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
});

const PruebaLabSchema = Schema(
  {
    codPruebaLab: { type: String, unique: true },
    areaLab: { type: String, required: true },
    nombrePruebaLab: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    condPreAnalitPaciente: { type: String, required: true },
    condPreAnalitRefer: { type: String, required: true },
    tiempoRespuesta: { type: String, required: true },
    observPruebas: { type: String },
    estadoPrueba: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
      required: true,
    },

    // ==========================================================
    // NUEVA ESTRUCTURA DE COMPOSICIÓN DE LA PRUEBA
    // ==========================================================

    gruposResultado: {
      type: [GrupoResultadoSchema],
      default: [],
    },

    // ==========================================================
    // PROCESAMIENTO POR DEFECTO DE LA PRUEBA
    // ==========================================================
    procesamientoDefault: {
      type: ProcesamientoSchema,
      default: () => ({
        tipo: "INTERNO",
      }),
    },
    // ==========================================================
    // CONFIGURACIÓN DE MUESTRAS
    // ==========================================================

    requiereMuestra: {
      type: Boolean,
      default: true,
    },

    requerimientosMuestra: {
      type: [RequerimientoMuestraSchema],
      default: [],
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
module.exports = mongoose.model("pruebasLabCollection", PruebaLabSchema);
