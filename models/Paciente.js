const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const telefonoSchema = new mongoose.Schema({

    phoneNumber: { type: String, required: true },
    descriptionPhone: { type: String, required: true }
});


const PacienteSchema = Schema({
  
    hc: { type: String, unique: true },
    tipoDoc: { type: String, required: true },
    nroDoc: { type: String, required: true },
    nombreCliente: { type: String, required: true, set: (value) => value.toUpperCase() },
    apePatCliente: { type: String, required: true, set: (value) => value.toUpperCase() },
    apeMatCliente: { type: String, set: (value) => value.toUpperCase() },
    fechaNacimiento: { type: Date, required: true },
    sexoCliente: { type: String, required: true },
    departamentoCliente: { type: String, required: true },
    provinciaCliente: { type: String, required: true },
    distritoCliente: { type: String, required: true },
    direcCliente: { type: String },
    mailCliente: { type: String },
    phones: [telefonoSchema]
}, 
{ 
    timestamps: true 
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('pacientesCollection', PacienteSchema);