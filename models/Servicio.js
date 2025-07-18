const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const examenesSchema = new mongoose.Schema({
  codExamen: { type: String, required: true },
  nombreExamen: { type: String, required: true },
  tipoExamen: { type: String, required: false },
});

const ServicioSchema = Schema(
  {
    codServicio: { type: String, required: true, unique: true },
    tipoServicio: { type: String, required: true },
    nombreServicio: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    descripcionServicio: { type: String },
    precioServicio: { type: String, required: true },
    estadoServicio: { type: String, required: true },
    favoritoServicio: { type: Boolean, default: false },
    examenesServicio: [examenesSchema],
    profesionId: { type: Schema.Types.ObjectId, ref: "profesionCollection" },
    especialidadId: {
      type: Schema.Types.ObjectId,
      ref: "especialidadCollection",
    },
  },
  {
    timestamps: true,
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("servicioCollection", ServicioSchema);
