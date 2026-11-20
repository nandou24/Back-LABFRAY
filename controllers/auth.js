const { response } = require("express");
const Usuario = require("../models/Usuario");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generarJWT } = require("../helpers/jwt");
const RecurHumano = require("../models/Mantenimiento/RecHumano");
const { obtenerUsuarioSesion, obtenerSedesEfectivas, validarSedeActual, datosRolSesion,
  idValido } = require('../utils/contextoSesionSede');

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

// ====== Mostrar sedes habilitadas sin incluir documentos completos de roles ======
const resumirSedes = (sedes) => sedes.map(({ rol: _rol, ...datos }) => datos);

const datosSede = (sede) => ({
  _id: sede.sucursalRef,
  codigo: sede.codigo,
  nombre: sede.nombre,
});

const contextoOperativo = (sede) => {
  const { rutasPermitidas, permisosAcciones } = datosRolSesion(sede.rol);
  return {
    rol: sede.nombreRol,
    codRol: sede.codRol,
    rolRef: sede.rolRef,
    esSuperAdmin: sede.esSuperAdmin,
    sucursalOperativa: datosSede(sede),
    rutasPermitidas,
    permisosAcciones,
  };
};

// ====== Usar la sede predeterminada; si falta, preferir la principal ======
const elegirSedeInicial = (usuario, sedes, sucursalRef = null) => {
  if (sucursalRef) return sedes.find((sede) => sede.sucursalRef === sucursalRef) ?? null;
  const predeterminada = String(usuario.datosLogueo?.sedePredeterminadaRef ?? '');
  return sedes.find((sede) => sede.sucursalRef === predeterminada) ??
    sedes.find((sede) => sede.esPrincipal === true) ?? sedes[0] ?? null;
};

// ====== Un JWT da acceso a todas las sedes autorizadas, no a una sola ======
const emitirSesion = async (usuario, sede, sedes) => {
  const actual = contextoOperativo(sede);
  const token = await generarJWT(
    usuario.codRecHumano,
    usuario.datosLogueo.nombreUsuario,
    sede.nombreRol,
    actual.rutasPermitidas,
    actual.permisosAcciones,
    Number(usuario.datosLogueo.versionCredenciales ?? 0),
    {
      sucursalOperativaRef: sede.sucursalRef,
      rolRef: sede.rolRef,
      esSuperAdmin: sede.esSuperAdmin,
      sedesAutorizadas: sede.esSuperAdmin ? [] : sedes.map((item) => item.sucursalRef),
      versionAccesos: Number(usuario.datosLogueo.versionAccesos ?? 0),
    },
  );
  return {
    ok: true,
    token,
    user: {
      nombreUsuario: usuario.datosLogueo.nombreUsuario,
      rol: sede.nombreRol,
      codRol: sede.codRol,
      rolRef: sede.rolRef,
      esSuperAdmin: sede.esSuperAdmin,
      sucursalOperativa: datosSede(sede),
    },
    contextoOperativo: actual,
    sedesDisponibles: resumirSedes(sedes),
  };
};

const loginUsuario = async (req, res) => {
  const { nombreUsuario, password, sucursalRef } = req.body ?? {};
  if (typeof nombreUsuario !== 'string' || !nombreUsuario.trim() || nombreUsuario.length > 150 ||
      typeof password !== 'string' || !password) {
    return res.status(400).json({ ok: false, msg: 'Credenciales incorrectas' });
  }
  try {
    const usuario = await RecurHumano.findOne({
      'datosLogueo.nombreUsuario': nombreUsuario.trim(),
    });
    if (!usuario?.datosLogueo?.passwordHash ||
        !await bcrypt.compare(password, usuario.datosLogueo.passwordHash)) {
      return res.status(400).json({ ok: false, msg: 'Credenciales incorrectas' });
    }
    if (usuario.usuarioSistema !== true || usuario.datosLogueo.estado !== true) {
      return res.status(400).json({ ok: false, msg: 'Acceso no autorizado' });
    }
    // ====== El cambio obligatorio de contraseña conserva su token limitado ======
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
    const sedes = await obtenerSedesEfectivas(usuario);
    if (!sedes.length) {
      return res.status(403).json({ ok: false, codigo: 'SIN_SEDE_AUTORIZADA',
        msg: 'No tiene sedes autorizadas vigentes. Contacte al administrador.' });
    }
    if (sucursalRef !== undefined && !idValido(sucursalRef)) {
      return res.status(422).json({ ok: false, msg: 'Sede seleccionada inválida' });
    }
    const sede = elegirSedeInicial(usuario, sedes, sucursalRef);
    if (!sede) {
      return res.status(403).json({ ok: false, codigo: 'SEDE_NO_AUTORIZADA',
        msg: 'No tiene acceso a la sede solicitada' });
    }
    res.set('Cache-Control', 'no-store');
    return res.json(await emitirSesion(usuario, sede, sedes));
  } catch (error) {
    console.error('Error iniciando sesión multi-sede:', error?.message);
    return res.status(500).json({ ok: false, msg: 'No se pudo iniciar sesión' });
  }
};

// ====== Cambiar el contexto no requiere generar ni reemplazar el JWT ======
const cambiarSede = async (req, res) => {
  const { sucursalRef } = req.body ?? {};
  if (!idValido(sucursalRef)) {
    return res.status(422).json({ ok: false, msg: 'Sede seleccionada inválida' });
  }
  const autorizadoToken = req.user?.esSuperAdmin === true ||
    (req.user?.sedesAutorizadasJWT ?? []).includes(sucursalRef);
  if (!autorizadoToken) {
    return res.status(403).json({ ok: false, codigo: 'SEDE_NO_AUTORIZADA',
      msg: 'No tiene acceso a la sede solicitada' });
  }
  try {
    const usuario = await obtenerUsuarioSesion(req.user.uid);
    const sede = await validarSedeActual(usuario, sucursalRef);
    if (!sede) return res.status(403).json({ ok: false, codigo: 'SEDE_NO_AUTORIZADA',
      msg: 'No tiene acceso a la sede solicitada' });
    const sedes = await obtenerSedesEfectivas(usuario);
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, contextoOperativo: contextoOperativo(sede),
      sedeOperativaRef: sede.sucursalRef,
      // El frontend enviará este identificador en x-sucursal-operativa.
      sedesDisponibles: resumirSedes(sedes) });
  } catch (error) {
    console.error('Error cambiando contexto de sede:', error?.message);
    return res.status(500).json({ ok: false, msg: 'No se pudo cambiar el contexto de sede' });
  }
};

const consultarSedesSesion = async (req, res) => {
  try {
    const usuario = await obtenerUsuarioSesion(req.user.uid);
    const sedes = await obtenerSedesEfectivas(usuario);
    const sede = sedes.find((item) => item.sucursalRef === req.user.sucursalOperativaRef);
    if (!sede) return res.status(403).json({ ok: false, codigo: 'SEDE_NO_AUTORIZADA',
      msg: 'La sede de la sesión dejó de estar autorizada' });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true,
      sedeOperativaRef: sede.sucursalRef,
      contextoOperativo: contextoOperativo(sede),
      sedesDisponibles: resumirSedes(sedes),
    });
  } catch (error) {
    console.error('Error consultando sedes de sesión:', error?.message);
    return res.status(500).json({ ok: false, msg: 'No se pudieron consultar las sedes' });
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
  cambiarSede,
  consultarSedesSesion,
};
