const { response } = require("express");
const Usuario = require("../models/Usuario");
const bcrypt = require("bcryptjs");
const { generarJWT } = require("../helpers/jwt");
const RecurHumano = require("../models/Mantenimiento/RecHumano");
const { normalizarPermisosAcciones } = require("../utils/permisosAccion");

const crearUsuario = async (req, res = response) => {
  const { name, email, password, rol } = req.body;

  try {
    const usuario = await Usuario.findOne({ email });

    if (usuario) {
      return res.status(400).json({
        ok: false,
        msg: "Ya hay un usuario que existe con ese email",
      });
    }

    const dbUser = new Usuario(req.body);
    const numAletorio = bcrypt.genSaltSync();
    dbUser.password = bcrypt.hashSync(password, numAletorio);

    const token = await generarJWT(dbUser.id, dbUser.name, dbUser.rol);

    await dbUser.save();

    return res.status(201).json({
      ok: true,
      uid: dbUser.id,
      token,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: "Por favor hable con el administrador",
    });
  }
};

const loginUsuario = async (req, res) => {
  const { nombreUsuario, password } = req.body;

  try {
    const usuario = await RecurHumano.findOne({
      "datosLogueo.nombreUsuario": nombreUsuario,
    }).populate({
      path: "datosLogueo.rol",
      populate: {
        path: "rutasPermitidas",
      },
    });

    if (!usuario?.datosLogueo?.passwordHash) {
      return res
        .status(400)
        .json({ ok: false, msg: "Credenciales incorrectas" });
    }

    const esValido = bcrypt.compareSync(
      password,
      usuario.datosLogueo.passwordHash,
    );

    if (!esValido) {
      return res
        .status(400)
        .json({ ok: false, msg: "Credenciales incorrectas" });
    }

    if (!usuario.datosLogueo.estado) {
      return res.status(400).json({ ok: false, msg: "Acceso no autorizado" });
    }

    if (!usuario.datosLogueo.rol || usuario.datosLogueo.rol.estado === false) {
      return res.status(400).json({ ok: false, msg: "Rol no habilitado" });
    }

    const rutasPermitidas = usuario.datosLogueo.rol.rutasPermitidas.map((r) => ({
      codRuta: r.codRuta,
      nombreRuta: r.nombreRuta,
      urlRuta: r.urlRuta,
      iconoRuta: r.iconoRuta,
    }));

    const permisosAcciones = normalizarPermisosAcciones(
      usuario.datosLogueo.rol.permisosAcciones,
    );

    const token = await generarJWT(
      usuario.codRecHumano,
      usuario.datosLogueo.nombreUsuario,
      usuario.datosLogueo.rol.nombreRol,
      rutasPermitidas,
      permisosAcciones,
    );

    return res.json({
      ok: true,
      token,
      user: {
        nombreUsuario: usuario.datosLogueo.nombreUsuario,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Hable con el administrador",
    });
  }
};

module.exports = {
  crearUsuario,
  loginUsuario,
};
