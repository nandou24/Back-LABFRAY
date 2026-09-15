const mongoose = require("mongoose");
const { Schema } = require("mongoose");

// ====== Origen del servicio solicitado ======

const OrigenServicioSolicitudSchema = new Schema(
  {
    claseServicio: {
      type: String,
      enum: ["INDIVIDUAL", "PAQUETE"],
    },

    servicioOrigenId: {
      type: Schema.Types.ObjectId,
      ref: "servicioCollection",
    },

    codServicioOrigen: {
      type: String,
      trim: true,
    },

    nombreServicioOrigen: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
  },
);

// Define the ServicioSolicitud subdocument schema
const ServicioSolicitudSchema = new mongoose.Schema({
  servicioId: {
    type: Schema.Types.ObjectId,
    ref: "servicioCollection",
  },
  codServicio: { type: String, required: true, trim: true },
  nombreServicio: { type: String, required: true, trim: true },
  // ====== Datos transaccionales ======

  lineaCotizacion: {
    type: Number,
    default: null,
  },

  cantidadServicio: {
    type: Number,
    default: 1,
    min: 1,
  },

  requiereSeleccionProfesional: {
    type: Boolean,
    default: false,
  },

  fuenteComposicion: {
    type: String,
    enum: ["DIRECTO", "SNAPSHOT_COTIZACION", "MAESTRO_ACTUAL_FALLBACK"],
    default: "DIRECTO",
  },

  origenServicio: {
    type: OrigenServicioSolicitudSchema,
    default: null,
  },
  estado: {
    type: String,
    required: true,
    enum: ["PENDIENTE", "EN PROCESO", "TERMINADO", "ANULADO"],
    trim: true,
  },
  medicoAtiende: {
    medicoId: {
      type: Schema.Types.ObjectId,
      ref: "recursosHumanosCollection",
      required: false,
      default: null,
    },
    codRecHumano: { type: String },
    nombreRecHumano: { type: String },
    apePatRecHumano: { type: String },
    apeMatRecHumano: { type: String },
    nroColegiatura: { type: String },
    rne: { type: String },
  },
});

// ====== Laboratorio de referencia snapshot ======

const LaboratorioReferenciaSnapshotSchema = new Schema(
  {
    codLaboratorioReferencia: {
      type: String,
      default: null,
    },

    nombreLaboratorio: {
      type: String,
      default: "",
    },

    razonSocial: {
      type: String,
      default: "",
    },

    ruc: {
      type: String,
      default: "",
    },

    codigoCliente: {
      type: String,
      default: "",
    },

    direccion: {
      type: String,
      default: "",
    },

    observacion: {
      type: String,
      default: "",
    },

    estadoLaboratorioReferencia: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
    },
  },
  {
    _id: false,
  },
);

// ====== Procesamiento clínico snapshot ======

const ProcesamientoClinicoSnapshotSchema = new Schema(
  {
    tipo: {
      type: String,
      enum: ["INTERNO", "REFERENCIA"],
      required: true,
    },

    laboratorioReferenciaId: {
      type: Schema.Types.ObjectId,
      ref: "laboratorioReferenciaCollection",
      default: null,
    },

    laboratorioReferencia: {
      type: LaboratorioReferenciaSnapshotSchema,
      default: null,
    },

    observacion: {
      type: String,
      default: "",
    },

    origenConfiguracion: {
      type: String,
      enum: ["PRUEBA", "GRUPO", "ITEM"],
      default: undefined,
    },
  },
  {
    _id: false,
  },
);

// ====== Tipo de muestra snapshot ======

const TipoMuestraSnapshotSchema = new Schema(
  {
    codTipoMuestra: {
      type: String,
      default: null,
    },

    nombreTipoMuestra: {
      type: String,
      default: "",
    },

    descripcionTipoMuestra: {
      type: String,
      default: "",
    },

    estadoTipoMuestra: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
    },
  },
  {
    _id: false,
  },
);

// ====== Tubo / envase snapshot ======

const TuboEnvaseSnapshotSchema = new Schema(
  {
    codTuboEnvase: {
      type: String,
      default: null,
    },

    nombreTuboEnvase: {
      type: String,
      default: "",
    },

    descripcionTuboEnvase: {
      type: String,
      default: "",
    },

    color: {
      type: String,
      default: "",
    },

    aditivo: {
      type: String,
      default: "",
    },

    capacidad: {
      type: Number,
      default: null,
    },

    unidadCapacidad: {
      type: String,
      default: null,
    },

    estadoTuboEnvase: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
    },
  },
  {
    _id: false,
  },
);

// ====== Opción de muestra snapshot ======

const OpcionMuestraSnapshotSchema = new Schema(
  {
    tipoMuestraId: {
      type: Schema.Types.ObjectId,
      ref: "tipoMuestraCollection",
      required: true,
    },

    tipoMuestra: {
      type: TipoMuestraSnapshotSchema,
      required: true,
    },

    tuboEnvaseId: {
      type: Schema.Types.ObjectId,
      ref: "tuboEnvaseCollection",
      required: true,
    },

    tuboEnvase: {
      type: TuboEnvaseSnapshotSchema,
      required: true,
    },
  },
  {
    _id: false,
  },
);

// ====== Requerimiento de muestra snapshot ======

const RequerimientoMuestraSnapshotSchema = new Schema(
  {
    descripcion: {
      type: String,
      default: "",
    },

    alcance: {
      type: String,
      enum: ["TODA_PRUEBA", "ITEMS_ESPECIFICOS"],
      default: "TODA_PRUEBA",
    },

    opciones: {
      type: [OpcionMuestraSnapshotSchema],
      default: [],
    },

    itemsAsociados: [
      {
        type: Schema.Types.ObjectId,
        ref: "itemsLabCollection",
      },
    ],

    cantidadRecipientes: {
      type: Number,
      default: 1,
      min: 1,
    },

    volumenMinimo: {
      type: Number,
      default: null,
      min: 0,
    },

    unidadVolumen: {
      type: String,
      enum: ["uL", "mL", "L"],
      default: null,
    },

    permiteCompartirMuestra: {
      type: Boolean,
      default: true,
    },

    observacion: {
      type: String,
      default: "",
    },
  },
  {
    _id: false,
  },
);

// ====== Validación legacy de ItemLab ======

const ParamValidacionSnapshotSchema = new Schema(
  {
    descrValidacion: {
      type: String,
      default: "",
    },

    sexo: {
      type: String,
      default: "",
    },

    edadIndistinta: {
      type: String,
      default: null,
    },

    edadMin: {
      type: String,
      default: null,
    },

    edadMax: {
      type: String,
      default: null,
    },

    descRegla: {
      type: String,
      default: "",
    },

    valor1: {
      type: String,
      default: null,
    },

    valor2: {
      type: String,
      default: null,
    },
  },
  {
    _id: false,
  },
);

// ====== Referencia de resultado snapshot ======

const ReferenciaResultadoSnapshotSchema = new Schema(
  {
    descripcion: {
      type: String,
      default: "",
    },

    sexo: {
      type: String,
      enum: ["TODOS", "MASCULINO", "FEMENINO"],
      default: "TODOS",
    },

    edadMin: {
      type: Number,
      default: null,
    },

    edadMax: {
      type: Number,
      default: null,
    },

    unidadEdad: {
      type: String,
      enum: ["DIAS", "MESES", "ANIOS"],
      default: "ANIOS",
    },

    tipoReferencia: {
      type: String,
      enum: [
        "RANGO",
        "MENOR_QUE",
        "MENOR_IGUAL_QUE",
        "MAYOR_QUE",
        "MAYOR_IGUAL_QUE",
        "VALORES_PERMITIDOS",
        "TEXTO",
      ],
      required: true,
    },

    valorMin: {
      type: Number,
      default: null,
    },

    valorMax: {
      type: Number,
      default: null,
    },

    valorLimite: {
      type: Number,
      default: null,
    },

    valoresPermitidos: {
      type: [String],
      default: [],
    },

    textoReferencia: {
      type: String,
      default: "",
    },

    activo: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  },
);

// ====== Regla de alerta snapshot ======

const ReglaAlertaSnapshotSchema = new Schema(
  {
    descripcion: {
      type: String,
      default: "",
    },

    sexo: {
      type: String,
      enum: ["TODOS", "MASCULINO", "FEMENINO"],
      default: "TODOS",
    },

    edadMin: {
      type: Number,
      default: null,
    },

    edadMax: {
      type: Number,
      default: null,
    },

    unidadEdad: {
      type: String,
      enum: ["DIAS", "MESES", "ANIOS"],
      default: "ANIOS",
    },

    condicion: {
      type: String,
      enum: [
        "MENOR_QUE",
        "MENOR_IGUAL_QUE",
        "MAYOR_QUE",
        "MAYOR_IGUAL_QUE",
        "FUERA_DE_RANGO",
        "IGUAL_A",
        "DISTINTO_DE",
      ],
      required: true,
    },

    valor1: {
      type: Schema.Types.Mixed,
      default: null,
    },

    valor2: {
      type: Schema.Types.Mixed,
      default: null,
    },

    nivelAlerta: {
      type: String,
      enum: ["INFORMATIVA", "ADVERTENCIA", "CRITICA"],
      default: "ADVERTENCIA",
    },

    mensaje: {
      type: String,
      default: "",
    },

    activo: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  },
);

// ====== Snapshot ItemLab ======

const ItemLabSnapshotSchema = new Schema(
  {
    itemLabId: {
      type: Schema.Types.ObjectId,
      ref: "itemsLabCollection",
      required: true,
    },

    codItemLab: {
      type: String,
      default: null,
    },

    nombreInforme: {
      type: String,
      required: true,
    },

    nombreHojaTrabajo: {
      type: String,
      required: true,
    },

    metodoItemLab: {
      type: String,
      required: true,
    },

    valoresHojaTrabajo: {
      type: String,
      default: "",
    },

    valoresInforme: {
      type: String,
      default: "",
    },

    unidadesRef: {
      type: String,
      default: "",
    },

    ordenImpresion: {
      type: Number,
      default: 0,
    },

    poseeValidacion: {
      type: Boolean,
      default: false,
    },

    paramValidacion: {
      type: [ParamValidacionSnapshotSchema],
      default: [],
    },

    contextoAnalitico: {
      type: String,
      default: "",
    },

    tipoResultado: {
      type: String,
      enum: ["NUMERICO", "TEXTO", "CATEGORICO"],
      default: "TEXTO",
    },

    opcionesResultado: {
      type: [String],
      default: [],
    },

    permiteValorNoListado: {
      type: Boolean,
      default: false,
    },

    estadoItem: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
    },

    referenciasResultado: {
      type: [ReferenciaResultadoSnapshotSchema],
      default: [],
    },

    reglasAlerta: {
      type: [ReglaAlertaSnapshotSchema],
      default: [],
    },
  },
  {
    _id: false,
  },
);

// ====== Resultado transaccional del Item ======

const ResultadoItemLaboratorioSchema = new Schema(
  {
    valor: {
      type: Schema.Types.Mixed,
      default: null,
    },

    observacion: {
      type: String,
      default: "",
    },

    estado: {
      type: String,
      default: "PENDIENTE",
    },
  },
  {
    _id: false,
  },
);

// ====== Item clínico de la unidad ======

const ItemResultadoClinicoSchema = new Schema(
  {
    itemLabId: {
      type: Schema.Types.ObjectId,
      ref: "itemsLabCollection",
      required: true,
    },

    ordenItem: {
      type: Number,
      default: 0,
    },

    mostrarItem: {
      type: Boolean,
      default: true,
    },

    procesamientoEfectivo: {
      type: ProcesamientoClinicoSnapshotSchema,
      default: null,
    },

    snapshotItem: {
      type: ItemLabSnapshotSchema,
      required: true,
    },

    resultado: {
      type: ResultadoItemLaboratorioSchema,
      default: () => ({
        valor: null,
        observacion: "",
        estado: "PENDIENTE",
      }),
    },
  },
  {
    _id: false,
  },
);

// ====== Grupo clínico de resultados ======

const GrupoResultadoClinicoSchema = new Schema(
  {
    nombreGrupo: {
      type: String,
      default: "",
    },

    ordenGrupo: {
      type: Number,
      default: 0,
    },

    mostrarTitulo: {
      type: Boolean,
      default: true,
    },

    items: {
      type: [ItemResultadoClinicoSchema],
      default: [],
    },
  },
  {
    _id: false,
  },
);

// ====== Snapshot clínico de PruebaLab ======

const SnapshotClinicoPruebaLabSchema = new Schema(
  {
    pruebaLabId: {
      type: Schema.Types.ObjectId,
      ref: "pruebasLabCollection",
      required: true,
    },

    codPruebaLab: {
      type: String,
      required: true,
    },

    nombrePruebaLab: {
      type: String,
      required: true,
    },

    areaLab: {
      type: String,
      required: true,
    },

    condPreAnalitPaciente: {
      type: String,
      default: "",
    },

    condPreAnalitRefer: {
      type: String,
      default: "",
    },

    tiempoRespuesta: {
      type: String,
      default: "",
    },

    observPruebas: {
      type: String,
      default: null,
    },

    estadoPrueba: {
      type: String,
      enum: ["ACTIVO", "INACTIVO"],
      default: "ACTIVO",
    },

    procesamientoDefault: {
      type: ProcesamientoClinicoSnapshotSchema,
      default: null,
    },

    requiereMuestra: {
      type: Boolean,
      default: true,
    },

    requerimientosMuestra: {
      type: [RequerimientoMuestraSnapshotSchema],
      default: [],
    },

    gruposResultado: {
      type: [GrupoResultadoClinicoSchema],
      default: [],
    },
  },
  {
    _id: false,
  },
);

// ====== Unidad clínica de laboratorio ======

const UnidadLaboratorioSchema = new Schema(
  {
    claveUnidad: {
      type: String,
      required: true,
      trim: true,
    },

    lineaCotizacion: {
      type: Number,
      required: true,
      min: 1,
    },

    // ====== Servicio ======

    servicioId: {
      type: Schema.Types.ObjectId,
      ref: "servicioCollection",
      required: true,
    },

    codServicio: {
      type: String,
      required: true,
      trim: true,
    },

    nombreServicio: {
      type: String,
      required: true,
      trim: true,
    },

    // ====== Cantidades ======

    cantidadCotizada: {
      type: Number,
      required: true,
      min: 1,
    },

    cantidadEnPaquete: {
      type: Number,
      required: true,
      min: 1,
    },

    cantidadServicio: {
      type: Number,
      required: true,
      min: 1,
    },

    numeroServicio: {
      type: Number,
      required: true,
      min: 1,
    },

    // ====== Origen comercial ======

    origenServicio: {
      type: OrigenServicioSolicitudSchema,
      required: true,
    },

    fuenteComposicion: {
      type: String,
      enum: ["DIRECTO", "SNAPSHOT_COTIZACION", "MAESTRO_ACTUAL_FALLBACK"],
      required: true,
    },

    // ====== Prueba laboratorio ======

    pruebaLabId: {
      type: Schema.Types.ObjectId,
      ref: "pruebasLabCollection",
      required: true,
    },

    codExamen: {
      type: String,
      required: true,
      trim: true,
    },

    nombreExamen: {
      type: String,
      required: true,
      trim: true,
    },

    // ====== Instancia clínica ======

    modalidadInstancias: {
      type: String,
      enum: ["UNICA", "MUESTRAS_INDEPENDIENTES", "REPETICIONES_MISMA_MUESTRA"],
      required: true,
    },

    numeroInstancias: {
      type: Number,
      required: true,
      min: 1,
    },

    numeroInstancia: {
      type: Number,
      required: true,
      min: 1,
    },

    etiquetaInstancia: {
      type: String,
      default: null,
    },

    // ====== Snapshot clínico ======

    snapshotClinico: {
      type: SnapshotClinicoPruebaLabSchema,

      // Compatibilidad con solicitudes creadas antes de 7B.
      default: null,
    },

    // ====== Estado de la unidad ======

    estado: {
      type: String,
      enum: ["PENDIENTE", "EN PROCESO", "TERMINADO", "ANULADO"],
      default: "PENDIENTE",
    },
  },
  {
    _id: false,
  },
);

const SolicitudAtencionSchema = new Schema(
  {
    codSolicitud: { type: String, required: true, unique: true, trim: true },
    origenAtencion: {
      type: String,
      required: true,
      enum: ["PARTICULAR", "EMPRESA"],
      default: "PARTICULAR",
      index: true,
    },
    pagoId: {
      type: Schema.Types.ObjectId,
      ref: "pagoCollection",
      required: function () {
        return this.origenAtencion === "PARTICULAR";
      },
      default: null,
    },
    codPago: { type: String, default: null, trim: true },
    cotizacionId: {
      type: Schema.Types.ObjectId,
      ref: "cotizacionCollection",
      required: function () {
        return this.origenAtencion === "PARTICULAR";
      },
      default: null,
    },
    codCotizacion: {
      type: String,
      required: function () {
        return this.origenAtencion === "PARTICULAR";
      },
      default: null,
      trim: true,
      index: true,
    },
    fechaCotizacion: { type: Date },
    tipo: {
      type: String,
      required: true,
      enum: [
        "Laboratorio",
        "Ecografía",
        "Consulta",
        "Procedimiento",
        "Radiografía",
        "Otro",
      ],
      trim: true,
    },
    servicios: {
      type: [ServicioSolicitudSchema],
      required: true,
    },

    // ====== Unidades clínicas de laboratorio ======

    unidadesLaboratorio: {
      type: [UnidadLaboratorioSchema],
      default: [],
    },

    hc: {
      type: String,
      required: true,
      trim: true,
    },

    clienteId: {
      type: Schema.Types.ObjectId,
      ref: "pacientesCollection",
      required: true,
    },
    tipoDoc: { type: String, required: true },
    nroDoc: { type: String, required: true },
    nombreCliente: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    apePatCliente: {
      type: String,
      required: true,
      set: (value) => value.toUpperCase(),
    },
    apeMatCliente: { type: String, set: (value) => value.toUpperCase() },
    solicitanteId: {
      type: Schema.Types.ObjectId,
      ref: "referenciaMedicoCollection",
      required: false,
    },
    fechaEmision: { type: Date, required: true },
    programacionEmpresaId: {
      type: Schema.Types.ObjectId,
      ref: "programacionPacienteEmpresaCollection",
      required: function () {
        return this.origenAtencion === "EMPRESA";
      },
      default: null,
    },
    codProgramacion: {
      type: String,
      required: function () {
        return this.origenAtencion === "EMPRESA";
      },
      default: null,
      trim: true,
      index: true,
    },
    empresaId: {
      type: Schema.Types.ObjectId,
      ref: "empresasCollection",
      required: function () {
        return this.origenAtencion === "EMPRESA";
      },
      default: null,
    },
    razonSocialEmpresa: {
      type: String,
      required: function () {
        return this.origenAtencion === "EMPRESA";
      },
      default: null,
      trim: true,
    },
    protocoloId: {
      type: Schema.Types.ObjectId,
      required: function () {
        return this.origenAtencion === "EMPRESA";
      },
      default: null,
    },
    codProtocolo: {
      type: String,
      required: function () {
        return this.origenAtencion === "EMPRESA";
      },
      default: null,
      trim: true,
    },
    nombreProtocolo: {
      type: String,
      required: function () {
        return this.origenAtencion === "EMPRESA";
      },
      default: null,
      trim: true,
    },
    estado: {
      type: String,
      required: true,
      enum: ["GENERADO", "EN PROCESO", "ATENDIDO", "ANULADO"],
      default: "GENERADO",
      trim: true,
    },
    fechaAtencionArea: {
      type: Date,
      default: null,
    },

    atendidoPor: {
      type: String,
      default: null,
    },

    usuarioAtencion: {
      type: String,
      default: null,
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
  },
);

module.exports = mongoose.model("SolicitudAtencion", SolicitudAtencionSchema);
