const mongoose = require("mongoose");
const { Schema } = mongoose;

// ====== Correlativo mensual de laboratorio ======

const CorrelativoLaboratorioSchema = new Schema(
  {
    // YYYYMM
    _id: {
      type: String,
      required: true,
      trim: true,
    },

    ultimoNumero: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model(
  "CorrelativoLaboratorio",
  CorrelativoLaboratorioSchema,
);
