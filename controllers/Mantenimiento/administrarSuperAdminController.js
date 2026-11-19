const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const Rol = require('../../models/permisos/roles');
const BloqueoGlobal = require('../../models/Mantenimiento/BloqueoAdministracionGlobal');
const { esRolSuperAdmin } = require('../../utils/rolGlobalRRHH');

// ====== Protección de rol global independiente de la información del JWT ======
const esCuentaGlobalVigente = (usuario) =>
  usuario?.usuarioSistema === true && usuario.datosLogueo?.estado === true &&
  usuario.datosLogueo?.requiereCambioPassword !== true &&
  esRolSuperAdmin(usuario.datosLogueo?.rol) &&
  usuario.datosLogueo.rol.estado === true;

const rutaRRHH = (url) => String(url ?? '').toLowerCase().split('?')[0] === '/pages/recursohumano';

const actorGlobalAutorizado = async (codigo) => {
  const actor = await RecursoHumano.findOne({ codRecHumano: codigo })
    .select('+datosLogueo.passwordHash codRecHumano usuarioSistema datosLogueo.estado datosLogueo.requiereCambioPassword datosLogueo.rol datosLogueo.passwordHash')
    .populate({ path: 'datosLogueo.rol', select: 'codRol estado rutasPermitidas',
      populate: { path: 'rutasPermitidas', select: 'urlRuta' } });
  if (!esCuentaGlobalVigente(actor)) return null;
  const rutas = actor.datosLogueo.rol.rutasPermitidas ?? [];
  if (!rutas.some((r) => rutaRRHH(r?.urlRuta))) return null;
  return actor;
};

// ====== Mutex persistente: evita el retiro simultáneo de los últimos administradores ======
const obtenerBloqueo = async () => {
  try {
    await BloqueoGlobal.updateOne({ _id: 'SUPERADMIN' },
      { $setOnInsert: { token: '', hasta: new Date(0) } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const token = crypto.randomUUID();
  const ahora = new Date();
  const bloqueado = await BloqueoGlobal.findOneAndUpdate({ _id: 'SUPERADMIN', hasta: { $lte: ahora } },
    { $set: { token, hasta: new Date(ahora.getTime() + 30000) } }, { new: true }).lean();
  return bloqueado?.token === token ? token : null;
};

const liberarBloqueo = async (token) => {
  await BloqueoGlobal.updateOne({ _id: 'SUPERADMIN', token },
    { $set: { token: '', hasta: new Date(0) } });
};

// ====== Conceder o retirar el rol global mediante reautenticación ======
const administrarSuperAdmin = async (req, res) => {
  const entrada = req.body;
  const codigo = String(req.params.codRecHumano ?? '').trim();
  const campos = new Set(['accion', 'contrasenaAdministrador', 'confirmacionCodigo', 'rolReemplazoRef']);
  if (!/^RH\d{4,}$/i.test(codigo) || !entrada || typeof entrada !== 'object' ||
      Array.isArray(entrada) || Object.keys(entrada).some((k) => !campos.has(k)) ||
      !['ASIGNAR', 'RETIRAR'].includes(entrada.accion) ||
      entrada.confirmacionCodigo !== codigo ||
      typeof entrada.contrasenaAdministrador !== 'string' ||
      !entrada.contrasenaAdministrador ||
      Buffer.byteLength(entrada.contrasenaAdministrador, 'utf8') > 72 ||
      (entrada.accion === 'ASIGNAR' && entrada.rolReemplazoRef !== undefined) ||
      (entrada.accion === 'RETIRAR' && !mongoose.isValidObjectId(entrada.rolReemplazoRef))) {
    return res.status(422).json({ ok: false, msg: 'Solicitud o confirmación inválida' });
  }
  res.set('Cache-Control', 'no-store');
  let bloqueo = null;
  try {
    const actor = await actorGlobalAutorizado(req.user?.uid);
    if (!actor) return res.status(403).json({ ok: false, msg: 'Operación reservada a SuperAdmin vigente' });
    if (!await bcrypt.compare(entrada.contrasenaAdministrador, actor.datosLogueo.passwordHash ?? '')) {
      return res.status(403).json({ ok: false, msg: 'No se pudo confirmar la identidad del administrador' });
    }
    // ====== No permitir retirar el propio privilegio durante la administración ======
    if (entrada.accion === 'RETIRAR' && String(actor.codRecHumano) === codigo) {
      return res.status(403).json({ ok: false, msg: 'No puede retirar su propio rol global' });
    }
    bloqueo = await obtenerBloqueo();
    if (!bloqueo) return res.status(409).json({ ok: false,
      msg: 'Otra administración de SuperAdmin está en curso. Intente nuevamente.' });
    // ====== Revalidar el operador después de obtener el bloqueo ======
    if (!await actorGlobalAutorizado(req.user?.uid)) {
      return res.status(403).json({ ok: false,
        msg: 'Su privilegio global cambió. Vuelva a iniciar sesión.' });
    }

    const rolGlobal = await Rol.findOne({ codRol: 'ROL002', estado: true }).select('_id codRol estado').lean();
    if (!rolGlobal) return res.status(409).json({ ok: false, msg: 'El rol global ROL002 no está habilitado' });
    const usuario = await RecursoHumano.findOne({ codRecHumano: codigo })
      .select('codRecHumano usuarioSistema datosLogueo.estado datosLogueo.requiereCambioPassword datosLogueo.passwordHash datosLogueo.rol datosLogueo.versionCredenciales datosLogueo.versionAccesos')
      .lean();
    if (!usuario) return res.status(404).json({ ok: false, msg: 'Trabajador no encontrado' });
    if (usuario.usuarioSistema !== true || usuario.datosLogueo?.estado !== true || !usuario.datosLogueo?.passwordHash) {
      return res.status(422).json({ ok: false, msg: 'Primero habilite la cuenta y establezca sus credenciales' });
    }
    const anteriorId = String(usuario.datosLogueo?.rol ?? '');
    const yaEsGlobal = anteriorId === String(rolGlobal._id);
    if ((entrada.accion === 'ASIGNAR' && yaEsGlobal) ||
        (entrada.accion === 'RETIRAR' && !yaEsGlobal)) {
      return res.status(409).json({ ok: false, msg: 'El rol del trabajador cambió. Actualice su ficha.' });
    }

    let nuevoRolId = rolGlobal._id;
    if (entrada.accion === 'RETIRAR') {
      const activos = await RecursoHumano.countDocuments({ usuarioSistema: true,
        'datosLogueo.estado': true, 'datosLogueo.requiereCambioPassword': { $ne: true },
        'datosLogueo.rol': rolGlobal._id });
      if (activos <= 1) return res.status(409).json({ ok: false,
        msg: 'No puede retirar al último SuperAdmin activo del sistema' });
      const rolOrdinario = await Rol.findById(entrada.rolReemplazoRef).select('_id codRol estado').lean();
      if (!rolOrdinario || rolOrdinario.estado !== true || esRolSuperAdmin(rolOrdinario)) {
        return res.status(422).json({ ok: false, msg: 'Seleccione un rol ordinario habilitado' });
      }
      nuevoRolId = rolOrdinario._id;
    }

    const version = Number(usuario.datosLogueo?.versionCredenciales ?? 0);
    const condicionVersion = version === 0
      ? { $or: [{ 'datosLogueo.versionCredenciales': 0 },
        { 'datosLogueo.versionCredenciales': { $exists: false } }] }
      : { 'datosLogueo.versionCredenciales': version };
    // ====== Rol, revocación de tokens y auditoría se modifican de manera atómica ======
    const resultado = await RecursoHumano.findOneAndUpdate({
      _id: usuario._id, 'datosLogueo.rol': usuario.datosLogueo.rol,
      usuarioSistema: true, 'datosLogueo.estado': true,
      ...condicionVersion,
    }, {
      $set: { 'datosLogueo.rol': nuevoRolId, updatedBy: String(req.user.uid),
        usuarioActualizacion: String(req.user.nombreUsuario ?? ''), fechaActualizacion: new Date() },
      $inc: { 'datosLogueo.versionCredenciales': 1 },
      $push: { 'datosLogueo.auditoriaGlobal': {
        accion: entrada.accion, rolAnteriorRef: usuario.datosLogueo.rol,
        rolNuevoRef: nuevoRolId, actorCodigo: String(actor.codRecHumano),
        realizadoEn: new Date(),
      } },
    }, { new: false });
    if (!resultado) return res.status(409).json({ ok: false,
      msg: 'Los datos del trabajador cambiaron. Recargue e intente de nuevo.' });
    return res.json({ ok: true, codRecHumano: codigo, rolAsignadoRef: String(nuevoRolId),
      msg: entrada.accion === 'ASIGNAR' ? 'SuperAdmin asignado. La sesión anterior fue revocada.' :
        'SuperAdmin retirado. La sesión anterior fue revocada.' });
  } catch (error) {
    console.error('Error administrando SuperAdmin:', error?.message);
    return res.status(500).json({ ok: false, msg: 'No se pudo actualizar el rol global' });
  } finally {
    if (bloqueo) {
      try { await liberarBloqueo(bloqueo); }
      catch (error) { console.error('No se pudo liberar el bloqueo SuperAdmin:', error?.message); }
    }
  }
};

module.exports = { administrarSuperAdmin, actorGlobalAutorizado };
