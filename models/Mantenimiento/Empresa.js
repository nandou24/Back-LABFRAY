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
module.exports = mongoose.model("empresasCollection", EmpresaSchema);
