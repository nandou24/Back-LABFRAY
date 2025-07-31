const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const itemsSchema = new mongoose.Schema({
  itemLabId: {
    type: Schema.Types.ObjectId,
    ref: "itemsLabCollection",
  },
  //   codItemLab: { type: String, required: true },
  //   nombreItemLab: { type: String, required: true },
  //   perteneceA: { type: String },
});

const PruebaLabSchema = Schema(
  {
    codPruebaLab: { type: String, unique: true },
    areaLab: { type: String, required: true },
    nombrePruebaLab: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    condPreAnalitPaciente: { type: String, required: true },
    condPreAnalitRefer: { type: String, required: true },
    tipoMuestra: { type: [String], required: true },
    tipoTuboEnvase: { type: [String], required: true },
    tiempoRespuesta: { type: String, required: true },
    observPruebas: { type: String },
    estadoPrueba: { type: String, required: true },
    ordenImpresion: { type: Number, default: 0 },
    itemsComponentes: [itemsSchema],
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
module.exports = mongoose.model("pruebasLabCollection", PruebaLabSchema);
