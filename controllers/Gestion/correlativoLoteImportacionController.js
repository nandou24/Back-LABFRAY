const Correlativo = require('../../models/Gestion/correlativoLoteImportacion');

// ====== Fecha de registro en horario de Perú, no fecha programada ======
const fechaPeru = () => {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const obtener = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
  return `${obtener('year')}${obtener('month')}${obtener('day')}`;
};

// ====== Reservar un número único antes del primer bloque de 100 ======
const reservarCodigoLoteImportacion = async (_req, res) => {
  try {
    const fecha = fechaPeru();
    const contador = await Correlativo.findOneAndUpdate(
      { _id: fecha }, { $inc: { ultimo: 1 } },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    const importacionId = `${fecha}-${String(contador.ultimo).padStart(4, '0')}`;
    return res.status(201).json({ ok: true, importacionId });
  } catch (error) {
    console.error('Error reservando código de lote de importación:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo asignar el correlativo de importación.' });
  }
};

module.exports = { reservarCodigoLoteImportacion };
