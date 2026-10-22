const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const telefonoSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  descriptionPhone: { type: String, required: true },
});

const PacienteSchema = Schema(
  {
    hc: { type: String, unique: true },
    // ====== Clasificación de HC: sin asignar estados a registros históricos ======
    tipoHC: { type: String, enum: ['PRINCIPAL', 'PROVISIONAL'], default: undefined },
    estadoConciliacion: {
      type: String,
      enum: ['NO_APLICA', 'SIN_CONCILIAR', 'EN_REVISION', 'CONCILIADA'],
      default: undefined,
    },
    pacientePrincipalId: { type: Schema.Types.ObjectId, ref: 'pacientesCollection', default: null },
    revisionConciliacion: { type: Number, default: 0, min: 0 },
    origenCreacionHC: {
      type: String,
      enum: ['MAESTRO', 'EMPRESA_SIN_DOCUMENTO', 'EMPRESA_CON_DOCUMENTO'],
      default: undefined,
    },
    // ====== Registro del control manual cuando coinciden nombres ======
    revisionCreacionProvisional: {
      motivo: { type: String, trim: true },
      candidatosId: [{ type: Schema.Types.ObjectId, ref: 'pacientesCollection' }],
      uid: String,
      nombreUsuario: String,
      fecha: Date,
    },
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
    // ====== Historial de correcciones de documento ======
    historialDocumentos: [{
      tipoDoc: { type: String, default: null },
      nroDoc: { type: String, default: null },
      tipoDocNuevo: { type: String, required: true },
      nroDocNuevo: { type: String, required: true },
      motivo: { type: String, required: true, trim: true },
      fecha: { type: Date, required: true },
      uid: { type: String, required: true },
      nombreUsuario: { type: String, default: null },
      tipoOperacion: { type: String, enum: ['REGULARIZACION', 'CORRECCION_AUTORIZADA'], default: 'REGULARIZACION' },
      cambios: [{
        campo: { type: String, required: true },
        valorAnterior: { type: String, default: null },
        valorNuevo: { type: String, default: null },
      }],
      autorizadoPor: { type: String, default: null },
      usuarioAutorizacion: { type: String, default: null },
      rolAutorizacion: { type: String, default: null },
    }],
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
