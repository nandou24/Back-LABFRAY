const mongoose = require('mongoose');
const { Schema } = mongoose;

// ====== Conservar PNG histórico usado en informes ======
const FirmaProfesionalLaboratorioVersionSchema = new Schema({
  recursoHumanoId: {
    type: Schema.Types.ObjectId,
    ref: 'recursosHumanosCollection',
    required: true,
  },
  hashSha256: { type: String, required: true },
  imagen: { type: Buffer, required: true, select: false },
  fechaRegistro: { type: Date, default: Date.now },
}, { timestamps: true });

FirmaProfesionalLaboratorioVersionSchema.index(
  { recursoHumanoId: 1, hashSha256: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  'FirmaProfesionalLaboratorioVersion',
  FirmaProfesionalLaboratorioVersionSchema,
);
