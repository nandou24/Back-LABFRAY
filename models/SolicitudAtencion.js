const mongoose = require("mongoose");

// Define the ServicioSolicitud subdocument schema
const ServicioSolicitudSchema = new mongoose.Schema({
  codigoServicio: { type: String, required: true, trim: true },
  nombreServicio: { type: String, required: true, trim: true },
  estado: {
    type: String,
    required: true,
    enum: ["PENDIENTE", "EN PROCESO", "TERMINADO"],
    trim: true,
  },
});

const SolicitudAtencionSchema = new mongoose.Schema(
  {
    codigoSolicitud: { type: String, required: true, unique: true, trim: true },
    codigoPago: { type: String, default: null, trim: true },
    cotizacionId: { type: String, required: true, index: true },
    tipo: {
      type: String,
      required: true,
      enum: [
        "Laboratorio",
        "Ecografía",
        "Consulta Médica",
        "Procedimiento",
        "Otro",
      ],
      trim: true,
    },
    servicios: { type: [ServicioSolicitudSchema], required: true },
    tipoDocumento: {
      type: String,
      required: true,
      enum: ["DNI", "CE", "Pasaporte"],
      trim: true,
    },
    nroDocumento: { type: String, required: true, trim: true },
    pacienteNombre: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
      trim: true,
    },
    fechaEmision: { type: Date, required: true },
    //codUsuarioEmisor: { type: String, required: true },
    usuarioEmisor: { type: String, required: true },
    estado: {
      type: String,
      required: true,
      enum: ["GENERADO", "EN PROCESO", "ATENDIDO", "ANULADO"],
      default: "GENERADO",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("SolicitudAtencion", SolicitudAtencionSchema);
