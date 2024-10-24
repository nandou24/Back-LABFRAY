const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const telefonoSchema = new mongoose.Schema({

    phoneNumber: {
        type: String,
        required: true
    },
    descriptionPhone: {
        type: String,
        required: true 
    }
});


const PacienteSchema = Schema({
  
    tipoDoc: {
        type: String,
        required: true
    },
    nroDoc: {
        type: String,
        required: true
    },
    nombreCliente: {
        type: String,
        required: true
    },
    apePatCliente: {
        type: String,
        required: true
    },
    apeMatCliente: {
        type: String
    },
    fechaNacimiento: {
        type: Date,
        required: true
    },
    sexoCliente: {
        type: String,
        required: true
    },
    departamentoCliente: {
        type: String,
        required: true
    },
    provinciaCliente: {
        type: String,
        required: true
    },
    distritoCliente: {
        type: String,
        required: true
    },
    direcCliente: {
        type: String
    },
    mailCliente: {
        type: String
    },
    phones: [telefonoSchema]
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('pacientesCollection', PacienteSchema);