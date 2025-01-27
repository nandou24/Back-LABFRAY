const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const valoresSchema = new mongoose.Schema({

    descrValidacion: {
        type: String
    },
    sexo: {
        type: String
    },
    edadIndistinta: {
        type: String
    },
    edadMin: {
        type: String
    },
    edadMax: {
        type: String
    },
    descRegla: {
        type: String
    },
    valor1: {
        type: String
    },
    valor2: {
        type: String
    }

});


const ItemLabSchema = Schema({
  
    codItemLab: {
        type: String,
        required: true
    },
    nombreItemLab: {
        type: String,
        required: true
    },
    metodoItemLab: {
        type: String,
        required: true
    },
    plantillaValores: {
        type: String,
        required: true
    },
    unidadesRef: {
        type: String,
        required: true
    },
    poseeValidacion: {
        type: Boolean,
        required: true
    },
    observItem: {
        type: String
    },    

    paramValidacion: [valoresSchema]
}, 
{ 
    timestamps: true 
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('itemsLabCollection', ItemLabSchema);