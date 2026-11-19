const { response } = require("express");
const RecurHumano = require("../../models/Mantenimiento/RecHumano");
const {
  subirArchivoStorage,
  generarUrlTemporal,
  eliminarArchivo,
} = require("../../utils/aws/s3Storage");

const MAX_BYTES = 1200 * 1024;
const CODIGO_VALIDO = /^RH\d{4,10}$/;

// ====== Validación mínima de JPEG y dimensiones ======
const dimensionesJpeg = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 ||
      buffer[0] !== 0xff || buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
    return null;
  }
  let posicion = 2;
  while (posicion + 8 < buffer.length) {
    if (buffer[posicion] !== 0xff) return null;
    while (buffer[posicion] === 0xff) posicion++;
    const marca = buffer[posicion++];
    if (marca === 0xda || marca === 0xd9) break;
    if (marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) continue;
    if (posicion + 2 > buffer.length) return null;
    const longitud = buffer.readUInt16BE(posicion);
    if (longitud < 2 || posicion + longitud > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
         0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marca)) {
      if (longitud < 7) return null;
      const alto = buffer.readUInt16BE(posicion + 3);
      const ancho = buffer.readUInt16BE(posicion + 5);
      return ancho && alto && ancho <= 1600 && alto <= 1600 ? { ancho, alto } : null;
    }
    posicion += longitud;
  }
  return null;
};

// ====== Nunca devolver la clave privada de almacenamiento ======
const vistaPublica = (foto = {}) => ({
  disponible: Boolean(foto?.key),
  mimeType: foto?.mimeType ?? null,
  tamanoBytes: foto?.tamanoBytes ?? null,
  actualizadaEn: foto?.actualizadaEn ?? null,
});
const buscarRecurso = (codigo) => RecurHumano.findOne({ codRecHumano: codigo })
  .select("codRecHumano fotoPerfil.mimeType fotoPerfil.tamanoBytes fotoPerfil.actualizadaEn +fotoPerfil.key +fotoPerfil.versionId");
const validacionCodigo = (req, res) => {
  if (!CODIGO_VALIDO.test(String(req.params.codRecHumano ?? ""))) {
    res.status(400).json({ ok: false, msg: "Código de trabajador inválido" });
    return false;
  }
  return true;
};

const obtenerFotoPerfilRRHH = async (req, res = response) => {
  if (!validacionCodigo(req, res)) return;
  try {
    const recurso = await buscarRecurso(req.params.codRecHumano);
    if (!recurso) return res.status(404).json({ ok: false, msg: "Trabajador no encontrado" });
    if (!recurso.fotoPerfil?.key) {
      return res.status(404).json({ ok: false, msg: "Trabajador sin fotografía registrada" });
    }
    const url = await generarUrlTemporal(recurso.fotoPerfil.key, 300, recurso.fotoPerfil.versionId || undefined);
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, foto: vistaPublica(recurso.fotoPerfil), url });
  } catch (error) {
    console.error("Error consultando fotografía RRHH:", error?.message);
    return res.status(502).json({ ok: false, msg: "No se pudo consultar la fotografía" });
  }
};

const subirFotoPerfilRRHH = async (req, res = response) => {
  if (!validacionCodigo(req, res)) return;
  const archivo = req.file;
  if (!archivo || archivo.mimetype !== "image/jpeg" || archivo.size > MAX_BYTES ||
      !dimensionesJpeg(archivo.buffer)) {
    return res.status(422).json({ ok: false,
      msg: "Se requiere una fotografía JPEG válida de hasta 1,2 MB y 1600 × 1600 px" });
  }
  let subida;
  try {
    const codigo = req.params.codRecHumano;
    const anterior = await buscarRecurso(codigo);
    if (!anterior) return res.status(404).json({ ok: false, msg: "Trabajador no encontrado" });
    subida = await subirArchivoStorage({
      keyPrefix: `rrhh/${codigo}/perfil`, buffer: archivo.buffer, mimeType: "image/jpeg",
    });
    const filtro = { codRecHumano: codigo };
    if (anterior.fotoPerfil?.key) filtro["fotoPerfil.key"] = anterior.fotoPerfil.key;
    else filtro["fotoPerfil.key"] = { $exists: false };
    const metadata = {
      key: subida.key, versionId: subida.versionId || null,
      mimeType: "image/jpeg", tamanoBytes: archivo.size,
      actualizadaEn: new Date(), actualizadoPor: req.user?.uid ?? null,
    };
    const guardado = await RecurHumano.findOneAndUpdate(filtro,
      { $set: { fotoPerfil: metadata } }, { new: true, runValidators: false });
    if (!guardado) {
      await eliminarArchivo(subida.key, subida.versionId || undefined).catch(() => {});
      return res.status(409).json({ ok: false, msg: "La foto fue modificada en otra sesión; vuelve a cargar la ficha" });
    }
    if (anterior.fotoPerfil?.key) {
      try { await eliminarArchivo(anterior.fotoPerfil.key, anterior.fotoPerfil.versionId || undefined); }
      catch (error) { console.warn("Foto anterior pendiente de depuración S3:", error?.message); }
    }
    let url = null;
    try { url = await generarUrlTemporal(subida.key, 300, subida.versionId || undefined); }
    catch (error) { console.warn("Foto guardada sin URL inmediata:", error?.message); }
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, msg: "Fotografía registrada", foto: vistaPublica(metadata), url });
  } catch (error) {
    if (subida?.key) {
      await eliminarArchivo(subida.key, subida.versionId || undefined).catch(() => {});
    }
    console.error("Error subiendo fotografía RRHH:", error?.message);
    return res.status(500).json({ ok: false, msg: "No se pudo almacenar la fotografía" });
  }
};

const eliminarFotoPerfilRRHH = async (req, res = response) => {
  if (!validacionCodigo(req, res)) return;
  try {
    const recurso = await buscarRecurso(req.params.codRecHumano);
    if (!recurso) return res.status(404).json({ ok: false, msg: "Trabajador no encontrado" });
    if (!recurso.fotoPerfil?.key) return res.json({ ok: true, msg: "El trabajador no tiene fotografía" });
    const guardado = await RecurHumano.findOneAndUpdate({
      codRecHumano: req.params.codRecHumano, "fotoPerfil.key": recurso.fotoPerfil.key,
    }, { $unset: { fotoPerfil: "" } }, { runValidators: false });
    if (!guardado) return res.status(409).json({ ok: false, msg: "La foto cambió; vuelve a cargar la ficha" });
    try { await eliminarArchivo(recurso.fotoPerfil.key, recurso.fotoPerfil.versionId || undefined); }
    catch (error) { console.warn("Foto retirada con objeto S3 pendiente de borrar:", error?.message); }
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, msg: "Fotografía retirada" });
  } catch (error) {
    console.error("Error eliminando fotografía RRHH:", error?.message);
    return res.status(500).json({ ok: false, msg: "No se pudo retirar la fotografía" });
  }
};

module.exports = { obtenerFotoPerfilRRHH, subirFotoPerfilRRHH, eliminarFotoPerfilRRHH };
