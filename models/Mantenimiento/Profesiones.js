const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const ProfesionSchema = Schema(
  {
    codProfesion: { type: String, required: true, unique: true },
    nombreProfesion: {
      type: String,
      unique: true,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    estadoProfesion: { type: Boolean, default: true },
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
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("profesionesCollection", ProfesionSchema);
