const mongoose = require('mongoose');
const { Schema } = mongoose;

const turnoSchema = new Schema({
  inicio: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  fin: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
}, { _id: false });

const horarioSchema = new Schema({
  dia: { type: Number, required: true, min: 0, max: 6 }, // 0 = lunes
  atiende: { type: Boolean, default: false },
  turnos: { type: [turnoSchema], default: [] },
}, { _id: false });

const personalSchema = new Schema({
  recursoHumanoId: { type: Schema.Types.ObjectId, ref: 'recursosHumanosCollection', required: true },
  profesionRef: { type: Schema.Types.ObjectId, ref: 'profesionesCollection', default: null },
  puesto: { type: String, required: true, trim: true, maxlength: 100 },
  esResponsable: { type: Boolean, default: false },
  fechaAsignacion: { type: Date, default: Date.now },
  activo: { type: Boolean, default: true },
});

const archivoPermisoSchema = new Schema({
  nombreArchivo: { type: String, required: true, trim: true, maxlength: 180 },
  mimeType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
  tamanioBytes: { type: Number, required: true, min: 1 },
  storageKey: { type: String, required: true, select: false },
  storageVersionId: { type: String, default: null, select: false },
  fechaSubida: { type: Date, default: Date.now },
  creadoPor: { type: String, required: true },
});

// ====== Versiones anteriores del permiso ======
const historialPermisoSchema = new Schema({
  versionNumero: { type: Number, required: true, min: 1 },
  numeroDocumento: { type: String, required: true, trim: true, maxlength: 100 },
  entidadEmisora: { type: String, required: true, trim: true, maxlength: 150 },
  fechaEmision: { type: Date, default: null },
  fechaVencimiento: { type: Date, default: null },
  observaciones: { type: String, trim: true, maxlength: 500 },
  archivos: { type: [archivoPermisoSchema], default: [] },
  fechaReemplazo: { type: Date, default: Date.now },
  motivoReemplazo: { type: String, default: '', trim: true, maxlength: 250 },
  reemplazadoPor: { type: String, default: '' },
});

// ====== Auditoría de edición de permisos vigentes ======
const datosPermisoAuditoriaSchema = new Schema({
  numeroDocumento: { type: String, default: '' },
  entidadEmisora: { type: String, default: '' },
  fechaEmision: { type: Date, default: null },
  fechaVencimiento: { type: Date, default: null },
  observaciones: { type: String, default: '' },
}, { _id: false });

const cambioPermisoSchema = new Schema({
  tipo: { type: String, required: true, enum: ['EDICION', 'RENOVACION', 'ARCHIVO_ADJUNTADO', 'ARCHIVO_RETIRADO'] },
  versionNumero: { type: Number, required: true, min: 1 },
  fechaCambio: { type: Date, default: Date.now },
  usuarioCambio: { type: String, default: '' },
  motivo: { type: String, default: '', maxlength: 250 },
  archivoNombre: { type: String, default: '' },
  anterior: { type: datosPermisoAuditoriaSchema, default: undefined },
  nuevo: { type: datosPermisoAuditoriaSchema, default: undefined },
}, { _id: false });

const permisoSchema = new Schema({
  tipoPermiso: { type: String, required: true, trim: true, maxlength: 100 },
  numeroDocumento: { type: String, required: true, trim: true, maxlength: 100 },
  entidadEmisora: { type: String, required: true, trim: true, maxlength: 150 },
  fechaEmision: { type: Date, default: null },
  fechaVencimiento: { type: Date, default: null },
  observaciones: { type: String, trim: true, maxlength: 500 },
  archivos: { type: [archivoPermisoSchema], default: [] },
  versionActual: { type: Number, default: 1, min: 1 },
  historial: { type: [historialPermisoSchema], default: [] },
  historialCambios: { type: [cambioPermisoSchema], default: [] },
});

const contactoHistorialSchema = new Schema({
  tipoRegistro: { type: String, enum: ['CREACION', 'ACTUALIZACION'], default: 'ACTUALIZACION' },
  telefono: { type: String, trim: true, maxlength: 30, default: '' },
  whatsapp: { type: String, trim: true, maxlength: 30, default: '' },
  correo: { type: String, trim: true, lowercase: true, maxlength: 180, default: '' },
  observaciones: { type: String, trim: true, maxlength: 800, default: '' },
  fechaCambio: { type: Date, default: Date.now },
  usuarioCambio: { type: String, default: '' },
}, { _id: false });

const sucursalSchema = new Schema({
  codigo: { type: String, unique: true, required: true, uppercase: true, trim: true, immutable: true },
  nombre: { type: String, required: true, trim: true, maxlength: 150 },
  nombreCorto: { type: String, trim: true, maxlength: 70 },
  estado: { type: String, enum: ['ACTIVA', 'INACTIVA'], default: 'ACTIVA' },
  esPrincipal: { type: Boolean, default: false },
  fechaApertura: { type: Date, default: null },
  departamento: { type: String, required: true, trim: true },
  provincia: { type: String, required: true, trim: true },
  distrito: { type: String, required: true, trim: true },
  direccion: { type: String, required: true, trim: true, maxlength: 250 },
  referencia: { type: String, trim: true, maxlength: 250 },
  coordenadasMaps: { type: String, trim: true, maxlength: 80 },
  googleMapsUrl: { type: String, trim: true, maxlength: 600 },
  telefono: { type: String, trim: true, maxlength: 30 },
  whatsapp: { type: String, trim: true, maxlength: 30 },
  correo: { type: String, trim: true, lowercase: true, maxlength: 180 },
  horarios: { type: [horarioSchema], default: [] },
  personal: { type: [personalSchema], default: [] },
  permisos: { type: [permisoSchema], default: [] },
  observaciones: { type: String, trim: true, maxlength: 800 },
  contactoHistorial: { type: [contactoHistorialSchema], default: [] },
  createdBy: { type: String, required: true },
  usuarioRegistro: { type: String },
  updatedBy: { type: String },
  usuarioActualizacion: { type: String },
}, { timestamps: true });

// ====== Sólo puede existir una sede principal ======
sucursalSchema.index({ esPrincipal: 1 }, {
  unique: true,
  partialFilterExpression: { esPrincipal: true },
  name: 'unica_sede_principal',
});
sucursalSchema.index({ estado: 1, nombre: 1 });

module.exports = mongoose.model('sucursalesCollection', sucursalSchema);
