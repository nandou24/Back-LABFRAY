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

module.exports = mongoose.model(
  "entregaResultadoLaboratorioCollection",
  EntregaResultadoLaboratorioSchema,
);
