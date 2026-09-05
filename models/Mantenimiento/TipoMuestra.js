const mongoose = require("mongoose");
const { Schema } = mongoose;

const TipoMuestraSchema = new Schema(
  {
    codTipoMuestra: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    nombreTipoMuestra: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      set: (value) => value.toUpperCase(),
    },

    descripcionTipoMuestra: {
      type: String,
      default: "",
      trim: true,
    },

    estadoTipoMuestra: {
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

module.exports = mongoose.model("tipoMuestraCollection", TipoMuestraSchema);
