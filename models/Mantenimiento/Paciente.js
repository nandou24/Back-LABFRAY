const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const telefonoSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  descriptionPhone: { type: String, required: true },
});

const PacienteSchema = Schema(
  {
    hc: { type: String, unique: true },
    estadoIdentificacion: {
      type: String,
      required: true,
      enum: ["PENDIENTE", "REGISTRADA"],
      default: "REGISTRADA",
    },
    tipoDoc: {
      type: String,
      required: function () {
        return this.estadoIdentificacion === "REGISTRADA";
      },
      default: null,
    },
    nroDoc: {
      type: String,
      required: function () {
        return this.estadoIdentificacion === "REGISTRADA";
      },
      default: null,
    },
    nombreCliente: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    apePatCliente: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    apeMatCliente: { type: String, set: (value) => value.toUpperCase() },
    fechaNacimiento: { type: Date, required: false },
    sexoCliente: { type: String, required: false },
    departamentoCliente: {
      type: String,
      required: function () {
        return this.estadoIdentificacion === "REGISTRADA";
      },
      default: null,
    },
    provinciaCliente: {
      type: String,
      required: function () {
        return this.estadoIdentificacion === "REGISTRADA";
      },
      default: null,
    },
    distritoCliente: {
      type: String,
      required: function () {
        return this.estadoIdentificacion === "REGISTRADA";
      },
      default: null,
    },
    direcCliente: { type: String },
    mailCliente: { type: String },
    phones: [telefonoSchema],
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
module.exports = mongoose.model("pacientesCollection", PacienteSchema);
