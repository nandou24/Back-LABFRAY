const mongoose = require('mongoose');
const { Schema } = mongoose;

// ====== Identidad clínica conservada en la remisión logística ======
const pruebaSchema = new Schema({
  codPruebaLab: { type: String, required: true, trim: true },
  nombrePruebaLab: { type: String, required: true, trim: true },
}, { _id: false });

const lineaSchema = new Schema({
  muestraLaboratorioId: { type: Schema.Types.ObjectId, ref: 'MuestraLaboratorio', required: true },
  solicitudAtencionId: { type: Schema.Types.ObjectId, ref: 'SolicitudAtencion', required: true },
  codSolicitud: { type: String, required: true, trim: true },
  codigoLaboratorio: { type: String, trim: true, default: '' },
  codigoEtiqueta: { type: String, required: true, trim: true },
  pacienteNombre: { type: String, required: true, trim: true },
  pacienteDocumento: { type: String, trim: true, default: '' },
  pruebas: { type: [pruebaSchema], default: [] },
  tipoMuestraId: { type: Schema.Types.ObjectId, ref: 'tipoMuestraCollection', default: null },
  tipoMuestraNombre: { type: String, trim: true, default: '' },
  tuboEnvaseId: { type: Schema.Types.ObjectId, ref: 'tuboEnvaseCollection', default: null },
  tuboEnvaseNombre: { type: String, trim: true, default: '' },
  cantidadDeclarada: { type: Number, required: true, min: 1, max: 1, default: 1 },
  cantidadRecibida: { type: Number, min: 0, max: 1, default: null },
});

// ====== Pacientes declarados para una contingencia sin solicitud clínica ======
const pacienteAdministrativoSchema = new Schema({
  clave: { type: String, required: true, trim: true },
  pacienteId: { type: Schema.Types.ObjectId, ref: 'pacientesCollection', default: null },
  hc: { type: String, trim: true, default: '' },
  nombre: { type: String, required: true, trim: true },
  apePat: { type: String, trim: true, default: '' },
  apeMat: { type: String, trim: true, default: '' },
  nombres: { type: String, trim: true, default: '' },
  tipoDoc: { type: String, trim: true, default: '' },
  nroDoc: { type: String, trim: true, default: '' },
  telefono: { type: String, trim: true, default: '' },
  documento: { type: String, trim: true, default: '' },
  sexo: { type: String, trim: true, default: '' },
  fechaNacimiento: { type: Date, default: null },
  edadDeclarada: { type: Number, default: null, min: 0 },
  unidadEdad: { type: String, enum: ['ANIOS', 'MESES', 'DIAS'], default: 'ANIOS' },
  pruebas: { type: [pruebaSchema], default: [] },
}, { _id: false });

// ====== Recipientes administrativos: nunca son MuestraLaboratorio ======
const recipienteAdministrativoSchema = new Schema({
  clavePaciente: { type: String, required: true, trim: true },
  tuboEnvaseId: { type: Schema.Types.ObjectId, ref: 'tuboEnvaseCollection', required: true },
  tuboEnvaseNombre: { type: String, required: true, trim: true },
  color: { type: String, trim: true, default: '' },
  // ====== Dato declarado opcional; Central no clasifica la muestra ======
  tipoMuestraId: { type: Schema.Types.ObjectId, ref: 'tipoMuestraCollection', default: null },
  tipoMuestraNombre: { type: String, trim: true, default: '' },
  cantidadDeclarada: { type: Number, required: true, min: 1, max: 100 },
  cantidadRecibida: { type: Number, default: null, min: 0, max: 100 },
  codigoEtiqueta: { type: String, trim: true, default: '', maxlength: 100 },
  fechaToma: { type: Date, default: null },
});

const remisionSchema = new Schema({
  origenTipo: { type: String, enum: ['ASOCIADO', 'SUCURSAL_PROPIA'], required: true },
  asociadoId: { type: Schema.Types.ObjectId, ref: 'asociadoCollection', default: null },
  sucursalId: { type: Schema.Types.ObjectId, ref: 'sucursalesCollection', default: null },
  sucursalRemitenteNombre: { type: String, trim: true, default: '' },
  origenNombre: { type: String, required: true, trim: true },
  origenCodigo: { type: String, trim: true, default: '' },
  referenciaRemision: { type: String, trim: true, default: '', maxlength: 120 },
  lineas: { type: [lineaSchema], default: [] },
  pacientesAdministrativos: { type: [pacienteAdministrativoSchema], default: [] },
  recipientesAdministrativos: { type: [recipienteAdministrativoSchema], default: [] },
});

const lecturaPreviaSchema = new Schema({
  etapa: { type: String, enum: ['DESPACHO_ASOCIADO', 'RECEPCION_SUCURSAL', 'DESPACHO_SUCURSAL'], required: true },
  temperaturaC: { type: Number, default: null },
  motivoSinLectura: { type: String, trim: true, default: '' },
  fechaHora: { type: Date, default: null },
  responsable: { type: String, trim: true, default: '' },
}, { _id: false });

const recepcionCentralSchema = new Schema({
  // ====== Fecha declarada y fecha real de persistencia ======
  fechaHora: { type: Date, required: true },
  fechaRegistroSistema: { type: Date, default: null },
  recibidoPor: { type: String, required: true },
  usuarioRecepcion: { type: String, required: true },
  nombreResponsableRecepcion: { type: String, trim: true, default: '' },
  temperaturaC: { type: Number, default: null },
  motivoSinLectura: { type: String, trim: true, default: '' },
  incidencia: { type: String, trim: true, default: '' },
  totalDeclarado: { type: Number, required: true },
  totalRecibido: { type: Number, required: true },
}, { _id: false });

const recepcionMuestrasSchema = new Schema({
  // ====== Registro administrativo del despacho físico ======
  codigoEnvio: { type: String, unique: true, required: true, uppercase: true, immutable: true, trim: true },
  modoRegistro: { type: String, enum: ['CONTINGENCIA_CENTRAL', 'DESPACHO_REGISTRADO'], required: true },
  origenDespacho: { type: String, enum: ['ASOCIADO', 'SUCURSAL'], required: true },
  origenNombre: { type: String, trim: true, required: true },
  origenCodigo: { type: String, trim: true, default: '' },
  rutaIngreso: { type: String, enum: ['DIRECTO', 'SUCURSAL'], default: 'DIRECTO' },
  prioridad: { type: String, enum: ['NORMAL', 'URGENTE'], default: 'NORMAL' },
  sedeOrigen: { type: String, trim: true, default: '' },
  observacionRemision: { type: String, trim: true, default: '', maxlength: 2000 },
  estado: {
    type: String,
    enum: ['REGISTRADA_CENTRAL', 'PENDIENTE_RECEPCION', 'DESPACHADO', 'RECIBIDO_COMPLETO', 'RECIBIDO_CON_DIFERENCIAS'],
    default: 'PENDIENTE_RECEPCION',
    index: true,
    required: true,
  },
  remisiones: { type: [remisionSchema], required: true },
  lecturasPrevias: { type: [lecturaPreviaSchema], default: [] },
  recepcionCentral: { type: recepcionCentralSchema, default: null },
  registradoPor: { type: String, required: true },
  usuarioRegistro: { type: String, required: true },
  actualizadoPor: { type: String, default: '' },
}, { timestamps: true, optimisticConcurrency: true });

// ====== Las remisiones declarativas no restringen pacientes ni recipientes entre envíos ======
// ====== El índice único antiguo debe revisarse en MongoDB; quitarlo del esquema no lo borra ======
recepcionMuestrasSchema.index({ estado: 1, createdAt: -1 });

module.exports = mongoose.model('RecepcionMuestras', recepcionMuestrasSchema);
