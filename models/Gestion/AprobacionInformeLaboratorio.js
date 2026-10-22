const mongoose = require("mongoose");
const { Schema } = mongoose;

const ResultadoAprobadoSchema = new Schema(
  {
    resultadoLaboratorioId: { type: Schema.Types.ObjectId, required: true },
    versionResultado: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const FirmanteSnapshotSchema = new Schema(
  {
    recursoHumanoId: { type: Schema.Types.ObjectId, required: true },
    codRecHumano: { type: String, required: true },
    nombreCompleto: { type: String, required: true },
    profesionRecursoId: { type: Schema.Types.ObjectId, required: true },
    profesion: { type: String, required: true },
    nroColegiatura: { type: String, required: true },
    especialidad: { type: String, default: null },
    rne: { type: String, default: null },
  },
  { _id: false },
);

const AprobacionInformeLaboratorioSchema = new Schema(
  {
    solicitudAtencionId: {
      type: Schema.Types.ObjectId,
      ref: "SolicitudAtencion",
      required: true,
      index: true,
    },
    codSolicitud: { type: String, required: true },
    codigoLaboratorio: { type: String, default: "" },
    claveSeleccion: { type: String, required: true },
    resultados: { type: [ResultadoAprobadoSchema], required: true },
    firmante: { type: FirmanteSnapshotSchema, required: true },
    aprobadoPor: { type: String, required: true },
    usuarioAprobacion: { type: String, required: true },
    fechaAprobacion: { type: Date, required: true, default: Date.now },
    solicitadoPor: { type: String, required: true },
    usuarioSolicitud: { type: String, default: null },
  },
  { timestamps: true },
);

// ====== Una sola aprobación por conjunto de resultados y versiones ======
AprobacionInformeLaboratorioSchema.index(
  { solicitudAtencionId: 1, claveSeleccion: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "AprobacionInformeLaboratorio",
  AprobacionInformeLaboratorioSchema,
);
