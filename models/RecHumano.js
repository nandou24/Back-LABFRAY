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

const profesionSolicitanteSchema = new mongoose.Schema({

    profesion: {
        type: String
    },
    nroColegiatura: {
        type: String
    }
});

const profesionesSchema = new mongoose.Schema({

    nivelProfesion: {
        type: String,
        required: true
    },
    titulo: {
        type: String
    },
    profesion: {
        type: String,
        required: true
    },
    nroColegiatura: {
        type: String
    },
    universProcedenciaProfesion: {
        type: String
    },
    anioEgresoProfesion: {
        type: String
    },
    profesionSolicitante: {
        type: String
    }

});

const especialidadesSchema = new mongoose.Schema({

    especialidad: {
        type: String,
        required: true
    },
    rne: {
        type: String,
        required: true
    },
    universProcedenciaEspecialidad: {
        type: String
    },
    anioEgresoEspecialidad: {
        type: String
    }
});


const RecursoHumanoSchema = Schema({
  
    codRecHumano: {
        type: String,
        required: true
    },
    tipoDoc: {
        type: String,
        required: true
    },
    nroDoc: {
        type: String,
        required: true
    },
    nombreRecHumano: {
        type: String,
        required: true,
        set: (value) => value.toUpperCase()
    },
    apePatRecHumano: {
        type: String,
        required: true,
        set: (value) => value.toUpperCase()
    },
    apeMatRecHumano: {
        type: String,
        set: (value) => value.toUpperCase()
    },
    fechaNacimiento: {
        type: Date,
        required: true
    },
    sexoRecHumano: {
        type: String,
        required: true
    },
    departamentoRecHumano: {
        type: String,
        required: true
    },
    provinciaRecHumano: {
        type: String,
        required: true
    },
    distritoRecHumano: {
        type: String,
        required: true
    },
    direcRecHumano: {
        type: String
    },
    mailRecHumano: {
        type: String
    },
    phones: [telefonoSchema],
    gradoInstruccion: {
        type: String
    },
    profesionesRecurso: [profesionesSchema],
    profesionSolicitante: profesionSolicitanteSchema,
    especialidadesRecurso: [especialidadesSchema],
    esSolicitante: {
        type: Boolean
    },

}, 
{ 
    timestamps: true 
})

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model('recursosHumanosCollection', RecursoHumanoSchema);