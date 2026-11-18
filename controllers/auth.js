const { response } = require("express");
const Usuario = require("../models/Usuario");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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

    if (usuario.usuarioSistema !== true || !usuario.datosLogueo.estado) {
      return res.status(400).json({ ok: false, msg: "Acceso no autorizado" });
    }

    if (!usuario.datosLogueo.rol || usuario.datosLogueo.rol.estado === false) {
      return res.status(400).json({ ok: false, msg: "Rol no habilitado" });
    }

    // ====== Inicio de sesión restringido para cambio obligatorio ======
    if (usuario.datosLogueo.requiereCambioPassword === true) {
      const vencimiento = usuario.datosLogueo.fechaExpiracionPasswordTemporal;
      if (vencimiento && (!Number.isFinite(new Date(vencimiento).getTime()) ||
          new Date(vencimiento).getTime() <= Date.now())) {
        return res.status(403).json({ ok: false,
          msg: 'Contraseña temporal vencida. Solicite un nuevo restablecimiento.' });
      }
      const token = jwt.sign({
        uid: usuario.codRecHumano,
        alcance: 'CAMBIO_PASSWORD',
        versionCredenciales: Number(usuario.datosLogueo.versionCredenciales ?? 0),
      }, process.env.SECRET_JWT_SEED, { expiresIn: '10m' });
      return res.json({ ok: true, requiereCambioPassword: true, token,
        user: { nombreUsuario: usuario.datosLogueo.nombreUsuario } });
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
      Number(usuario.datosLogueo.versionCredenciales ?? 0),
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

// ====== Cambio de contraseña usando exclusivamente token temporal ======
const cambiarPasswordObligatorio = async (req, res) => {
  const token = req.header('x-token');
  if (!token) return res.status(401).json({ ok: false, msg: 'Sesión temporal requerida' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.SECRET_JWT_SEED);
  } catch (_error) {
    return res.status(401).json({ ok: false, msg: 'Sesión temporal vencida; vuelva a ingresar' });
  }
  if (payload.alcance !== 'CAMBIO_PASSWORD') {
    return res.status(403).json({ ok: false, msg: 'Operación no permitida para esta sesión' });
  }

  const { passwordActual, passwordNueva } = req.body ?? {};
  if (typeof passwordActual !== 'string' || typeof passwordNueva !== 'string' ||
      passwordNueva.length < 12 || Buffer.byteLength(passwordNueva, 'utf8') > 72 ||
      passwordNueva === passwordActual || passwordNueva === '12345') {
    return res.status(422).json({ ok: false,
      msg: 'La nueva contraseña debe ser distinta y tener entre 12 y 72 bytes' });
  }
  try {
    const usuario = await RecurHumano.findOne({ codRecHumano: payload.uid });
    const version = Number(usuario?.datosLogueo?.versionCredenciales ?? 0);
    if (!usuario || !usuario.usuarioSistema || !usuario.datosLogueo?.estado ||
        !usuario.datosLogueo.requiereCambioPassword ||
        version !== Number(payload.versionCredenciales ?? -1)) {
      return res.status(401).json({ ok: false, msg: 'Sesión temporal no vigente' });
    }
    // ====== Las claves temporales nuevas caducan aunque el JWT siga vigente ======
    const vencimiento = usuario.datosLogueo.fechaExpiracionPasswordTemporal;
    if (vencimiento && (!Number.isFinite(new Date(vencimiento).getTime()) ||
        new Date(vencimiento).getTime() <= Date.now())) {
      return res.status(403).json({ ok: false,
        msg: 'Contraseña temporal vencida. Solicite un nuevo restablecimiento.' });
    }
    if (!await bcrypt.compare(passwordActual, usuario.datosLogueo.passwordHash ?? '')) {
      return res.status(400).json({ ok: false, msg: 'Contraseña temporal incorrecta' });
    }
    // ====== Operación condicional: invalida reutilización del token temporal ======
    const condicionVersion = version === 0
      ? { $or: [{ 'datosLogueo.versionCredenciales': 0 },
          { 'datosLogueo.versionCredenciales': { $exists: false } }] }
      : { 'datosLogueo.versionCredenciales': version };
    const actualizado = await RecurHumano.findOneAndUpdate({
      codRecHumano: payload.uid,
      usuarioSistema: true,
      'datosLogueo.estado': true,
      'datosLogueo.requiereCambioPassword': true,
      'datosLogueo.passwordHash': usuario.datosLogueo.passwordHash,
      ...(vencimiento ? { 'datosLogueo.fechaExpiracionPasswordTemporal': { $gt: new Date() } } : {}),
      ...condicionVersion,
    }, {
      $set: {
        'datosLogueo.passwordHash': await bcrypt.hash(passwordNueva, 10),
        'datosLogueo.requiereCambioPassword': false,
        'datosLogueo.fechaExpiracionPasswordTemporal': null,
        fechaActualizacion: new Date(),
      },
      $inc: { 'datosLogueo.versionCredenciales': 1 },
    }, { new: false });
    if (!actualizado) return res.status(409).json({ ok: false,
      msg: 'El cambio ya fue realizado o la sesión temporal fue reemplazada' });
    return res.json({ ok: true, msg: 'Contraseña actualizada. Inicie sesión nuevamente' });
  } catch (error) {
    console.error('Error cambiando contraseña obligatoria:', error?.message);
    return res.status(500).json({ ok: false, msg: 'No se pudo cambiar la contraseña' });
  }
};

module.exports = {
  crearUsuario,
  loginUsuario,
  cambiarPasswordObligatorio,
};
