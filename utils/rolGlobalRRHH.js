// ====== Identidad del rol global existente: código estable, no nombre visible ======
const CODIGO_SUPERADMIN = 'ROL002';

const esRolSuperAdmin = (rol) =>
  Boolean(rol && String(rol.codRol || '').trim().toUpperCase() === CODIGO_SUPERADMIN);

module.exports = { CODIGO_SUPERADMIN, esRolSuperAdmin };
