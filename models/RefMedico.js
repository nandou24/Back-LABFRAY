const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const telefonoSchema = new mongoose.Schema({

    phoneNumber: {type: String, required: true},
    descriptionPhone: {type: String, required: true }
});

const profesionSolicitanteSchema = new mongoose.Schema({

    profesion: {type: String},
    nroColegiatura: {type: String}
});

const profesionesSchema = new mongoose.Schema({

    nivelProfesion: {type: String, required: true},
    titulo: {type: String},
    profesion: {type: String, required: true},
    nroColegiatura: {type: String},
    centroEstudiosProfesion: {type: String},
    anioEgresoProfesion: {type: String},
    profesionSolicitante: {type: String}

});

const especialidadesSchema = new mongoose.Schema({

    especialidad: {type: String,required: true},
    rne: {type: String,required: true},
    centroEstudiosEspecialidad: {type: String},
    anioEgresoEspecialidad: {type: String}
});


const RefMedicoSchema = Schema({
  
    codRefMedico: {type: String, required: true},
    tipoDoc: {type: String, required: true},
    nroDoc: {type: String, required: true},
    nombreRefMedico: {type: String, required: true,
        set: (value) => value.toUpperCase()
    },
    apePatRefMedico: {type: String, required: true,
        set: (value) => value.toUpperCase()
    },
    apeMatRefMedico: {type: String,
        set: (value) => value.toUpperCase()
    },
    fechaNacimiento: {type: Date, required: true},
    sexoRefMedico: {type: String, required: true},
    departamentoRefMedico: {type: String, required: true},
    provinciaRefMedico: {type: String, required: true},
    distritoRefMedico: {type: String, required: true},
    direcRefMedico: {type: String},
    mailRefMedico: {type: String},
    phones: [telefonoSchema],
    profesionesRefMedico: [profesionesSchema],
    profesionSolicitante: profesionSolicitanteSchema,
    especialidadesRefMedico: [especialidadesSchema],

}, 
{ 
    timestamps: true 
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('referenciaMedicoCollection', RefMedicoSchema);