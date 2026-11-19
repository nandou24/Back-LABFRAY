const mongoose = require('mongoose');
const { Schema } = mongoose;

// ====== Serializar asignaciones y retiros de SuperAdmin entre procesos ======
const esquema = new Schema({
  _id: { type: String },
  token: { type: String, default: '' },
  hasta: { type: Date, default: () => new Date(0) },
}, { versionKey: false });

module.exports = mongoose.models.bloqueoAdministracionGlobalCollection ||
  mongoose.model('bloqueoAdministracionGlobalCollection', esquema);
