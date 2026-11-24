const mongoose = require('mongoose');
const { Schema } = mongoose;

// ====== Correlativo de recepciones administrativas por sede y año ======
const correlativoSchema = new Schema({
  _id: { type: String, required: true },
  secuencia: { type: Number, required: true, min: 0 },
}, { versionKey: false });

module.exports = mongoose.models.RecepcionSucursalCorrelativo ||
  mongoose.model('RecepcionSucursalCorrelativo', correlativoSchema, 'recepcionessucursalescorrelativos');
