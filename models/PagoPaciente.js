const mongoose = require("mongoose");
const { Schema } = require("mongoose");
const ServiciosSchema = require("./CotizacionPaciente").ServiciosSchema;

const DetallePagoSchema = new Schema({
  fechaPago: { type: Date },
  medioPago: { type: String },
  monto: { type: Number },
  recargo: { type: Number },
  numOperacion: { type: String },
  bancoDestino: { type: String },
  esAntiguo: { type: Boolean },
});

// const ServiciosSchema = new mongoose.Schema({
//   codServicio: { type: String, required: true },
//   tipoServicio: { type: String },
//   nombreServicio: { type: String },
//   cantidad: { type: Number, required: true },
//   precioLista: { type: Number, required: true },
//   diferencia: { type: Number },
//   precioVenta: { type: Number, required: true },
//   descuentoPorcentaje: { type: Number, required: true },
//   totalUnitario: { type: Number, required: true },
//   profesionesAsociadas: [profAsociadasSchema],
//   medicoAtiende: {
//     medicoId: {
//       type: Schema.Types.ObjectId,
//       ref: "recursosHumanosCollection",
//       required: false,
//       default: null,
//     },
//     codRecHumano: { type: String },
//     nombreRecHumano: { type: String },
//     apePatRecHumano: { type: String },
//     apeMatRecHumano: { type: String },
//     nroColegiatura: { type: String },
//     rne: { type: String },
//   },
// });

const PagoSchema = new Schema(
  {
    codPago: { type: String, unique: true },
    cotizacionId: {
      type: Schema.Types.ObjectId,
      ref: "cotizacionCollection",
      required: true,
    },
    codCotizacion: { type: String },
    fechaCotizacion: { type: Date },
    version: { type: String },
    hc: { type: String },
    tipoDoc: { type: String },
    nroDoc: { type: String },
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
    sumaTotalesPrecioLista: { type: Number },
    descuentoTotal: { type: Number },
    subTotal: { type: Number },
    igv: { type: Number },
    total: { type: Number },
    serviciosCotizacion: [ServiciosSchema],
    detallePagos: [DetallePagoSchema],
    faltaPagar: { type: Number },
    subTotalFacturar: { type: Number },
    igvFacturar: { type: Number },
    totalFacturar: { type: Number },
    estadoPago: {
      type: String,
      enum: ["PAGO PARCIAL", "PAGO TOTAL", "ANULADO", "OBSERVADO", "FACTURADO"],
    },
    estadoCotizacion: {
      type: String,
      required: true,
      enum: [
        "GENERADA",
        "MODIFICADA",
        "PAGO PARCIAL",
        "PAGO TOTAL",
        "PAGO ANUALDO",
        "ANULADO",
        "FACTURADO",
      ],
    },
    tienePagosAnteriores: { type: Boolean },
    anulacion: {
      motivo: { type: String },
      observacion: { type: String },
      fecha: { type: Date },
    },
  },
  { timestamps: true }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model("pagoCollection", PagoSchema);
