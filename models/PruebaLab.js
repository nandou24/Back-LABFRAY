const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const PruebaLabSchema = Schema({
  
    codPruebaLab: {
        type: String,
        required: true
    },
    areaLab: {
        type: String,
        required: true
    },
    nombrePruebaLab: {
        type: String,
        required: true,
        set: (value) => value.toUpperCase()
    },
    condPreAnalitPaciente: {
        type: String,
        required: true
    },
    condPreAnalitRefer: {
        type: String,
        required: true
    },
    metodoPruebaLab: {
        type: String,
    },
    tipoMuestra: {
        type: [String],
        required: true
    },
    tipoTuboEnvase: {
        type: [String],
        required: true
    },
    tiempoEntrega: {
        type: String,
        required: true
    },
    precioPrueba: {
        type: String,
        required: true
    },
    observPruebas: {
        type: String
    },
    estadoPrueba: {
        type: String,
        required: true
    },
    compuestaPrueba: {
        type: String,
        required: true
    },
    tipoResultado: {
        type: String,
        required: true
    },
    valorRefCuali: {
        type: String
    },
    valorRefCuantiLimInf: {
        type: String
    },
    valorRefCuantiLimSup: {
        type: String
    },
    unidadesRef: {
        type: String
    },
    otrosValoresRef: {
        type: String
    }
}, 
{ 
    timestamps: true 
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('pruebasLabCollection', PruebaLabSchema);