const mongoose = require("mongoose");
const { Schema } = mongoose;

// ====== Archivo PNG aislado del listado de Recursos Humanos ======
const FirmaProfesionalLaboratorioSchema = new Schema({
  recursoHumanoId: {
    type: Schema.Types.ObjectId,
    ref: "recursosHumanosCollection",
    unique: true,
    required: true,
  },
  imagen: { type: Buffer, default: null, select: false },
  imagenesPorPerfil: { type: [{
    perfilId: { type: String, required: true },
    imagen: { type: Buffer, required: true },
    hashSha256: { type: String, required: true },
    fechaActualizacion: { type: Date, default: Date.now },
  }], default: [], select: false },
  hashSha256: { type: String, default: null },
  fechaActualizacion: { type: Date, default: Date.now },
  actualizadoPor: { type: String, required: true },
  usuarioActualizacion: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model("FirmaProfesionalLaboratorio", FirmaProfesionalLaboratorioSchema);
