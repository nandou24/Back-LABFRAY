const mongoose = require("mongoose");
const { Schema } = require("mongoose");

// ====== Profesiones asociadas ======

const profAsociadasSchema = new Schema({
  profesionId: {
    type: Schema.Types.ObjectId,
    ref: "profesionCollection",
  },

  especialidadId: {
    type: Schema.Types.ObjectId,
    ref: "especialidadCollection",
    required: false,
    default: null,
  },
});

// ====== Servicios incluidos del paquete ======

const servicioIncluidoCotizacionSchema = new Schema(
  {
    servicioId: {
      type: Schema.Types.ObjectId,
      ref: "servicioCollection",
      required: true,
    },

    cantidad: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    _id: false,
  },
);

// ====== Servicios cotizados ======

const ServiciosSchema = new Schema({
  servicioId: {
    type: Schema.Types.ObjectId,
    ref: "servicioCollection",
  },

  codServicio: {
    type: String,
    required: true,
  },

  // ====== Clasificación ======

  claseServicio: {
    type: String,
    enum: ["INDIVIDUAL", "PAQUETE"],
    default: "INDIVIDUAL",
  },

  tipoServicio: {
    type: String,
    default: null,
  },

  nombreServicio: {
    type: String,
  },

  // ====== Datos comerciales ======

  cantidad: {
    type: Number,
    required: true,
  },

  precioLista: {
    type: Number,
    required: true,
  },

  diferencia: {
    type: Number,
  },

  precioVenta: {
    type: Number,
    required: true,
  },

  descuentoPorcentaje: {
    type: Number,
    required: true,
  },

  nuevoPrecioVenta: {
    type: Number,
    required: true,
  },

  totalUnitario: {
    type: Number,
    required: true,
  },

  // ====== Configuración profesional ======

  requiereSeleccionProfesional: {
    type: Boolean,

    // Compatibilidad temporal con cotizaciones antiguas.
    default: function () {
      return ["Consulta", "Ecografía", "Procedimiento"].includes(
        this.tipoServicio,
      );
    },
  },

  profesionesAsociadas: {
    type: [profAsociadasSchema],
    default: [],
  },

  medicoAtiende: {
    medicoId: {
      type: Schema.Types.ObjectId,
      ref: "recursosHumanosCollection",
      required: false,
      default: null,
    },

    codRecHumano: {
      type: String,
    },

    nombreRecHumano: {
      type: String,
    },

    apePatRecHumano: {
      type: String,
    },

    apeMatRecHumano: {
      type: String,
    },

    nroColegiatura: {
      type: String,
    },

    rne: {
      type: String,
    },
  },

  // ====== Snapshot comercial del paquete ======

  serviciosIncluidos: {
    type: [servicioIncluidoCotizacionSchema],
    default: [],
  },
});

// ====== Historial ======

const HistorialSchema = new Schema({
  version: {
    type: Number,
    required: true,
  },

  fechaModificacion: {
    type: Date,
    default: Date.now,
  },

  estadoRegistroPaciente: {
    type: Boolean,
    required: true,
  },

  hc: {
    type: String,
  },

  tipoDoc: {
    type: String,
    required: true,
  },

  nroDoc: {
    type: String,
    required: true,
  },

  clienteId: {
    type: Schema.Types.ObjectId,
    ref: "pacienteCollection",
    required: true,
  },

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

  apeMatCliente: {
    type: String,
    set: (value) => value.toUpperCase(),
  },

  estadoRegistroSolicitante: {
    type: Boolean,
    required: true,
  },

  codSolicitante: {
    type: String,
  },

  solicitanteId: {
    type: Schema.Types.ObjectId,
    ref: "referenciaMedicoCollection",
    required: false,
  },

  nombreRefMedico: {
    type: String,
  },

  apePatRefMedico: {
    type: String,
  },

  apeMatRefMedico: {
    type: String,
  },

  profesionSolicitante: {
    type: String,
  },

  colegiatura: {
    type: String,
  },

  especialidadSolicitante: {
    type: String,
  },

  aplicarPrecioGlobal: {
    type: Boolean,
    required: true,
  },

  aplicarDescuentoPorcentGlobal: {
    type: Boolean,
    required: true,
  },

  sumaTotalesPrecioLista: {
    type: Number,
  },

  descuentoTotal: {
    type: Number,
  },

  precioConDescGlobal: {
    type: Number,
  },

  descuentoPorcentaje: {
    type: Number,
  },

  subTotal: {
    type: Number,
  },

  igv: {
    type: Number,
  },

  total: {
    type: Number,
  },

  serviciosCotizacion: {
    type: [ServiciosSchema],
    default: [],
  },

  // ====== Auditoría ======

  createdBy: {
    type: String,
    required: true,
  },

  usuarioRegistro: {
    type: String,
  },

  fechaRegistro: {
    type: Date,
    default: Date.now,
  },
});

// ====== Cotización ======

const CotizacionSchema = Schema(
  {
    codCotizacion: {
      type: String,
      required: true,
    },

    estadoCotizacion: {
      type: String,
      required: true,
      enum: [
        "GENERADA",
        "MODIFICADA",
        "PAGO PARCIAL",
        "PAGO TOTAL",
        "PAGO ANULADO",
        "ANULADO",
        "FACTURADO",
      ],
    },

    historial: {
      type: [HistorialSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

// ====== Modelo ======

module.exports = {
  CotizacionModel: mongoose.model("cotizacionCollection", CotizacionSchema),
  profAsociadasSchema,
  ServiciosSchema,
};
