const mongoose = require("mongoose");
const { Schema } = require("mongoose");

// ====== Componentes clínicos del servicio ======

const examenesSchema = new Schema({
  // Tipo funcional del componente.
  // Temporalmente opcional hasta migrar completamente el frontend.
  tipoExamen: {
    type: String,
    enum: ["LABORATORIO", "ECOGRAFIA", "RAYOS_X", "CONSULTA", "PROCEDIMIENTO"],
    required: true,
  },

  // Referencia dinámica al maestro clínico correspondiente.
  referenciaId: {
    type: Schema.Types.ObjectId,

    ref: function () {
      switch (this.tipoExamen) {
        case "LABORATORIO":
          return "pruebasLabCollection";

        // Se habilitarán cuando existan los respectivos maestros.
        // case "ECOGRAFIA":
        //   return "pruebasEcografiaCollection";

        // case "RAYOS_X":
        //   return "pruebasRayosXCollection";

        // case "CONSULTA":
        //   return "consultaCollection";

        // case "PROCEDIMIENTO":
        //   return "procedimientoCollection";

        default:
          return null;
      }
    },

    required: function () {
      return this.tipoExamen === "LABORATORIO";
    },

    default: null,
  },

  // ====== Datos identificativos ======

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

  // ====== Configuración de instancias ======

  numeroInstancias: {
    type: Number,
    default: 1,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: "El número de instancias debe ser un número entero",
    },
  },

  modalidadInstancias: {
    type: String,
    enum: ["UNICA", "MUESTRAS_INDEPENDIENTES", "REPETICIONES_MISMA_MUESTRA"],
    default: "UNICA",
  },

  etiquetasInstancias: {
    type: [String],
    default: [],
  },
});

// ====== Profesiones asociadas ======

const profAsociadasSchema = new Schema(
  {
    profesionId: {
      type: Schema.Types.ObjectId,
      ref: "profesionCollection",
      required: true,
    },

    especialidadId: {
      type: Schema.Types.ObjectId,
      ref: "especialidadCollection",
      required: false,
      default: null,
    },
  },
  {
    _id: false,
  },
);

// ====== Servicios incluidos en un paquete ======

const servicioIncluidoSchema = new Schema(
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
      validate: {
        validator: Number.isInteger,
        message: "La cantidad debe ser un número entero",
      },
    },
  },
  {
    _id: false,
  },
);

// ====== Servicio ======

const ServicioSchema = Schema(
  {
    codServicio: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // ====== Clasificación ======

    claseServicio: {
      type: String,
      enum: ["INDIVIDUAL", "PAQUETE"],
      default: "INDIVIDUAL",
      required: true,
    },

    // Solo corresponde a servicios individuales.
    // Ej.: Laboratorio, Consulta, Ecografía, Procedimiento.
    tipoServicio: {
      type: String,
      required: function () {
        return this.claseServicio === "INDIVIDUAL";
      },
      default: null,
      trim: true,
    },

    // ====== Datos generales ======

    nombreServicio: {
      type: String,
      required: true,
      trim: true,
      set: (value) => value?.toUpperCase(),
    },

    descripcionServicio: {
      type: String,
      default: "",
      trim: true,
    },

    precioServicio: {
      type: Number,
      required: true,
      min: 0,
    },

    estadoServicio: {
      type: Boolean,
      default: true,
      required: true,
    },

    favoritoServicio: {
      type: Boolean,
      default: false,
    },

    favoritoServicioEmpresa: {
      type: Boolean,
      default: false,
    },

    // ====== Configuración profesional ======

    // Indica si Cotización / Atención debe solicitar
    // la selección de un profesional.
    requiereSeleccionProfesional: {
      type: Boolean,
      default: false,
    },

    profesionesAsociadas: {
      type: [profAsociadasSchema],
      default: [],
    },

    // ====== Composición clínica ======

    // Para servicios INDIVIDUALES.
    // Conservamos el nombre actual para no hacer
    // un refactor grande en esta etapa.
    examenesServicio: {
      type: [examenesSchema],
      default: [],
    },

    // ====== Composición comercial ======

    // Para servicios de clase PAQUETE.
    serviciosIncluidos: {
      type: [servicioIncluidoSchema],
      default: [],
    },

    // ====== Auditoría ======

    createdBy: {
      type: String,
      required: true,
    },

    usuarioRegistro: {
      type: String,
      default: "",
    },

    fechaRegistro: {
      type: Date,
      default: Date.now,
    },

    updatedBy: {
      type: String,
      default: null,
    },

    usuarioActualizacion: {
      type: String,
      default: "",
    },

    fechaActualizacion: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// ====== Modelo ======

module.exports = mongoose.model("servicioCollection", ServicioSchema);
