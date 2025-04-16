const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const DetallePagoSchema = new Schema({
    medioPago: String,
    monto: Number,
    montoConRecargo: Number,
    numOperacion: String,
    fechaPago: Date,
    banco: String,
    esAntiguo: Boolean
})

const ServiciosSchema = new mongoose.Schema({

    codServicio: { type: String, required: true },
    tipoServicio: { type: String },
    nombreServicio: { type: String },
    cantidad: { type: Number, required: true },
    precioLista: { type: Number, required: true },
    diferencia: { type: Number },
    precioVenta: { type: Number, required: true },
    descuentoPorcentaje: { type: Number, required: true },
    totalUnitario: { type: Number, required: true }

});

const PagoSchema = new Schema({
    codPago: { type: String, unique: true },
    codCotizacion: String,
    version: String,
    codCliente: String,
    nomCliente: String,
    tipoDoc: String,
    nroDoc: String,
    codSolicitante: String,
    nomSolicitante: String,
    profesionSolicitante: String,
    colegiatura: String,
    sumaTotalesPrecioLista: Number,
    descuentoTotal: Number,
    subTotal: Number,
    igv: Number,
    total: Number,
    serviciosCotizacion: [ServiciosSchema],
    detallePagos: [DetallePagoSchema],
    faltaPagar: Number,
    subTotalFacturar: Number,
    igvFacturar: Number,
    totalFacturar: Number,
    estadoPago: String,
    estadoCotizacion: String,
    tienePagosAnteriores: Boolean,
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('pagoCollection', PagoSchema);