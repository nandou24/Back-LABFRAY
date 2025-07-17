const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const telefonoSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  descriptionPhone: { type: String, required: true },
});

const especialidadesSchema = new mongoose.Schema({
  especialidadRef: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "especialidadesCollection", // Referencia a la colección de profesiones
  },
  //nombreEspecialidad: { type: String, required: true },
  rne: { type: String, required: true },
  centroEstudiosEspecialidad: { type: String },
  anioEgresoEspecialidad: { type: String },
});

const profesionesSchema = new mongoose.Schema({
  profesionRef: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "profesionesCollection", // Referencia a la colección de profesiones
  },
  nivelProfesion: { type: String, required: true },
  titulo: { type: Boolean, default: false },
  //profesion: { type: String, required: true },
  nroColegiatura: { type: String },
  centroEstudiosProfesion: { type: String },
  anioEgresoProfesion: { type: String },
  profesionSolicitante: { type: Boolean, default: false },
  especialidades: [especialidadesSchema],
});

const RecursoHumanoSchema = Schema(
  {
    codRecHumano: { type: String, required: true },
    tipoDoc: { type: String, required: true },
    nroDoc: { type: String, required: true },
    nombreRecHumano: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    apePatRecHumano: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    apeMatRecHumano: { type: String, set: (value) => value.toUpperCase() },
    fechaNacimiento: { type: Date, required: true },
    sexoRecHumano: { type: String, required: true },
    departamentoRecHumano: { type: String, required: true },
    provinciaRecHumano: { type: String, required: true },
    distritoRecHumano: { type: String, required: true },
    direcRecHumano: { type: String },
    mailRecHumano: { type: String },
    phones: [telefonoSchema],
    atiendeConsultas: { type: Boolean, default: false },
    gradoInstruccion: { type: String },
    profesionesRecurso: [profesionesSchema],
    usuarioSistema: { type: Boolean },
    datosLogueo: {
      nombreUsuario: { type: String },
      correoLogin: { type: String },
      passwordHash: { type: String },
      rol: {
        type: Schema.Types.ObjectId,
        ref: "rolCollection",
      }, // rol del usuario
      sedeAsignada: { type: String },
      estado: { type: Boolean }, // activo o no para el sistema
    },
  },
  {
    timestamps: true,
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model(
  "recursosHumanosCollection",
  RecursoHumanoSchema
);
