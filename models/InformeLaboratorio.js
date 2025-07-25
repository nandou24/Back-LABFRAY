const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const resultadoItemSchema = new mongoose.Schema({
  itemLabId: {
    type: Schema.Types.ObjectId,
    ref: "itemsLabCollection",
    required: true,
  },
  codItemLab: { type: String, required: true },
  nombreItemLab: { type: String, required: true },
  valorObtenido: { type: String, required: true },
  unidadMedida: { type: String },
  valorReferencia: { type: String },
  observaciones: { type: String },
  estado: {
    type: String,
    enum: ["Normal", "Anormal", "Crítico", "Pendiente"],
    default: "Pendiente",
  },
});

const resultadoPruebaSchema = new mongoose.Schema({
  pruebaLabId: {
    type: Schema.Types.ObjectId,
    ref: "pruebasLabCollection",
    required: true,
  },
  codPruebaLab: { type: String, required: true },
  nombrePruebaLab: { type: String, required: true },
  resultadosItems: [resultadoItemSchema],
  observacionesPrueba: { type: String },
  estadoPrueba: {
    type: String,
    enum: ["Completado", "Pendiente Muestra", "En Proceso"],
    default: "Pendiente Muestra",
  },
  // Información técnica
  fechaTomaMuestra: { type: Date, required: true },
  fechaResultado: { type: Date, default: Date.now },
  tecnicoResponsable: { type: String },
  validadoPor: { type: String },
});

const InformeLaboratorioSchema = Schema(
  {
    codResultadoLab: {
      type: String,
      required: true,
      unique: true,
    },

    // Información del paciente
    pacienteId: {
      type: Schema.Types.ObjectId,
      ref: "pacientesCollection",
      required: true,
    },

    // Información de la solicitud/cotización
    cotizacionId: {
      type: Schema.Types.ObjectId,
      ref: "cotizacionCollection",
    },

    // Resultados de las pruebas
    resultadosPruebas: [resultadoPruebaSchema],

    // Estado general
    estadoGeneral: {
      type: String,
      enum: ["Generado", "En Proceso", "Completado", "Validado", "Entregado"],
      default: "Generado",
    },

    // Observaciones generales
    observacionesGenerales: { type: String },
  },
  {
    timestamps: true,
  }
);

//aquí se define o elige la colección/tabla en la que queremos que se guarde
module.exports = mongoose.model(
  "informeLaboratorioCollection",
  InformeLaboratorioSchema
);
