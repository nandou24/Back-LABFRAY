const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const EspecialidadSchema = Schema({
  codEspecialidad: { type: Number, required: true, unique: true },
  nombreEspecialidad: {
    type: String,
    unique: true,
    required: true,
    set: (value) => value.toUpperCase(),
  },
  codProfesion: {
    type: String,
    required: true,
    ref: "profesionesCollection", // Referencia a la colección de profesiones
  },
    estadoEspecialidad: { type: Boolean, default: true },
});

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("especialidadCollection", EspecialidadSchema);