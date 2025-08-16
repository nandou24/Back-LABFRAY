const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const examenesSchema = new mongoose.Schema({
  pruebaLabId: {
    type: Schema.Types.ObjectId,
    ref: "pruebasLabCollection",
  },
  codExamen: { type: String, required: true },
  nombreExamen: { type: String, required: true },
  tipoExamen: { type: String, required: false },
});

const profAsociadasSchema = new mongoose.Schema({
  profesionId: { type: Schema.Types.ObjectId, ref: "profesionCollection" },
  especialidadId: {
    type: Schema.Types.ObjectId,
    ref: "especialidadCollection",
    required: false,
    default: null,
  },
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
    favoritoServicioEmpresa: { type: Boolean, default: false },
    examenesServicio: [examenesSchema],
    profesionesAsociadas: [profAsociadasSchema],
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
module.exports = mongoose.model("servicioCollection", ServicioSchema);
