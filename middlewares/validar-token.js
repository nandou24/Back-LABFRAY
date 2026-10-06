const { response } = require("express");
const jwt = require("jsonwebtoken");

const validarJWT = (req, res = response, next) => {
  const token = req.header("x-token");

  if (!token) {
    return res.status(401).json({
      ok: false,
      msg: "Error en el token",
    });
  }

  try {
    const {
      uid,
      nombreUsuario,
      rol = null,
      rutasPermitidas = [],
      permisosAcciones = [],
    } = jwt.verify(token, process.env.SECRET_JWT_SEED);

    req.user = {
      uid,
      nombreUsuario,
      rol,
      rutasPermitidas: Array.isArray(rutasPermitidas) ? rutasPermitidas : [],
      permisosAcciones: Array.isArray(permisosAcciones) ? permisosAcciones : [],
    };

    next();
  } catch (error) {
    console.log("Error al verificar el token: ", error);

    return res.status(401).json({
      ok: false,
      msg: "Token inválido",
    });
  }
};

module.exports = {
  validarJWT,
};
