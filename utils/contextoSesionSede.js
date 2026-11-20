const RecurHumano = require('../models/Mantenimiento/RecHumano');
const Sucursal = require('../models/Mantenimiento/Sucursal');
const Rol = require('../models/permisos/roles');
const { esRolSuperAdmin } = require('./rolGlobalRRHH');
const { normalizarPermisosAcciones } = require('./permisosAccion');

const idDe = (valor) => String(valor?._id ?? valor ?? '');
const idValido = (valor) => typeof valor === 'string' && /^[a-fA-F0-9]{24}$/.test(valor);

// ====== Cuenta habilitada para operar ======
const cuentaVigente = (usuario) => usuario?.usuarioSistema === true &&
  usuario.datosLogueo?.estado === true &&
  usuario.datosLogueo?.requiereCambioPassword !== true;

const obtenerUsuarioSesion = (codigo) => RecurHumano.findOne({ codRecHumano: codigo })
  .select('_id codRecHumano usuarioSistema datosLogueo.nombreUsuario datosLogueo.estado ' +
    'datosLogueo.requiereCambioPassword datosLogueo.versionCredenciales ' +
    'datosLogueo.versionAccesos datosLogueo.rol datosLogueo.accesosSedes ' +
    'datosLogueo.sedePredeterminadaRef')
  .lean();

const cargarRoles = (ids) => Rol.find({ _id: { $in: ids } })
  .select('_id codRol nombreRol estado rutasPermitidas permisosAcciones')
  .populate('rutasPermitidas', 'codRuta nombreRuta urlRuta iconoRuta')
  .lean();

const resumirSede = (sucursal, rol, esSuperAdmin) => ({
  sucursalRef: idDe(sucursal),
  codigo: sucursal.codigo,
  nombre: sucursal.nombre,
  esPrincipal: sucursal.esPrincipal === true,
  rolRef: idDe(rol),
  codRol: rol.codRol,
  nombreRol: rol.nombreRol,
  esSuperAdmin,
});

const asignacionActiva = (sucursal, usuario) =>
  (sucursal.personal ?? []).some((persona) =>
    idDe(persona.recursoHumanoId) === idDe(usuario) && persona.activo === true);

// ====== Resolución central sin concesiones automáticas desde rol o sede heredados ======
const obtenerSedesEfectivas = async (usuario) => {
  if (!cuentaVigente(usuario)) return [];
  const accesos = Array.isArray(usuario.datosLogueo?.accesosSedes)
    ? usuario.datosLogueo.accesosSedes : [];
  const idsRoles = [...new Set([
    idDe(usuario.datosLogueo?.rol),
    ...accesos.map((acceso) => idDe(acceso.rolRef)),
  ].filter((id) => idValido(id)))];
  const roles = await cargarRoles(idsRoles);
  const porRol = new Map(roles.map((rol) => [idDe(rol), rol]));
  const rolAnterior = porRol.get(idDe(usuario.datosLogueo?.rol));
  const esGlobal = esRolSuperAdmin(rolAnterior);

  if (esGlobal) {
    if (rolAnterior.estado !== true) return [];
    const sucursales = await Sucursal.find({ estado: 'ACTIVA' })
      .select('_id codigo nombre estado esPrincipal').sort({ codigo: 1 }).lean();
    return sucursales.map((sucursal) => ({
      ...resumirSede(sucursal, rolAnterior, true), rol: rolAnterior,
    }));
  }

  const habilitados = accesos.filter((acceso) => acceso.habilitado === true &&
    idValido(idDe(acceso.sucursalRef)) && idValido(idDe(acceso.rolRef)));
  if (!habilitados.length) return [];
  const sucursales = await Sucursal.find({
    _id: { $in: [...new Set(habilitados.map((acceso) => idDe(acceso.sucursalRef)))] },
    estado: 'ACTIVA',
  }).select('_id codigo nombre estado esPrincipal personal.recursoHumanoId personal.activo').lean();
  const porSede = new Map(sucursales.map((sucursal) => [idDe(sucursal), sucursal]));
  return habilitados.flatMap((acceso) => {
    const sucursal = porSede.get(idDe(acceso.sucursalRef));
    const rol = porRol.get(idDe(acceso.rolRef));
    if (!sucursal || !rol || rol.estado !== true || esRolSuperAdmin(rol) ||
        !asignacionActiva(sucursal, usuario)) return [];
    return [{ ...resumirSede(sucursal, rol, false), rol }];
  }).sort((a, b) => a.codigo.localeCompare(b.codigo));
};

// ====== La sede del JWT debe seguir autorizada en MongoDB ======
const validarSedeActual = async (usuario, sucursalRef) => {
  if (!cuentaVigente(usuario) || !idValido(sucursalRef)) return null;
  const accesos = Array.isArray(usuario.datosLogueo?.accesosSedes)
    ? usuario.datosLogueo.accesosSedes : [];
  const rolAnteriorId = idDe(usuario.datosLogueo?.rol);
  const rolAnterior = idValido(rolAnteriorId)
    ? await Rol.findById(rolAnteriorId).select('_id codRol nombreRol estado rutasPermitidas permisosAcciones')
      .populate('rutasPermitidas', 'codRuta nombreRuta urlRuta iconoRuta').lean()
    : null;
  const global = esRolSuperAdmin(rolAnterior);
  const acceso = global ? null : accesos.find((item) =>
    idDe(item.sucursalRef) === sucursalRef && item.habilitado === true);
  if (!global && !acceso) return null;
  const rol = global ? rolAnterior : await Rol.findById(acceso.rolRef)
    .select('_id codRol nombreRol estado rutasPermitidas permisosAcciones')
    .populate('rutasPermitidas', 'codRuta nombreRuta urlRuta iconoRuta').lean();
  if (!rol || rol.estado !== true || (!global && esRolSuperAdmin(rol))) return null;
  const sucursal = await Sucursal.findById(sucursalRef)
    .select('_id codigo nombre estado esPrincipal personal.recursoHumanoId personal.activo').lean();
  if (!sucursal || sucursal.estado !== 'ACTIVA' ||
      (!global && !asignacionActiva(sucursal, usuario))) return null;
  return { ...resumirSede(sucursal, rol, global), rol };
};

const datosRolSesion = (rol) => ({
  rutasPermitidas: (rol.rutasPermitidas ?? []).filter(Boolean).map((ruta) => ({
    codRuta: ruta.codRuta, nombreRuta: ruta.nombreRuta,
    urlRuta: ruta.urlRuta, iconoRuta: ruta.iconoRuta,
  })),
  permisosAcciones: normalizarPermisosAcciones(rol.permisosAcciones),
});

module.exports = {
  cuentaVigente, obtenerUsuarioSesion, obtenerSedesEfectivas,
  validarSedeActual, datosRolSesion, idValido,
};
