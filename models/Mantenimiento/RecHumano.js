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
    // ====== Presentaciones de firma por profesión y servicio ======
    firmaLaboratorio: {
      habilitado: { type: Boolean, default: false },
      profesionRecursoId: { type: Schema.Types.ObjectId, default: null },
      serviciosAutorizados: { type: [String], default: [] },
      predeterminadoLaboratorio: { type: Boolean, default: false },
      referenciaAutorizacion: { type: String, default: '' },
      presentaciones: [{
        perfilId: { type: String, required: true },
        etiqueta: { type: String, default: 'Firma profesional' },
        tratamiento: { type: String, default: '' },
        profesionRecursoId: { type: Schema.Types.ObjectId, required: true },
        especialidadId: { type: Schema.Types.ObjectId, default: null },
        mostrarProfesion: { type: Boolean, default: true },
        mostrarEspecialidad: { type: Boolean, default: true },
        mostrarColegiatura: { type: Boolean, default: true },
        mostrarRne: { type: Boolean, default: true },
        siglaColegiatura: { type: String, default: 'Colegiatura' },
        siglaEspecialidad: { type: String, default: 'RNE' },
        serviciosAutorizados: { type: [String], default: ['Laboratorio'] },
        esPrincipal: { type: Boolean, default: false },
      }],
      fechaActualizacion: { type: Date, default: null },
      actualizadoPor: { type: String, default: null },
      usuarioActualizacion: { type: String, default: null },
    },
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
    // 🔍 Campos de auditoría:
    createdBy: { type: String, required: true }, // uid
    usuarioRegistro: { type: String }, // nombre de usuario
    fechaRegistro: { type: Date, default: Date.now },
    updatedBy: { type: String }, // uid del usuario que actualiza
    usuarioActualizacion: { type: String },
    fechaActualizacion: { type: Date },
  },
  {
    timestamps: true,
  }
);

// ====== Único firmante predeterminado de Laboratorio ======
RecursoHumanoSchema.index(
  { "firmaLaboratorio.predeterminadoLaboratorio": 1 },
  { unique: true, partialFilterExpression: { "firmaLaboratorio.predeterminadoLaboratorio": true } },
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model(
  "recursosHumanosCollection",
  RecursoHumanoSchema
);
