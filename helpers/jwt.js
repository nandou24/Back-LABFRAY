const jwt = require("jsonwebtoken");

const generarJWT = (uid, nombreUsuario, rol, rutasPermitidas) => {
  const payload = { uid, nombreUsuario, rol, rutasPermitidas };
  //Se utiliza promesa para poder retornar el valor en la función
  return new Promise((resolve, reject) => {
    jwt.sign(
      payload,
      process.env.SECRET_JWT_SEED,
      {
        // el token expira dentro de 24 horas
        expiresIn: "24h",
      },
      (err, token) => {
        if (err) {
          //mensaje de error
          console.log(err);
          reject(err);
        } else {
          //Se ejecuto correctamente
          resolve(token);
        }
      }
    );
  });
};

module.exports = {
  generarJWT,
};
