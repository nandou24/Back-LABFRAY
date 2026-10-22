const mongoose = require('mongoose');
const { Schema } = mongoose;

// ====== Prueba incluida en la emisión ======
const ResultadoVerificadoSchema = new Schema({
  resultadoLaboratorioId: {
    type: Schema.Types.ObjectId,
    ref: 'ResultadoLaboratorio',
    required: true,
  },
  versionResultado: { type: Number, required: true, min: 1 },
  codPruebaLab: { type: String, required: true, trim: true },
  hashContenido: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
}, { _id: false });

// ====== Registro de verificación independiente del despacho ======
const InformeVerificacionLaboratorioSchema = new Schema({
  codigoInforme: { type: String, required: true, unique: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  solicitudAtencionId: {
    type: Schema.Types.ObjectId,
    ref: 'SolicitudAtencion',
    required: true,
    index: true,
  },
  codSolicitud: { type: String, required: true, trim: true },
  codigoLaboratorio: { type: String, default: '', trim: true },
  tipoInforme: { type: String, enum: ['PARCIAL', 'FINAL'], required: true },
  resultados: {
    type: [ResultadoVerificadoSchema],
    validate: {
      validator: (datos) => Array.isArray(datos) && datos.length >= 1 && datos.length <= 100,
      message: 'El informe debe incluir entre una y cien pruebas',
    },
    required: true,
  },
  hashContenidoConjunto: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  estadoRegistro: {
    type: String,
    enum: ['REGISTRADO', 'REVOCADO'],
    default: 'REGISTRADO',
    required: true,
  },
  fechaRegistro: { type: Date, default: Date.now, required: true },
  registradoPor: { type: String, required: true },
  usuarioRegistro: { type: String, default: null },
  fechaRevocacion: { type: Date, default: null },
  motivoRevocacion: { type: String, default: null, maxlength: 500 },
}, { timestamps: true });

// ====== Consulta de informes de una solicitud ======
InformeVerificacionLaboratorioSchema.index({ solicitudAtencionId: 1, fechaRegistro: -1 });

module.exports = mongoose.model('InformeVerificacionLaboratorio', InformeVerificacionLaboratorioSchema);
