const { Schema, model } = require("mongoose");

const DiaNoLaborableSchema = new Schema(
  {
    fecha: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    anio: {
      type: Number,
      required: true,
      index: true,
    },

    descripcion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },

    tipo: {
      type: String,
      enum: [
        "FERIADO_NACIONAL",
        "FERIADO_LOCAL",
        "CIERRE_INSTITUCIONAL",
        "OTRO",
      ],
      default: "FERIADO_NACIONAL",
      required: true,
    },

    observacion: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    estadoDiaNoLaborable: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
      required: true,
      index: true,
    },

    createdBy: {
      type: String,
      default: null,
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

DiaNoLaborableSchema.index({ anio: 1, fecha: 1 });
DiaNoLaborableSchema.index({ estadoDiaNoLaborable: 1, fecha: 1 });

module.exports = model("diaNoLaborableCollection", DiaNoLaborableSchema);
