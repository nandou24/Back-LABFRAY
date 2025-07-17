const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const EspecialidadSchema = Schema(
  {
    codEspecialidad: { type: String, required: true, unique: true },
    nombreEspecialidad: {
      type: String,
      unique: true,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    estadoEspecialidad: { type: Boolean, default: true },
    profesionRef: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "profesionesCollection", // Referencia a la colección de profesiones
    },
  },
  {
    timestamps: true,
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("especialidadesCollection", EspecialidadSchema);
