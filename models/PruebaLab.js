const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const valoresSchema = new mongoose.Schema({

    codItemLab: { type: String, required: true },
    nombreItemLab: { type: String, required: true },
    perteneceA: { type: String }

});


const PruebaLabSchema = Schema({
  
    codPruebaLab: { type: String, unique: true },
    areaLab: { type: String, required: true },
    nombrePruebaLab: { type: String, required: true, set: (value) => value.toUpperCase() },
    condPreAnalitPaciente: { type: String, required: true },
    condPreAnalitRefer: { type: String, required: true },
    tipoMuestra: { type: [String], required: true },
    tipoTuboEnvase: { type: [String], required: true },
    tiempoEntrega: { type: String, required: true },
    observPruebas: { type: String },
    estadoPrueba: { type: String, required: true },
    itemsComponentes: [valoresSchema]
}, 
{ 
    timestamps: true 
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('pruebasLabCollection', PruebaLabSchema);