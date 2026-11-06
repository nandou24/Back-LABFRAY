const mongoose = require('mongoose');
const { Schema } = mongoose;

// ====== Contactos y horarios propios de cada sede ======
const telefonoSchema = new Schema({
  numero: { type: String, required: true, trim: true, maxlength: 30 },
  descripcion: { type: String, required: true, trim: true, maxlength: 80 },
}, { _id: false });

const contactoSchema = new Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 150 },
  cargo: { type: String, trim: true, maxlength: 100, default: '' },
  tipo: { type: String, required: true, enum: ['PAGOS_FINANZAS', 'LABORATORIO', 'DIRECTOR', 'ADMINISTRADOR', 'OTROS'] },
  otro: { type: String, trim: true, maxlength: 100, default: '' },
  telefono: { type: String, trim: true, maxlength: 30, default: '' },
  correo: { type: String, trim: true, lowercase: true, maxlength: 180, default: '' },
  principal: { type: Boolean, default: false },
});

const turnoSchema = new Schema({
  inicio: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  fin: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
}, { _id: false });
const horarioSchema = new Schema({
  dia: { type: Number, min: 0, max: 6, required: true },
  atiende: { type: Boolean, default: false },
  turnos: { type: [turnoSchema], default: [] },
}, { _id: false });
const sedeSchema = new Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 150 },
  principal: { type: Boolean, default: false },
  departamento: { type: String, trim: true, maxlength: 100, default: '' },
  provincia: { type: String, trim: true, maxlength: 100, default: '' },
  distrito: { type: String, trim: true, maxlength: 100, default: '' },
  direccion: { type: String, trim: true, maxlength: 250, default: '' },
  coordenadasMaps: { type: String, trim: true, maxlength: 80, default: '' },
  telefono: { type: String, trim: true, maxlength: 30, default: '' },
  correo: { type: String, trim: true, lowercase: true, maxlength: 180, default: '' },
  telefonos: { type: [telefonoSchema], default: [] },
  contactos: { type: [contactoSchema], default: [] },
  horarios: { type: [horarioSchema], default: [] },
});

// ====== Convenio del maestro; no representa deuda ni atención ======
const convenioSchema = new Schema({
  enviaMuestras: { type: Boolean, default: true },
  derivaPacientes: { type: Boolean, default: false },
  periodicidad: { type: String, enum: ['SEMANAL', 'QUINCENAL', 'MENSUAL'], default: 'MENSUAL' },
  plazoCreditoDias: { type: Number, min: 0, max: 365, default: 30 },
  presentacionInforme: { type: String, enum: ['CON_MEMBRETE', 'SIN_MEMBRETE'], default: 'CON_MEMBRETE' },
  porcentajeComision: { type: Number, min: 0, max: 100, default: null },
  condicionComision: { type: String, enum: ['PAGO_COMPLETO'], default: 'PAGO_COMPLETO' },
  comisionesPorTipo: { type: [new Schema({ tipoServicio: { type: String, required: true, trim: true }, porcentaje: { type: Number, min: 0, max: 100, required: true } }, { _id: false })], default: [] },
}, { _id: false });

// ====== Únicamente los servicios habilitados; el resto no se ofrece ======
const servicioHabilitadoSchema = new Schema({
  servicioId: { type: Schema.Types.ObjectId, ref: 'servicioCollection', required: true },
  precioPersonalizado: { type: Number, min: 0, default: null },
}, { _id: false });

// ====== Servicios que generan comisión (separados del tarifario) ======
const servicioComisionableSchema = new Schema({
  servicioId: { type: Schema.Types.ObjectId, ref: 'servicioCollection', required: true },
  porcentajePersonalizado: { type: Number, min: 0, max: 100, default: null },
}, { _id: false });

const asociadoSchema = new Schema({
  tipoPersona: { type: String, enum: ['NATURAL', 'JURIDICA'], required: true },
  identificadorClave: { type: String, required: true, unique: true, immutable: true },
  // ====== Personas jurídicas utilizan RUC; no tienen tipoDocumento ======
  tipoDocumento: {
    type: String,
    default: null,
    required: function () { return this.tipoPersona === 'NATURAL'; },
    validate: {
      validator: valor => valor == null || ['DNI', 'CE', 'PASAPORTE'].includes(valor),
      message: 'Tipo de documento de persona natural inválido',
    },
  },
  numeroDocumento: { type: String, trim: true, uppercase: true, default: '' },
  ruc: { type: String, trim: true, default: '' },
  nombres: { type: String, trim: true, maxlength: 120, default: '' },
  apellidoPaterno: { type: String, trim: true, maxlength: 80, default: '' },
  apellidoMaterno: { type: String, trim: true, maxlength: 80, default: '' },
  razonSocial: { type: String, trim: true, maxlength: 200, default: '' },
  nombreComercial: { type: String, trim: true, maxlength: 180, default: '' },
  actividad: { type: String, trim: true, maxlength: 120, default: '' },
  profesionId: { type: Schema.Types.ObjectId, ref: 'profesionesCollection', default: null },
  especialidadId: { type: Schema.Types.ObjectId, ref: 'especialidadesCollection', default: null },
  sedes: { type: [sedeSchema], default: [] },
  convenio: { type: convenioSchema, required: true },
  serviciosHabilitados: { type: [servicioHabilitadoSchema], default: [] },
  serviciosComisionables: { type: [servicioComisionableSchema], default: [] },
  comprobantes: { type: [{ type: String, enum: ['RPH', 'BOLETA', 'FACTURA', 'NO_ESPECIFICA'] }], default: ['NO_ESPECIFICA'] },
  observaciones: { type: String, trim: true, maxlength: 3000, default: '' },
  activo: { type: Boolean, default: true },
  createdBy: { type: String, required: true },
  usuarioRegistro: { type: String, default: '' },
  updatedBy: { type: String, default: null },
  usuarioActualizacion: { type: String, default: '' },
}, { timestamps: true, optimisticConcurrency: true });

asociadoSchema.index({ razonSocial: 1 });
asociadoSchema.index({ apellidoPaterno: 1, nombres: 1 });

module.exports = mongoose.model('asociadoCollection', asociadoSchema);
