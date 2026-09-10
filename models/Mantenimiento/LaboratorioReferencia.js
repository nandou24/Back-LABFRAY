const { Schema, model } = require("mongoose");

// ====== Contactos ======

const ContactoLaboratorioReferenciaSchema = new Schema(
  {
    tipoContacto: {
      type: String,
      enum: [
        "CENTRAL_PROGRAMACION",
        "AREA_LABORATORIO",
        "SECTORISTA",
        "FACTURACION",
        "OTRO",
      ],
      required: true,
    },

    nombreContacto: {
      type: String,
      default: "",
      trim: true,
    },

    cargo: {
      type: String,
      default: "",
      trim: true,
    },

    telefono: {
      type: String,
      default: "",
      trim: true,
    },

    correo: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    principal: {
      type: Boolean,
      default: false,
    },

    observacion: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: true,
  },
);

// ====== Laboratorio de referencia ======

const LaboratorioReferenciaSchema = new Schema(
  {
    codLaboratorioReferencia: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    nombreLaboratorio: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    razonSocial: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    ruc: {
      type: String,
      default: "",
      trim: true,
    },

    // Código que el laboratorio de referencia asigna a LABFRAY.
    codigoCliente: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    direccion: {
      type: String,
      default: "",
      trim: true,
    },

    contactos: {
      type: [ContactoLaboratorioReferenciaSchema],
      default: [],
    },

    observacion: {
      type: String,
      default: "",
      trim: true,
    },

    estadoLaboratorioReferencia: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
      required: true,
    },

    // ====== Auditoría ======

    createdBy: {
      type: String,
      default: null,
    },

    usuarioRegistro: {
      type: String,
      default: null,
    },

    fechaRegistro: {
      type: Date,
      default: Date.now,
    },

    updatedBy: {
      type: String,
      default: null,
    },

    usuarioActualizacion: {
      type: String,
      default: null,
    },

    fechaActualizacion: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = model(
  "laboratorioReferenciaCollection",
  LaboratorioReferenciaSchema,
);
