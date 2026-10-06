const jwt = require("jsonwebtoken");

const generarJWT = (
  uid,
  nombreUsuario,
  rol,
  rutasPermitidas,
  permisosAcciones = [],
) => {
  const payload = {
    uid,
    nombreUsuario,
    rol,
    rutasPermitidas,
    permisosAcciones,
  };

  return new Promise((resolve, reject) => {
    jwt.sign(
      payload,
      process.env.SECRET_JWT_SEED,
      {
        expiresIn: "24h",
      },
      (err, token) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          resolve(token);
        }
      },
    );
  });
};

module.exports = {
  generarJWT,
};
