const mongoose = require("mongoose");
const { Schema } = mongoose;

const CANALES_DESPACHO = [
  "PRESENCIAL",
  "WHATSAPP",
  "CORREO",
  "PORTAL",
  "OTRO",
];

const MODOS_CONTENIDO = [
  "REGISTRO_PRESENCIAL",
  "ENLACE_SEGURO",
  "PDF_ADJUNTO",
  "PDF_Y_ENLACE",
  "PUBLICACION_PORTAL",
  "OTRO",
];

const ESTADOS_DESPACHO = [
  "PENDIENTE",
  "PROCESANDO",
  "ENVIADO",
  "ERROR",
  "ENTREGADO",
  "LEIDO",
  "CANCELADO",
];

// ====== Destinatario ======
const DestinatarioDespachoSchema = new Schema(
  {
    tipo: {
      type: String,
      enum: ["PACIENTE", "CONTACTO_EMPRESA", "OTRO"],
      default: "PACIENTE",
      required: true,
    },
    nombre: { type: String, required: true, trim: true, maxlength: 180 },
    correo: { type: String, default: null, trim: true, lowercase: true },
    telefono: { type: String, default: null, trim: true },
    cargo: { type: String, default: null, trim: true, maxlength: 120 },
    referencia: { type: String, default: null, trim: true, maxlength: 250 },
  },
  { _id: false },
);

// ====== Resultado seleccionado ======
const ResultadoDespachoSchema = new Schema(
  {
    resultadoLaboratorioId: {
      type: Schema.Types.ObjectId,
      ref: "ResultadoLaboratorio",
      required: true,
    },
    claveUnidad: { type: String, required: true, trim: true },
    codPruebaLab: { type: String, required: true, trim: true },
    nombrePruebaLab: { type: String, required: true, trim: true },
    numeroInstancia: { type: Number, default: 1, min: 1 },
    etiquetaInstancia: { type: String, default: null, trim: true },
    versionResultado: { type: Number, required: true, min: 1 },
    fechaLiberacion: { type: Date, required: true },
  },
  { _id: false },
);

// ====== Solicitud incluida ======
const SolicitudDespachoSchema = new Schema(
  {
    solicitudAtencionId: {
      type: Schema.Types.ObjectId,
      ref: "SolicitudAtencion",
      required: true,
      index: true,
    },
    codSolicitud: { type: String, required: true, trim: true },
    codigoLaboratorio: { type: String, default: "", trim: true },
    paciente: {
      pacienteId: { type: Schema.Types.ObjectId, default: null },
      nombreCompleto: { type: String, required: true, trim: true },
      hc: { type: String, default: "", trim: true },
      documento: { type: String, default: "", trim: true },
    },
    empresa: {
      empresaId: { type: Schema.Types.ObjectId, default: null },
      razonSocialEmpresa: { type: String, default: null, trim: true },
      programacionEmpresaId: { type: Schema.Types.ObjectId, default: null },
      codProgramacion: { type: String, default: null, trim: true },
      codProtocolo: { type: String, default: null, trim: true },
    },
    resultados: {
      type: [ResultadoDespachoSchema],
      required: true,
      validate: {
        validator: (valor) => Array.isArray(valor) && valor.length > 0,
        message: "El despacho debe contener al menos un resultado",
      },
    },
  },
  { _id: false },
);

// ====== Intentos técnicos ======
const IntentoDespachoSchema = new Schema(
  {
    numeroIntento: { type: Number, required: true, min: 1 },
    estado: {
      type: String,
      enum: ["PROCESANDO", "ENVIADO", "ERROR"],
      required: true,
    },
    proveedor: { type: String, default: null, trim: true },
    proveedorMensajeId: { type: String, default: null, trim: true },
    codigoRespuesta: { type: String, default: null, trim: true },
    errorCodigo: { type: String, default: null, trim: true },
    errorMensaje: { type: String, default: null, trim: true, maxlength: 1000 },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, default: null },
  },
  { _id: true },
);


// ====== Acceso seguro al visor público ======
const RecursoDigitalDespachoSchema = new Schema(
  {
    tokenAccesoHash: { type: String, default: null, trim: true },
    vigencia: {
      type: String,
      enum: ["PERMANENTE", "TEMPORAL"],
      default: "PERMANENTE",
    },
    estadoAcceso: {
      type: String,
      enum: ["ACTIVO", "REVOCADO"],
      default: "ACTIVO",
    },
    fechaExpiracionAcceso: { type: Date, default: null },
    fechaPrimerAcceso: { type: Date, default: null },
    fechaUltimoAcceso: { type: Date, default: null },
    cantidadAccesos: { type: Number, default: 0, min: 0 },
    fechaRevocacion: { type: Date, default: null },
    motivoRevocacion: { type: String, default: null, trim: true, maxlength: 500 },

  },
  { _id: false },
);

// ====== Despacho común ======
const DespachoResultadoLaboratorioSchema = new Schema(
  {
    tipoDespacho: {
      type: String,
      enum: ["INDIVIDUAL", "LOTE_EMPRESA"],
      default: "INDIVIDUAL",
      required: true,
      index: true,
    },
    origenAtencion: {
      type: String,
      enum: ["PARTICULAR", "EMPRESA"],
      required: true,
      index: true,
    },
    canal: {
      type: String,
      enum: CANALES_DESPACHO,
      required: true,
      index: true,
    },
    modoContenido: {
      type: String,
      enum: MODOS_CONTENIDO,
      required: true,
    },
    destinatario: {
      type: DestinatarioDespachoSchema,
      required: true,
    },
    detalleCanal: { type: String, default: null, trim: true, maxlength: 250 },
    observacion: { type: String, default: "", trim: true, maxlength: 1000 },
    solicitudes: {
      type: [SolicitudDespachoSchema],
      required: true,
      validate: {
        validator: (valor) => Array.isArray(valor) && valor.length > 0,
        message: "El despacho debe contener al menos una solicitud",
      },
    },
    estadoDespacho: {
      type: String,
      enum: ESTADOS_DESPACHO,
      default: "PENDIENTE",
      required: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
      unique: true,
      index: true,
    },
    payloadHash: { type: String, required: true, trim: true },
    intentos: { type: [IntentoDespachoSchema], default: [] },
    recursoDigital: {
      type: RecursoDigitalDespachoSchema,
      default: null,
    },
    entregaResultadoIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "entregaResultadoLaboratorioCollection",
      },
    ],
    fechaSolicitud: { type: Date, default: Date.now, immutable: true },
    fechaInicioProcesamiento: { type: Date, default: null },
    fechaEnvio: { type: Date, default: null },
    fechaEntregaConfirmada: { type: Date, default: null },
    fechaLectura: { type: Date, default: null },
    fechaError: { type: Date, default: null },
    ultimoError: { type: String, default: null, trim: true, maxlength: 1000 },
    fechaCancelacion: { type: Date, default: null },
    motivoCancelacion: { type: String, default: null, trim: true, maxlength: 500 },
    solicitadoPor: { type: String, required: true },
    usuarioSolicitud: { type: String, required: true, trim: true },
    actualizadoPor: { type: String, default: null },
    usuarioActualizacion: { type: String, default: null, trim: true },
  },
  { timestamps: true, versionKey: false },
);

DespachoResultadoLaboratorioSchema.index({
  "solicitudes.solicitudAtencionId": 1,
  fechaSolicitud: -1,
});
DespachoResultadoLaboratorioSchema.index({ estadoDespacho: 1, fechaSolicitud: -1 });
DespachoResultadoLaboratorioSchema.index(
  { "recursoDigital.tokenAccesoHash": 1 },
  { sparse: true },
);

module.exports = mongoose.model(
  "despachoResultadoLaboratorioCollection",
  DespachoResultadoLaboratorioSchema,
);
