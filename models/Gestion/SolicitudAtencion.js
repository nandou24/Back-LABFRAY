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
