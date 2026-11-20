const jwt = require('jsonwebtoken');

const generarJWT = (
  uid,
  nombreUsuario,
  rol,
  rutasPermitidas,
  permisosAcciones = [],
  versionCredenciales = 0,
  contextoSede = null,
) => {
  const payload = {
    uid,
    nombreUsuario,
    rol,
    rutasPermitidas,
    permisosAcciones,
    versionCredenciales,
  };
  // ====== Una sola sesión válida para todas las sedes autorizadas ======
  if (contextoSede) {
    Object.assign(payload, {
      alcance: 'SESION_MULTI_SEDE',
      sucursalOperativaRef: contextoSede.sucursalOperativaRef,
      rolRef: contextoSede.rolRef,
      esSuperAdmin: contextoSede.esSuperAdmin === true,
      // Las sedes van por ID; roles y rutas siempre se consultan a MongoDB.
      sedesAutorizadas: contextoSede.sedesAutorizadas ?? [],
      versionAccesos: contextoSede.versionAccesos,
    });
  }
  return new Promise((resolve, reject) => {
    jwt.sign(payload, process.env.SECRET_JWT_SEED, { expiresIn: '24h' }, (error, token) => {
      if (error) reject(error);
      else resolve(token);
    });
  });
};

module.exports = { generarJWT };
