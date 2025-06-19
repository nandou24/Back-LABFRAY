const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const DetallePagoSchema = new Schema({
    fechaPago: {type: Date},
    medioPago: { type: String },
    monto: {type: Number},
    recargo: {type: Number},
    numOperacion: { type: String },
    bancoDestino: { type: String },
    esAntiguo: {type: Boolean}
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
    codCotizacion: { type: String },
    version: { type: String },
    codCliente: { type: String },
    nomCliente: { type: String },
    tipoDoc: { type: String },
    nroDoc: { type: String },
    codSolicitante: { type: String },
    nomSolicitante: { type: String },
    profesionSolicitante: { type: String },
    colegiatura: { type: String },
    sumaTotalesPrecioLista: {type: Number},
    descuentoTotal: {type: Number},
    subTotal: {type: Number},
    igv: {type: Number},
    total: {type: Number},
    serviciosCotizacion: [ServiciosSchema],
    detallePagos: [DetallePagoSchema],
    faltaPagar: {type: Number},
    subTotalFacturar: {type: Number},
    igvFacturar: {type: Number},
    totalFacturar: {type: Number},
    estadoPago: {type: String, enum: ['PAGO PARCIAL', 'PAGO TOTAL', 'ANULADO', 'OBSERVADO', 'FACTURADO']},
    estadoCotizacion: {type: String, required: true, enum: ['GENERADO', 'MODIFICADO', 'PAGO PARCIAL', 'PAGO TOTAL', 'PAGO ANUALDO', 'ANULADO', 'FACTURADO']},
    tienePagosAnteriores: {type: Boolean},
    anulacion: {
        motivo: { type: String },
        observacion: { type: String },
        fecha: {type: Date}
    },
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('pagoCollection', PagoSchema);