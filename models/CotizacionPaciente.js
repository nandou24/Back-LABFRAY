const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const profAsociadasSchema = new mongoose.Schema({
  profesionId: { type: Schema.Types.ObjectId, ref: "profesionCollection" },
  especialidadId: {
    type: Schema.Types.ObjectId,
    ref: "especialidadCollection",
    required: false,
    default: null,
  },
});

const ServiciosSchema = new mongoose.Schema({
  servicioId: { type: Schema.Types.ObjectId, ref: "servicioCollection" },
  codServicio: { type: String, required: true },
  tipoServicio: { type: String },
  nombreServicio: { type: String },
  cantidad: { type: Number, required: true },
  precioLista: { type: Number, required: true },
  diferencia: { type: Number },
  precioVenta: { type: Number, required: true },
  descuentoPorcentaje: { type: Number, required: true },
  totalUnitario: { type: Number, required: true },
  profesionesAsociadas: [profAsociadasSchema],
  medicoAtiende: {
    medicoId: {
      type: Schema.Types.ObjectId,
      ref: "recursosHumanosCollection",
      required: false,
      default: null,
    },
    codRecHumano: { type: String },
    nombreRecHumano: { type: String },
    apePatRecHumano: { type: String },
    apeMatRecHumano: { type: String },
    nroColegiatura: { type: String },
    rne: { type: String },
  },
});

const HistorialSchema = new Schema({
  version: { type: Number, required: true }, // 📌 Control de versiones
  fechaModificacion: { type: Date, default: Date.now }, // 📌 Fecha de la modificación
  estadoRegistroPaciente: { type: Boolean, required: true },
  hc: { type: String }, // Historia clínica del paciente

  tipoDoc: { type: String, required: true },
  nroDoc: { type: String, required: true },
  clienteId: {
    type: Schema.Types.ObjectId,
    ref: "pacienteCollection",
    required: true,
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
  estadoRegistroSolicitante: { type: Boolean, required: true },
  codSolicitante: { type: String },
  solicitanteId: {
    type: Schema.Types.ObjectId,
    ref: "referenciaMedicoCollection",
    required: false,
  },
  nombreRefMedico: { type: String },
  apePatRefMedico: { type: String },
  apeMatRefMedico: { type: String },
  profesionSolicitante: { type: String },
  colegiatura: { type: String },
  especialidadSolicitante: { type: String },
  aplicarPrecioGlobal: { type: Boolean, required: true },
  aplicarDescuentoPorcentGlobal: { type: Boolean, required: true },
  sumaTotalesPrecioLista: { type: Number },
  descuentoTotal: { type: Number },
  precioConDescGlobal: { type: Number },
  descuentoPorcentaje: { type: Number },
  subTotal: { type: Number },
  igv: { type: Number },
  total: { type: Number },
  serviciosCotizacion: [ServiciosSchema],
});

const CotizacionSchema = Schema(
  {
    codCotizacion: { type: String, required: true },
    estadoCotizacion: {
      type: String,
      required: true,
      enum: [
        "GENERADA",
        "MODIFICADA",
        "PAGO PARCIAL",
        "PAGO TOTAL",
        "PAGO ANULADO",
        "ANULADO",
        "FACTURADO",
      ],
    },
    historial: [HistorialSchema],
  },

  {
    timestamps: true,
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
// module.exports = mongoose.model("cotizacionCollection", CotizacionSchema);
// module.exports = mongoose.model("profAsociadasSchema", profAsociadasSchema);
// module.exports = mongoose.model("serviciosSchema", ServiciosSchema);

module.exports = {
  CotizacionModel: mongoose.model("cotizacionCollection", CotizacionSchema),
  profAsociadasSchema,
  ServiciosSchema,
};
