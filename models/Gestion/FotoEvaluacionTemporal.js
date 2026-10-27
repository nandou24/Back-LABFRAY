const { Schema, model } = require('mongoose');

// ====== Foto temporal asociada a la programación, nunca al maestro ======
const FotoEvaluacionTemporalSchema = new Schema({
  programacionEmpresaId: {
    type: Schema.Types.ObjectId,
    ref: 'programacionPacienteEmpresaCollection',
    required: true,
    index: true,
  },
  solicitudAtencionIds: [{ type: Schema.Types.ObjectId, ref: 'SolicitudAtencion' }],
  tipoArchivo: { type: String, enum: ['FOTO_EVALUACION_TEMPORAL'], default: 'FOTO_EVALUACION_TEMPORAL', required: true },
  origenArchivo: { type: String, enum: ['CAMARA'], default: 'CAMARA', required: true },
  storageProvider: { type: String, enum: ['AWS_S3'], default: 'AWS_S3', required: true },
  storageBucket: { type: String, required: true },
  storageKey: { type: String, required: true, unique: true },
  storageVersionId: { type: String, default: null },
  etag: { type: String, default: null },
  mimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
  tamanioBytes: { type: Number, min: 1, required: true },
  estadoArchivo: { type: String, enum: ['ACTIVO', 'REEMPLAZADO'], default: 'ACTIVO', required: true },
  // ====== Cadena de sustituciones y responsable ======
  reemplazaA: { type: Schema.Types.ObjectId, ref: 'FotoEvaluacionTemporal', default: null },
  reemplazadoPor: { type: Schema.Types.ObjectId, ref: 'FotoEvaluacionTemporal', default: null },
  fechaReemplazo: { type: Date, default: null },
  reemplazadoPorUsuario: { type: String, default: null },
  reemplazadoPorNombre: { type: String, default: null },
  fechaCaptura: { type: Date, default: Date.now },
  createdBy: { type: String, required: true },
  usuarioRegistro: { type: String, default: null },
}, { timestamps: true, collection: 'fotoEvaluacionTemporalCollection' });

// ====== Solo una fotografía activa por programación ======
FotoEvaluacionTemporalSchema.index(
  { programacionEmpresaId: 1, estadoArchivo: 1 },
  { unique: true, partialFilterExpression: { estadoArchivo: 'ACTIVO' } },
);

module.exports = model('FotoEvaluacionTemporal', FotoEvaluacionTemporalSchema);
