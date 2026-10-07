const { response } = require("express");

// ====== Acceso independiente para Recepción ======
const validarRutaEntrega = (req, res = response, next) => {
  const rutas = Array.isArray(req.user?.rutasPermitidas)
    ? req.user.rutasPermitidas
    : [];

  const habilitado = rutas.some(
    (ruta) =>
      String(ruta?.urlRuta ?? "").trim().toLowerCase() ===
      "/pages/entrega-resultados",
  );

  if (!habilitado) {
    return res.status(403).json({
      ok: false,
      codigo: "RUTA_ENTREGA_REQUERIDA",
      msg: "No tiene permiso para consultar o entregar resultados",
    });
  }

  next();
};

module.exports = { validarRutaEntrega };
