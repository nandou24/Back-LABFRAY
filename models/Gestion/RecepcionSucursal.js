const mongoose = require('mongoose');
const { Schema } = mongoose;

// ====== Cada paciente representa una atención administrativa independiente ======
const pruebaSchema = new Schema({
  pruebaLabId: { type: Schema.Types.ObjectId, ref: 'pruebasLabCollection', required: true },
  codPruebaLab: { type: String, required: true, trim: true },
  nombrePruebaLab: { type: String, required: true, trim: true },
  areaLab: { type: String, default: '', trim: true },
}, { _id: false });

const pacienteSchema = new Schema({
  clave: { type: String, required: true, trim: true },
  pacienteId: { type: Schema.Types.ObjectId, ref: 'pacientesCollection', default: null },
  hc: { type: String, default: '', trim: true },
  nombre: { type: String, required: true, trim: true },
  apePat: { type: String, required: true, trim: true },
  apeMat: { type: String, default: '', trim: true },
  nombres: { type: String, required: true, trim: true },
  tipoDoc: { type: String, default: '', trim: true },
  nroDoc: { type: String, default: '', trim: true },
  sexo: { type: String, default: '', trim: true },
  fechaNacimiento: { type: Date, default: null },
  edadDeclarada: { type: Number, default: null, min: 0 },
  unidadEdad: { type: String, enum: ['ANIOS', 'MESES', 'DIAS'], default: 'ANIOS' },
  telefono: { type: String, default: '', trim: true },
  pruebas: { type: [pruebaSchema], default: [] },
}, { _id: false });

// ====== Un grupo identifica recipientes declarados, no muestras clínicas ======
const recipienteSchema = new Schema({
  clavePaciente: { type: String, required: true, trim: true },
  tuboEnvaseId: { type: Schema.Types.ObjectId, ref: 'tuboEnvaseCollection', required: true },
  tuboEnvaseCodigo: { type: String, required: true, trim: true },
  tuboEnvaseNombre: { type: String, required: true, trim: true },
  color: { type: String, default: '', trim: true },
  cantidadDeclarada: { type: Number, required: true, min: 1, max: 100 },
  codigoEtiqueta: { type: String, default: '', trim: true, maxlength: 100 },
  fechaToma: { type: Date, default: null },
});

const temperaturaSchema = new Schema({
  temperaturaC: { type: Number, default: null },
  motivoSinLectura: { type: String, default: '', trim: true, maxlength: 500 },
  fechaHora: { type: Date, required: true },
  fechaRegistroSistema: { type: Date, required: true },
  responsableId: { type: String, required: true },
  usuarioResponsable: { type: String, required: true },
  nombreResponsable: { type: String, required: true },
  observacion: { type: String, default: '', trim: true, maxlength: 2000 },
}, { _id: false });

const cambioSchema = new Schema({
  campo: { type: String, required: true, maxlength: 200 },
  anterior: { type: Schema.Types.Mixed, default: null },
  nuevo: { type: Schema.Types.Mixed, default: null },
}, { _id: false });

const eventoSchema = new Schema({
  accion: { type: String, enum: ['CREACION', 'EDICION'], required: true },
  fechaHora: { type: Date, required: true },
  usuarioId: { type: String, required: true },
  nombreUsuario: { type: String, required: true },
  nombreCompleto: { type: String, required: true },
  motivo: { type: String, default: '', maxlength: 500 },
  versionAnterior: { type: Number, default: null },
  versionNueva: { type: Number, required: true },
  cambios: { type: [cambioSchema], default: [] },
});

const recepcionSucursalSchema = new Schema({
  codigoRecepcion: { type: String, required: true, unique: true, immutable: true, uppercase: true, trim: true },
  sucursalReceptoraId: { type: Schema.Types.ObjectId, ref: 'sucursalesCollection', required: true, immutable: true },
  sucursalReceptoraCodigo: { type: String, required: true },
  sucursalReceptoraNombre: { type: String, required: true },
  origenTipo: { type: String, enum: ['ASOCIADO'], default: 'ASOCIADO', required: true },
  asociadoId: { type: Schema.Types.ObjectId, ref: 'asociadoCollection', required: true },
  asociadoCodigo: { type: String, required: true },
  asociadoNombre: { type: String, required: true },
  sedeAsociadoId: { type: Schema.Types.ObjectId, required: true },
  sedeAsociadoNombre: { type: String, required: true },
  prioridad: { type: String, enum: ['NORMAL', 'URGENTE'], default: 'NORMAL' },
  referenciaRemision: { type: String, default: '', trim: true, maxlength: 120 },
  observacionRemision: { type: String, default: '', trim: true, maxlength: 2000 },
  estado: { type: String, enum: ['DISPONIBLE_PARA_ENVIO', 'EN_PREPARACION', 'DESPACHADO', 'RECIBIDO_COMPLETO', 'RECIBIDO_CON_DIFERENCIAS'], default: 'DISPONIBLE_PARA_ENVIO', index: true },
  pacientes: { type: [pacienteSchema], default: [] },
  recipientes: { type: [recipienteSchema], default: [] },
  recepcionSucursal: { type: temperaturaSchema, required: true },
  registradoPor: { type: String, required: true },
  usuarioRegistro: { type: String, required: true },
  actualizadoPor: { type: String, default: '' },
  historialCambios: { type: [eventoSchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true });

// ====== Los índices no deben impedir atenciones legítimas repetidas ======
recepcionSucursalSchema.index({ sucursalReceptoraId: 1, createdAt: -1 });
recepcionSucursalSchema.index({ sucursalReceptoraId: 1, estado: 1, createdAt: -1 });

module.exports = mongoose.models.RecepcionSucursal ||
  mongoose.model('RecepcionSucursal', recepcionSucursalSchema, 'recepcionessucursales');
