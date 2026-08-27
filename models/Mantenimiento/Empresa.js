const mongoose = require("mongoose");
const { Schema } = require("mongoose");

// Schema para persona de contacto
const personaContactoSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  cargo: { type: String, required: true },
  telefono: { type: String, required: true },
  email: { type: String },
  principal: { type: Boolean, default: false },
});

// Schema para ubicación de sede
const ubicacionSedeSchema = new mongoose.Schema({
  nombreSede: { type: String, required: true },
  direccionSede: { type: String },
  departamentoSede: { type: String, required: true },
  provinciaSede: { type: String, required: true },
  distritoSede: { type: String, required: true },
  referenciasSede: { type: String },
  coordenadasMaps: { type: String }, // URL de Google Maps o coordenadas lat,lng
  telefonoSede: { type: String },
  emailSede: { type: String },
  observacionesSede: { type: String },
});

const ServiciosSchema = new mongoose.Schema({
  servicioId: { type: Schema.Types.ObjectId, ref: "servicioCollection" },
  codServicio: { type: String, required: true },
  nombreServicio: { type: String },
  tipoServicio: { type: String },
});

// Schema para protocolos empresariales
const protocoloEmpresaSchema = new mongoose.Schema({
  codigoProtocolo: { type: String, required: true },
  nombreProtocolo: { type: String, required: true },
  tipo: {
    type: String,
    required: true,
    enum: ["manual", "conReferencia"],
  },
  estado: { type: Boolean, default: true },
  cotizacionReferencia: { type: String },
  observaciones: { type: String },
  fechaInicioVigencia: { type: Date, default: null },
  fechaFinVigencia: { type: Date, default: null },
  servicios: [ServiciosSchema],
});

const EmpresaSchema = Schema(
  {
    ruc: { type: String, required: true, unique: true },
    razonSocial: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    nombreComercial: {
      type: String,
      set: (value) => value.toUpperCase(),
    },
    direccionFiscal: { type: String },
    departamento: { type: String, required: true },
    provincia: { type: String, required: true },
    distrito: { type: String, required: true },
    cantidadTrabajadores: { type: Number, required: true },
    personasContacto: [personaContactoSchema], // Array de personas de contacto
    ubicacionesSedes: [ubicacionSedeSchema], // Array de sedes/ubicaciones
    email: { type: String },
    telefono: { type: String },
    tipoEmpresa: {
      type: String,
      required: true,
      enum: ["Privada", "Publica", "Mixta"],
    },
    sector: {
      type: String,
      required: true,
      enum: [
        "Salud",
        "Educacion",
        "Mineria",
        "Manufactura",
        "Construction",
        "Otros",
      ],
    },
    estado: { type: Boolean, default: true },
    observaciones: { type: String },
    protocolos: { type: [protocoloEmpresaSchema], default: [] },

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
  },
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("empresasCollection", EmpresaSchema);
