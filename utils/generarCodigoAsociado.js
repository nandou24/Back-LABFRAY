const mongoose = require('mongoose');

// ====== Correlativo centralizado para asociados ======
const contadorSchema = new mongoose.Schema({
  _id: { type: String },
  ultimo: { type: Number, min: 0, required: true },
}, { versionKey: false });
const ContadorAsociado = mongoose.models.contadorAsociadoCollection ||
  mongoose.model('contadorAsociadoCollection', contadorSchema);

async function siguienteCodigoAsociado() {
  // ====== El incremento atómico evita duplicados en registros simultáneos ======
  let contador;
  try {
    contador = await ContadorAsociado.findOneAndUpdate(
      { _id: 'ASOCIADOS' },
      { $inc: { ultimo: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: false, lean: true },
    );
  } catch (error) {
    // ====== Dos procesos podrían intentar crear el contador al mismo tiempo ======
    if (error.code !== 11000) throw error;
    contador = await ContadorAsociado.findOneAndUpdate(
      { _id: 'ASOCIADOS' }, { $inc: { ultimo: 1 } }, { new: true, lean: true },
    );
  }
  if (!Number.isSafeInteger(contador?.ultimo) || contador.ultimo <= 0) {
    throw new Error('No fue posible generar el correlativo del asociado');
  }
  return `AS${String(contador.ultimo).padStart(5, '0')}`;
}

async function sincronizarContadorAsociados(maximo) {
  if (!Number.isSafeInteger(maximo) || maximo < 0) throw new Error('Secuencia inválida');
  // ====== No retroceder el contador si el script se ejecuta nuevamente ======
  await ContadorAsociado.updateOne(
    { _id: 'ASOCIADOS' }, { $max: { ultimo: maximo } }, { upsert: true },
  );
}

module.exports = { siguienteCodigoAsociado, sincronizarContadorAsociados };
