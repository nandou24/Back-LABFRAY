const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const RutaSchema = Schema(
  {
    //como puedo hace a codRuta que sea un número autoincremental?
    codRuta: {
      type: String,
      required: true,
      unique: true,
    },
    nombreRuta: { type: String, required: true },
    nombreMostrar: { type: String, required: true },
    descripcionRuta: { type: String },
    urlRuta: { type: String, required: true },
    iconoRuta: { type: String, required: true }, //icono por defecto
    estado: { type: Boolean, required: true },
  },

  {
    timestamps: true,
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("rutaCollection", RutaSchema);
