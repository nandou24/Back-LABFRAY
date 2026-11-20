const { response } = require('express');
const jwt = require('jsonwebtoken');
const { obtenerUsuarioSesion, validarSedeActual, datosRolSesion, idValido } =
  require('../utils/contextoSesionSede');

const validarJWT = async (req, res = response, next) => {
  const token = req.header('x-token');
  if (!token) return res.status(401).json({ ok: false, msg: 'Token requerido' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.SECRET_JWT_SEED);
  } catch (_error) {
    return res.status(401).json({ ok: false, msg: 'Token inválido' });
  }
  if (payload.alcance === 'CAMBIO_PASSWORD') {
    return res.status(403).json({ ok: false, codigo: 'CAMBIO_PASSWORD_OBLIGATORIO',
      msg: 'Primero debe cambiar su contraseña' });
  }
  if (payload.alcance !== 'SESION_MULTI_SEDE' || !idValido(payload.sucursalOperativaRef) ||
      !idValido(payload.rolRef) || !Array.isArray(payload.sedesAutorizadas)) {
    return res.status(401).json({ ok: false, codigo: 'SESION_MULTI_SEDE_REQUERIDA',
      msg: 'Inicie sesión nuevamente para actualizar sus autorizaciones por sede' });
  }
  // ====== El header solo cambia el contexto: nunca concede autorizaciones ======
  const headerSede = req.header('x-sucursal-operativa');
  const sucursalRef = headerSede === undefined || headerSede === null || headerSede === ''
    ? payload.sucursalOperativaRef : headerSede;
  if (!idValido(sucursalRef)) {
    return res.status(422).json({ ok: false, codigo: 'SEDE_INVALIDA',
      msg: 'La sucursal operativa tiene un identificador inválido' });
  }
  try {
    const usuario = await obtenerUsuarioSesion(payload.uid);
    if (!usuario || usuario.usuarioSistema !== true || usuario.datosLogueo?.estado !== true) {
      return res.status(401).json({ ok: false, msg: 'Cuenta no habilitada' });
    }
    if (usuario.datosLogueo?.requiereCambioPassword === true) {
      return res.status(403).json({ ok: false, codigo: 'CAMBIO_PASSWORD_OBLIGATORIO',
        msg: 'Primero debe cambiar su contraseña' });
    }
    if (!Number.isSafeInteger(payload.versionCredenciales) ||
        !Number.isSafeInteger(payload.versionAccesos) ||
        payload.versionCredenciales !== Number(usuario.datosLogueo?.versionCredenciales ?? 0) ||
        payload.versionAccesos !== Number(usuario.datosLogueo?.versionAccesos ?? 0)) {
      return res.status(401).json({ ok: false, codigo: 'SESION_REVOCADA',
        msg: 'Los accesos cambiaron. Inicie sesión nuevamente' });
    }
    // ====== Un JWT ordinario solo puede seleccionar sedes incluidas al iniciar sesión ======
    const autorizadoToken = payload.esSuperAdmin === true ||
      payload.sedesAutorizadas.includes(sucursalRef);
    if (!autorizadoToken) {
      return res.status(403).json({ ok: false, codigo: 'SEDE_NO_AUTORIZADA',
        msg: 'La sede no está incluida en las autorizaciones de la sesión' });
    }
    const sede = await validarSedeActual(usuario, sucursalRef);
    if (!sede || sede.esSuperAdmin !== (payload.esSuperAdmin === true) ||
        (sede.esSuperAdmin && sede.rolRef !== payload.rolRef) ||
        (!sede.esSuperAdmin && !payload.sedesAutorizadas.includes(sucursalRef))) {
      return res.status(403).json({ ok: false, codigo: 'SEDE_NO_AUTORIZADA',
        msg: 'La sede o el rol ya no están autorizados' });
    }
    const { rutasPermitidas, permisosAcciones } = datosRolSesion(sede.rol);
    // ====== Rutas y acciones efectivas siempre se obtienen del rol vigente ======
    req.user = {
      uid: usuario.codRecHumano,
      nombreUsuario: usuario.datosLogueo.nombreUsuario,
      rol: sede.nombreRol,
      rolRef: sede.rolRef,
      codRol: sede.codRol,
      esSuperAdmin: sede.esSuperAdmin,
      sucursalOperativaRef: sede.sucursalRef,
      codigoSucursalOperativa: sede.codigo,
      sedeAsignada: sede.codigo,
      rutasPermitidas,
      permisosAcciones,
      sedesAutorizadasJWT: payload.sedesAutorizadas,
    };
    return next();
  } catch (error) {
    console.error('Error validando contexto de sede:', error?.message);
    return res.status(500).json({ ok: false, msg: 'No se pudo validar la sesión' });
  }
};

module.exports = { validarJWT };
