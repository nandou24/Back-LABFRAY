const { response } = require('express');
const jwt = require('jsonwebtoken');
const RecurHumano = require('../models/Mantenimiento/RecHumano');

const validarJWT = async (req, res = response, next) => {
  const token = req.header('x-token');
  if (!token) return res.status(401).json({ ok: false, msg: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.SECRET_JWT_SEED);
    // ====== El token temporal no permite acceder a módulos ======
    if (payload.alcance === 'CAMBIO_PASSWORD') {
      return res.status(403).json({ ok: false, codigo: 'CAMBIO_PASSWORD_OBLIGATORIO',
        msg: 'Primero debe cambiar su contraseña' });
    }

    // ====== Validar cuenta y versión para revocar tokens anteriores ======
    const usuario = await RecurHumano.findOne({ codRecHumano: payload.uid })
      .select('usuarioSistema datosLogueo.estado datosLogueo.requiereCambioPassword datosLogueo.versionCredenciales')
      .lean();
    if (!usuario || usuario.usuarioSistema !== true || usuario.datosLogueo?.estado !== true) {
      return res.status(401).json({ ok: false, msg: 'Cuenta no habilitada' });
    }
    if (usuario.datosLogueo?.requiereCambioPassword === true) {
      return res.status(403).json({ ok: false, codigo: 'CAMBIO_PASSWORD_OBLIGATORIO',
        msg: 'Primero debe cambiar su contraseña' });
    }
    const version = Number(usuario.datosLogueo?.versionCredenciales ?? 0);
    if (Number(payload.versionCredenciales ?? 0) !== version) {
      return res.status(401).json({ ok: false, msg: 'Sesión revocada; vuelva a iniciar sesión' });
    }
    req.user = {
      uid: payload.uid,
      nombreUsuario: payload.nombreUsuario,
      rol: payload.rol ?? null,
      rutasPermitidas: Array.isArray(payload.rutasPermitidas) ? payload.rutasPermitidas : [],
      permisosAcciones: Array.isArray(payload.permisosAcciones) ? payload.permisosAcciones : [],
    };
    next();
  } catch (_error) {
    return res.status(401).json({ ok: false, msg: 'Token inválido' });
  }
};

module.exports = { validarJWT };
