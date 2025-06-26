const { response } = require("express");
const Usuario = require("../models/Usuario");
const bcrypt = require("bcryptjs");
const { generarJWT } = require("../helpers/jwt");
const RecurHumano = require("../models/RecHumano");

const crearUsuario = async (req, res = response) => {
  // console.log(req.body)
  const { name, email, password, rol } = req.body;
  // console.log(name, email, password, rol, "holaaa");

  try {
    //   console.log(name, email, password, rol, "holaaa");

    // verificar el email si es que existe
    const usuario = await Usuario.findOne({ email });

    if (usuario) {
      return res.status(400).json({
        ok: false,
        msg: "Ya hay un usuario que existe con ese email",
      });
    }

    //Crear usuario con el modelo
    const dbUser = new Usuario(req.body); //name, email, password

    //Hashear la contraseña mediante un hash
    const numAletorio = bcrypt.genSaltSync();
    dbUser.password = bcrypt.hashSync(password, numAletorio);

    //Generar el JWT
    const token = await generarJWT(dbUser.id, dbUser.name, dbUser.rol);
    //Crear usuario de base de datos
    await dbUser.save();
    // console.log(dbUser, "pasoo registro");
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      uid: dbUser.id,
      token: token,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: "Por favor hable con el administrador",
    });
  }
};

const loginUsuario = async (req, res) => {
  const { nombreUsuario, password } = req.body; //! DESTRUCTURACIÓN
  //* const email = req.body.email
  //* const password = req.body.password
  try {
    const usuario = await RecurHumano.findOne({
      "datosLogueo.nombreUsuario": nombreUsuario,
    }).populate({
      path: "datosLogueo.rol",
      populate: {
        path: "rutasPermitidas",
      },
    });

    const esValido = bcrypt.compareSync(
      password,
      usuario.datosLogueo.passwordHash
    );

    if (!esValido || !usuario) {
      return res
        .status(400)
        .json({ ok: false, msg: "Credenciales incorrectas" });
    }

    if (!usuario.datosLogueo || !usuario.datosLogueo.estado) {
      return res.status(400).json({ ok: false, msg: "Acceso no autorizado" });
    }

    const rutasPermitidas = usuario.datosLogueo.rol.rutasPermitidas.map(
      (r) => ({
        codRuta: r.codRuta,
        nombreRuta: r.nombreRuta,
        urlRuta: r.urlRuta,
        iconoRuta: r.iconoRuta,
      })
    );

    //Generar el jwt
    const token = await generarJWT(
      usuario.codRecHumano,
      usuario.datosLogueo.nombreUsuario,
      usuario.datosLogueo.rol.nombreRol,
      rutasPermitidas
    );
    // console.log('IDUSUARIO'+dbUser.id);
    //Respuesta del servicio
    return res.json({
      ok: true,
      token, //! token : token
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      //! 500: FALLAS EN EL SERVIDOR
      ok: false,
      msg: "Hable con el administrador",
    });
  }
};

module.exports = {
  crearUsuario,
  loginUsuario,
};
