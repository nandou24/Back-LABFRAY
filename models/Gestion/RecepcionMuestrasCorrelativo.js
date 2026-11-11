const mongoose = require('mongoose');
const { Schema } = mongoose;

// ====== Correlativo anual de remisiones administrativas ======
const correlativoSchema = new Schema({
  _id: { type: String, required: true },
  secuencia: { type: Number, required: true, min: 0 },
}, { versionKey: false });

module.exports = mongoose.models.RecepcionMuestrasCorrelativo ||
  mongoose.model('RecepcionMuestrasCorrelativo', correlativoSchema);
