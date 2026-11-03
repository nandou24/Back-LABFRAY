const mongoose = require('mongoose');

// ====== Correlativo diario único para importaciones empresariales ======
const CorrelativoLoteImportacionSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // AAAAMMDD en horario de Perú
  ultimo: { type: Number, default: 0, min: 0 },
}, { versionKey: false, collection: 'correlativosLoteImportacionEmpresa' });

module.exports = mongoose.models.CorrelativoLoteImportacionEmpresa ||
  mongoose.model('CorrelativoLoteImportacionEmpresa', CorrelativoLoteImportacionSchema);
