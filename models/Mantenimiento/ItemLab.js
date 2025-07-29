const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const valoresSchema = new mongoose.Schema({
  descrValidacion: { type: String },
  sexo: { type: String },
  edadIndistinta: { type: String },
  edadMin: { type: String },
  edadMax: { type: String },
  descRegla: { type: String },
  valor1: { type: String },
  valor2: { type: String },
});

const ItemLabSchema = Schema(
  {
    codItemLab: { type: String, unique: true },
    nombreInforme: { type: String, required: true },
    nombreHojaTrabajo: { type: String, required: true },
    metodoItemLab: { type: String, required: true },
    valoresHojaTrabajo: { type: String, required: true },
    valoresInforme: { type: String, required: true },
    unidadesRef: { type: String, required: true },
    poseeValidacion: { type: Boolean, required: true },
    perteneceAPrueba: { type: String },
    grupoItemLab: { type: String },
    paramValidacion: [valoresSchema],
  },
  {
    timestamps: true,
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("itemsLabCollection", ItemLabSchema);
