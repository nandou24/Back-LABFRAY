const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const ServicioProgramadoSchema = new Schema(
  {
    servicioId: {
      type: Schema.Types.ObjectId,
      ref: "servicioCollection",
      required: true,
    },
    codServicio: { type: String, required: true, trim: true },
    nombreServicio: { type: String, required: true, trim: true },
    tipoServicio: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false },
);

const PendienteProgramacionSchema = new Schema(
  {
    tipo: {
      type: String,
      required: true,
      enum: ["MUESTRA", "EVALUACION", "DOCUMENTO", "OTRO"],
    },
    servicioId: { type: Schema.Types.ObjectId, ref: "servicioCollection" },
    codServicio: { type: String, trim: true },
    nombreServicio: { type: String, trim: true },
    descripcion: { type: String, required: true, trim: true },
    fechaRegistro: { type: Date, default: Date.now },
    fechaResolucion: { type: Date, default: null },
    resuelto: { type: Boolean, default: false },
  },
  { _id: false },
);

// ====== Snapshot de plazo comprometido ======

const PlazoResultadosProgramacionSchema = new Schema(
  {
    cantidadDias: {
      type: Number,
      min: 1,
      default: null,
    },
    tipoDias: {
      type: String,
      enum: ["HABILES", "CALENDARIO"],
      default: null,
    },
  },
  { _id: false },
);

// ====== Auditoría de verificación masiva de identidad ======
const DecisionesIdentidadImportacion = [
  "CONFORME", "CONFIRMAR_MAESTRO", "DESCARTAR_CANDIDATO",
  "PENDIENTE", "SIN_COINCIDENCIA_REVISADA", "DOCUMENTO_PENDIENTE",
];

const IdentidadVerificadaImportacionSchema = new Schema({
  tipoDoc: { type: String, default: null },
  nroDoc: { type: String, default: null },
  apePatCliente: { type: String, default: null },
  apeMatCliente: { type: String, default: null },
  nombreCliente: { type: String, default: null },
}, { _id: false });

const RevisionIdentidadImportacionSchema = new Schema({
  decision: { type: String, enum: DecisionesIdentidadImportacion, required: true },
  pacienteIdCandidato: { type: Schema.Types.ObjectId, default: null },
  hcCandidata: { type: String, default: null },
  categoriaConsulta: { type: String, default: null },
  huellaConsulta: { type: String, required: true },
  fecha: { type: Date, required: true },
  ejecutadoPor: { type: String, required: true },
  usuario: { type: String, default: null },
  nombreCompletoUsuario: { type: String, default: null },
  motivo: { type: String, trim: true, maxlength: 300, default: null },
}, { _id: false });

const EventoVerificacionIdentidadImportacionSchema = new Schema({
  decision: { type: String, enum: DecisionesIdentidadImportacion, required: true },
  categoriaConsulta: { type: String, default: null },
  pacienteIdCandidato: { type: Schema.Types.ObjectId, default: null },
  hcCandidata: { type: String, default: null },
  documentoCoincidente: { type: Boolean, default: false },
  huellaConsulta: { type: String, required: true },
  motivo: { type: String, trim: true, maxlength: 300, default: null },
  confirmacionDiferencias: { type: Boolean, default: false },
  identidadProgramacion: { type: IdentidadVerificadaImportacionSchema, default: () => ({}) },
  identidadCandidato: { type: IdentidadVerificadaImportacionSchema, default: () => ({}) },
  fecha: { type: Date, required: true },
  ejecutadoPor: { type: String, required: true },
  usuario: { type: String, default: null },
  nombreCompletoUsuario: { type: String, default: null },
}, { _id: false });

const ProgramacionPacienteEmpresaSchema = new Schema(
  {
    codProgramacion: { type: String, required: true, unique: true, trim: true },
    empresaId: {
      type: Schema.Types.ObjectId,
      ref: "empresasCollection",
      required: true,
    },
    rucEmpresa: { type: String, required: true, trim: true },
    razonSocialEmpresa: { type: String, required: true, trim: true },
    nombreComercialEmpresa: { type: String, trim: true },
    tipoDoc: { type: String, enum: ["DNI", "CE", "PASAPORTE", null] },
    nroDoc: { type: String, trim: true },
    nombreCliente: {
      type: String,
      required: true,
      trim: true,
      set: (value) => value.toUpperCase(),
    },
    apePatCliente: {
      type: String,
      required: true,
      trim: true,
      set: (value) => value.toUpperCase(),
    },
    apeMatCliente: {
      type: String,
      trim: true,
      set: (value) => value.toUpperCase(),
    },
    sexoCliente: {
      type: String,
      enum: ["Masculino", "Femenino", null],
      default: null,
    },
    fechaNacimiento: { type: Date },
    puesto: { type: String, trim: true },
    area: { type: String, trim: true },
    pacienteId: {
      type: Schema.Types.ObjectId,
      ref: "pacientesCollection",
      default: null,
    },
    hc: { type: String, default: null, trim: true },
    // ====== Identidad transaccional hasta resolver documento ======
    identidadTemporalActiva: { type: Boolean, default: false },
    fechaInicioIdentidadTemporal: { type: Date, default: null },
    fechaRegularizacionIdentidad: { type: Date, default: null },
    // ====== Auditoría de vínculos de identidad ======
    historialVinculaciones: {
      type: [{
        tipo: {type:String,required:true},
        pacienteIdAnterior: {type:Schema.Types.ObjectId,default:null},
        hcAnterior: {type:String,default:null},
        pacienteIdNuevo: {type:Schema.Types.ObjectId,default:null},
        hcNueva: {type:String,default:null},
        tipoDocAnterior: {type:String,default:null},
        nroDocAnterior: {type:String,default:null},
        tipoDocNuevo: {type:String,default:null},
        nroDocNuevo: {type:String,default:null},
        fecha: {type:Date,default:Date.now},
        ejecutadoPor: {type:String,required:true},
        usuario: {type:String,default:null},
        nombreCompletoUsuario: {type:String,default:null},
        origenDocumento: {type:String,default:'EMPRESA'},
        tipoResolucion: {type:String,default:'COINCIDENCIA_EXACTA'},
        motivoDecision: {type:String,default:null},
        // ====== Datos declarados al consultar, antes de aplicar identidad maestra ======
        identidadDeclarada: {
          nombreCliente: { type: String, default: null },
          apePatCliente: { type: String, default: null },
          apeMatCliente: { type: String, default: null },
          sexoCliente: { type: String, default: null },
          fechaNacimiento: { type: String, default: null },
        },
        // ====== Cambios al regularizar identidad temporal ======
        cambiosIdentidad: { type: [{
          campo: { type: String, required: true },
          valorAnterior: { type: String, default: null },
          valorNuevo: { type: String, default: null },
        }], default: [] },
      }], default: []
    },
    // ====== Decisiones de revisión de identidad antes de la primera vinculación ======
    historialRevisionIdentidad: {
      type: [{
        decision: { type: String, enum: ['DISTINTO', 'PENDIENTE'], required: true },
        pacienteIdCandidato: { type: Schema.Types.ObjectId, required: true },
        hcCandidata: { type: String, default: null },
        documentoCoincidente: { type: Boolean, default: false },
        tipoDocProgramacion: { type: String, default: null },
        nroDocProgramacion: { type: String, default: null },
        nombreClienteProgramacion: { type: String },
        apePatClienteProgramacion: { type: String },
        apeMatClienteProgramacion: { type: String },
        motivo: { type: String, default: null, trim: true, maxlength: 300 },
        fecha: { type: Date, default: Date.now },
        ejecutadoPor: { type: String, required: true },
        usuario: { type: String, default: null },
        nombreCompletoUsuario: { type: String, default: null },
      }], default: [],
    },
    protocoloId: { type: Schema.Types.ObjectId, required: true },
    codProtocolo: { type: String, required: true, trim: true },
    nombreProtocolo: { type: String, required: true, trim: true },
    plazoResultados: {
      type: PlazoResultadosProgramacionSchema,
      default: null,
    },
    serviciosProgramados: { type: [ServicioProgramadoSchema], required: true },
    fechaProgramada: { type: Date, required: true },
    turno: { type: String, enum: ["MAÑANA", "TARDE", "NOCHE"] },
    horaProgramada: { type: String, trim: true },
    sede: { type: String, enum: ["Callao", "Comas", "NoIndica"] },
    tipoEvaluacion: {
      type: String,
      enum: [
        "ETAs",
        "Ocupacional",
        "PreOcupacional",
        "Retiro",
        "Toxicológico",
        "Otro",
      ],
    },
    tipoAtencion: { type: String, enum: ["Regular", "Preferencial", "VIP"] },
    prioridad: { type: String, enum: ["Normal", "Alta"] },
    estadoProgramacion: {
      type: String,
      required: true,
      default: "PROGRAMADO",
      enum: [
        "PROGRAMADO",
        "EN ATENCION",
        "PENDIENTE DE COMPLETAR",
        "ATENDIDO",
        "NO ASISTIO",
        "CANCELADO",
      ],
    },
    pendientes: { type: [PendienteProgramacionSchema], default: [] },
    fechaInicioAtencion: { type: Date, default: null },
    fechaUltimaAtencion: { type: Date, default: null },
    fechaFinalizacion: { type: Date, default: null },
    // ====== Bloqueo definitivo de captura al completar servicios presenciales ======
    fechaBloqueoFotografia: { type: Date, default: null },
    origenBloqueoFotografia: { type: String, default: null },
    usuarioBloqueoFotografia: { type: String, default: null },
    observaciones: { type: String, trim: true },
    // ====== Decisión actual y eventos auditables de identidad importada ======
    revisionIdentidadImportacion: { type: RevisionIdentidadImportacionSchema, default: null },
    historialVerificacionIdentidadImportacion: {
      type: [EventoVerificacionIdentidadImportacionSchema], default: [],
    },
    // ====== Trazabilidad e idempotencia de importación Excel ======
    importacionId: { type: String, trim: true, default: null },
    filaExcelImportacion: { type: Number, default: null },
    huellaImportacion: { type: String, trim: true, default: null },
    revisionImportacion: {
      advertencias: { type: [String], default: [] },
      confirmadoPor: { type: String, default: null },
      fechaConfirmacion: { type: Date, default: null },
    },
    origenRegistro: {
      type: String,
      enum: ["MANUAL", "IMPORTACION_EXCEL"],
      default: "MANUAL",
    },
    createdBy: { type: String, required: true },
    usuarioRegistro: { type: String },
    updatedBy: { type: String },
    usuarioActualizacion: { type: String },
    fechaActualizacion: { type: Date },
  },
  { timestamps: true },
);

// ====== Evitar importar dos veces la misma fila ======
ProgramacionPacienteEmpresaSchema.index(
  { importacionId: 1, filaExcelImportacion: 1 },
  { unique: true, partialFilterExpression: { importacionId: { $type: 'string' } } },
);

// ProgramacionPacienteEmpresaSchema.index({ empresaId: 1, fechaProgramada: 1 });
// ProgramacionPacienteEmpresaSchema.index({ nroDoc: 1, fechaProgramada: 1 });
// ProgramacionPacienteEmpresaSchema.index({ estadoProgramacion: 1, fechaProgramada: 1 });

module.exports = mongoose.model(
  "programacionPacienteEmpresaCollection",
  ProgramacionPacienteEmpresaSchema,
);
