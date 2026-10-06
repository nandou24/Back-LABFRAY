const { response } = require("express");

// ====== Validar permiso de acción ======

const validarPermisoAccion = (codigoPermiso) => {
  return (req, res = response, next) => {
    const permisos = Array.isArray(req.user?.permisosAcciones)
      ? req.user.permisosAcciones
      : [];

    if (!permisos.includes(codigoPermiso)) {
      return res.status(403).json({
        ok: false,
        codigo: "PERMISO_ACCION_REQUERIDO",
        permisoRequerido: codigoPermiso,
        msg: "No posee permiso para realizar esta acción",
      });
    }

    next();
  };
};

module.exports = {
  validarPermisoAccion,
};
