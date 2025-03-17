const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const serviciosSchema = new mongoose.Schema({

    codServicio: {
        type: String,
        required: true
    },
    tipoServicio: {
        type: String
    },
    nombreServicio: {
        type: String
    },
    cantidad: {
        type: Number,
        required: true
    },
    precioLista: {
        type: Number,
        required: true
    },
    diferencia: {
        type: Number
    },
    precioVenta: {
        type: Number,
        required: true
    },
    descuentoPorcentaje: {
        type: Number,
        required: true
    },
    totalUnitario: {
        type: Number,
        required: true
    }

});


const CotizacionSchema = Schema({
  
    codCotizacion: {
        type: String,
        required: true
    },
    estadoRegistroPaciente: {
        type: Boolean,
        required: true
    },
    codCliente: {
        type: String,
        default: null
    },
    nomCliente: {
        type: String,
        default: null
    },
    tipoDoc: {
        type: String,
        default: null
    },
    nroDoc: {
        type: String,
        default: null
    },
    estadoRegistroSolicitante: {
        type: Boolean,
        required: true
    },
    codSolicitante: {
        type: String,
        default: null
    },
    nomSolicitante: {
        type: String,
        default: null
    },
    profesionSolicitante: {
        type: String,
        default: null
    },
    colegiatura: {
        type: String,
        default: null
    },
    especialidadSolicitante: {
        type: String,
        default: null
    },
    aplicarPrecioGlobal: {
        type: Boolean,
        required: true
    },
    aplicarDescuentoPorcentGlobal: {
        type: Boolean,
        required: true
    },
    sumaTotalesPrecioLista: {
        type: Number
    },
    listaMenosDescuento: {
        type: Number
    },
    precioConDescGlobal: {
        type: Number
    },
    descuentoPorcentaje: {
        type: Number
    },
    subTotal: {
        type: Number
    },
    igv: {
        type: Number
    },
    total: {
        type: Number
    },

    serviciosCotizacion: [serviciosSchema]

}, 
{ 
    timestamps: true 
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('cotizacionCollection', CotizacionSchema);