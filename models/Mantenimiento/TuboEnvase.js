const mongoose = require("mongoose");
const { Schema } = mongoose;

const TuboEnvaseSchema = new Schema(
  {
    codTuboEnvase: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    nombreTuboEnvase: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      set: (value) => value.toUpperCase(),
    },

    descripcionTuboEnvase: {
      type: String,
      default: "",
      trim: true,
    },

    color: {
      type: String,
      default: "",
      trim: true,
      set: (value) => value?.toUpperCase(),
    },

    aditivo: {
      type: String,
      default: "",
      trim: true,
      set: (value) => value?.toUpperCase(),
    },

    capacidad: {
      type: Number,
      default: null,
      min: 0,
    },

    unidadCapacidad: {
      type: String,
      default: null,
      trim: true,
    },

    estadoTuboEnvase: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
      required: true,
    },

    // ==========================
    // AUDITORÍA
    // ==========================

    createdBy: {
      type: String,
      required: true,
    },

    usuarioRegistro: {
      type: String,
    },

    fechaRegistro: {
      type: Date,
      default: Date.now,
    },

    updatedBy: {
      type: String,
    },

    usuarioActualizacion: {
      type: String,
    },

    fechaActualizacion: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("tuboEnvaseCollection", TuboEnvaseSchema);
