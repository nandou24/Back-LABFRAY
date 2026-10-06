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
        ref: "rutaCollection",
      },
    ],
    permisosAcciones: {
      type: [String],
      default: [],
    },
    estado: { type: Boolean, required: true },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("rolCollection", Roleschema);
