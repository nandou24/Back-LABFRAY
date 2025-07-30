const { response } = require("express");
const jwt = require("jsonwebtoken");

const validarJWT = (req, res = response, next) => {
  const token = req.header("x-token");

  // const { token } = req.body; //! Destructuracion ---_> const token = req.body.token

  console.log("El token esta " + token);

  if (!token) {
    return res.status(401).json({
      ok: false,
      msg: "Error en el token",
    });
  }

  try {
    const { uid, nombreUsuario } = jwt.verify(
      token,
      process.env.SECRET_JWT_SEED
    );
    req.user = { uid, nombreUsuario }; // Aquí puedes agregar más información si es necesario
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

//! Status HTTP
//! 400: Bad Request
//! 401: Unauthorized
//! 403: Forbidden
//! 404: Not Found
//! 500: Internal Server Error
//! 501: Not Implemented
//! 200 OK
//! 201 Created
//! 203 Non-Authoritative Information
