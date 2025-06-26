const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const Roleschema = Schema(
  {
    codRol: {
      type: String,
      required: true,
      unique: true,
    },
    nombreRol: { type: String, required: true },
    descripcionRol: { type: String },
    rutasPermitidas: [
      {
        type: Schema.Types.ObjectId,
        ref: "rutaCollection", // Referencia a la colección de rutas
      },
    ],
    estado: { type: Boolean, required: true },
  },

  {
    timestamps: true,
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("rolCollection", Roleschema);
