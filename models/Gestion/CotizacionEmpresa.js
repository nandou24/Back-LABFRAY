const mongoose = require("mongoose");
const { Schema } = require("mongoose");

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
  nuevoPrecioVenta: { type: Number, required: true },
  totalUnitario: { type: Number, required: true },
});

const HistorialSchema = new Schema({
  version: { type: Number, required: true }, // 📌 Control de versiones
  fechaModificacion: { type: Date, default: Date.now }, // 📌 Fecha de la modificación
  empresaId: {
    type: Schema.Types.ObjectId,
    ref: "empresaCollection",
    required: true,
  },
  ruc: { type: String, required: true },
  razonSocial: { type: String, required: true },
  formaPago: { type: String, required: true },
  diasCredito: { type: Number },
  entregaResultados: { type: Number },
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
  // 🔍 Campos de auditoría:
  createdBy: { type: String, required: true }, // uid
  usuarioRegistro: { type: String }, // nombre de usuario
  fechaRegistro: { type: Date, default: Date.now },
});

const CotizacionEmpresaSchema = Schema(
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
        "PAGADA",
      ],
    },
    historial: [HistorialSchema],
  },

  {
    timestamps: true,
  }
);

module.exports = {
  CotizacionModel: mongoose.model(
    "cotizacionEmpresaCollection",
    CotizacionEmpresaSchema
  ),
  ServiciosSchema,
};
