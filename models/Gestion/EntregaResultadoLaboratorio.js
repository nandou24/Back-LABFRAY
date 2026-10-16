const mongoose = require("mongoose");
const { Schema } = mongoose;

// ====== Historial inmutable de entregas ======
const EntregaResultadoLaboratorioSchema = new Schema(
  {
    solicitudAtencionId: {
      type: Schema.Types.ObjectId,
      ref: "SolicitudAtencion",
      required: true,
      index: true,
    },
    despachoResultadoId: {
      type: Schema.Types.ObjectId,
      ref: "despachoResultadoLaboratorioCollection",
      default: null,
      index: true,
    },
    codSolicitud: { type: String, required: true },
    codigoLaboratorio: { type: String, default: "" },
    tipoEntrega: {
      type: String,
      enum: ["PARCIAL", "FINAL"],
      required: true,
    },
    medio: {
      type: String,
      enum: ["PRESENCIAL", "WHATSAPP", "CORREO", "OTRO"],
      default: "PRESENCIAL",
    },
    receptorNombre: { type: String, default: "", trim: true },
    receptorCorreo: { type: String, default: null, trim: true, lowercase: true },
    receptorTelefono: { type: String, default: null, trim: true },
    observacion: { type: String, default: "", trim: true },
    resultados: { type: [Schema.Types.Mixed], required: true },
    totalPruebasActivas: { type: Number, required: true },
    entregadoPor: { type: String, required: true },
    usuarioEntrega: { type: String, required: true },
    fechaEntrega: { type: Date, default: Date.now, immutable: true },
  },
  { timestamps: true, versionKey: false },
);

EntregaResultadoLaboratorioSchema.index({ solicitudAtencionId: 1, fechaEntrega: -1 });
EntregaResultadoLaboratorioSchema.index(
  { despachoResultadoId: 1, solicitudAtencionId: 1 },
  {
    unique: true,
    partialFilterExpression: { despachoResultadoId: { $type: "objectId" } },
  },
);

module.exports = mongoose.model(
  "entregaResultadoLaboratorioCollection",
  EntregaResultadoLaboratorioSchema,
);
