const mongoose = require('mongoose');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const Sucursal = require('../../models/Mantenimiento/Sucursal');
const Rol = require('../../models/permisos/roles');
const { esRolSuperAdmin } = require('../../utils/rolGlobalRRHH');
const { actorGlobalAutorizado } = require('./administrarSuperAdminController');

const MAX_SEDES = 100;

// ====== IDs de referencia válidos y sin objetos enviados por el cliente ======
const validarId = (id) => {
  if (typeof id !== 'string' || !/^[\da-fA-F]{24}$/.test(id)) return null;
  return String(new mongoose.Types.ObjectId(id));
};

const idGuardado = (valor) => valor ? String(valor) : null;

// ====== Preparar catálogos sin exponer otros datos de personal ======
const cargarCatalogos = async () => {
  const [sucursales, roles] = await Promise.all([
    Sucursal.find({})
      .select('_id codigo nombre estado personal.recursoHumanoId personal.activo')
      .lean(),
    Rol.find({})
      .select('_id codRol nombreRol estado rutasPermitidas')
      .populate('rutasPermitidas', 'codRuta nombreRuta urlRuta')
      .lean(),
  ]);
  return { sucursales, roles };
};

// ====== Estado informativo; la autorización de operaciones llegará con JWT ======
const calcularEstado = (usuario, acceso, sucursal, rol) => {
  const cuentaHabilitada = usuario.usuarioSistema === true &&
    usuario.datosLogueo?.estado === true &&
    usuario.datosLogueo?.requiereCambioPassword !== true;
  const asignacion = sucursal?.personal?.find(
    (item) => String(item.recursoHumanoId) === String(usuario._id),
  );
  const asignacionActiva = asignacion?.activo === true;
  let estado = 'DOBLE_AUTORIZACION_CUMPLIDA';
  if (!cuentaHabilitada) estado = 'CUENTA_INACTIVA';
  else if (acceso.habilitado !== true) estado = 'SUSPENDIDO_RRHH';
  else if (!sucursal || sucursal.estado !== 'ACTIVA') estado = 'SEDE_INACTIVA';
  else if (esRolSuperAdmin(rol)) estado = 'ROL_GLOBAL_NO_PERMITIDO';
  else if (!rol || rol.estado !== true) estado = 'ROL_INACTIVO';
  else if (!asignacion) estado = 'PENDIENTE_ASIGNACION';
  else if (!asignacionActiva) estado = 'ASIGNACION_INACTIVA';
  return {
    estado,
    asignacionOperativa: !asignacion ? 'NO_ASIGNADA' :
      (asignacionActiva ? 'ACTIVA' : 'INACTIVA'),
    cumpleDobleAutorizacion: estado === 'DOBLE_AUTORIZACION_CUMPLIDA',
  };
};

// ====== Proyectar únicamente los datos necesarios para la pestaña RRHH ======
const construirRespuesta = (usuario, catalogos, permiteAdministrarGlobal = false) => {
  const sedesPorId = new Map(catalogos.sucursales.map((item) => [String(item._id), item]));
  const rolesPorId = new Map(catalogos.roles.map((item) => [String(item._id), item]));
  const accesos = Array.isArray(usuario.datosLogueo?.accesosSedes)
    ? usuario.datosLogueo.accesosSedes : [];
  const predeterminada = idGuardado(usuario.datosLogueo?.sedePredeterminadaRef);
  // ====== Mostrar el perfil global ya guardado sin crear ni migrar autorizaciones ======
  const rolLegacy = rolesPorId.get(idGuardado(usuario.datosLogueo?.rol));
  const perfilGlobalHeredado = esRolSuperAdmin(rolLegacy);
  return {
    ok: true,
    codRecHumano: usuario.codRecHumano,
    cuentaHabilitada: usuario.usuarioSistema === true && usuario.datosLogueo?.estado === true,
    alcanceAcceso: perfilGlobalHeredado ? 'GLOBAL_LEGACY' : 'POR_SEDE',
    puedeAdministrarSuperAdmin: permiteAdministrarGlobal,
    rolGlobal: perfilGlobalHeredado ? {
      _id: String(rolLegacy._id), codRol: rolLegacy.codRol,
      nombreRol: rolLegacy.nombreRol, estado: rolLegacy.estado === true, esGlobal: true,
      rutasPermitidas: (rolLegacy.rutasPermitidas ?? []).filter(Boolean).map((ruta) => ({
        codRuta: ruta.codRuta, nombreRuta: ruta.nombreRuta, urlRuta: ruta.urlRuta,
      })),
    } : null,
    versionAccesos: Number(usuario.datosLogueo?.versionAccesos ?? 0),
    sedePredeterminadaRef: predeterminada,
    configuracionLegacyPendiente: !perfilGlobalHeredado && accesos.length === 0 &&
      Boolean(usuario.datosLogueo?.rol || usuario.datosLogueo?.sedeAsignada),
    accesosSedes: accesos.map((acceso) => {
      const sucursalRef = idGuardado(acceso.sucursalRef);
      const rolRef = idGuardado(acceso.rolRef);
      const sucursal = sedesPorId.get(sucursalRef);
      const rol = rolesPorId.get(rolRef);
      return {
        sucursalRef,
        rolRef,
        habilitado: acceso.habilitado === true,
        predeterminada: predeterminada === sucursalRef,
        codigoSucursal: sucursal?.codigo ?? null,
        nombreSucursal: sucursal?.nombre ?? '(Sede no disponible)',
        nombreRol: rol?.nombreRol ?? '(Rol no disponible)',
        codRol: rol?.codRol ?? null,
        ...calcularEstado(usuario, acceso, sucursal, rol),
      };
    }),
    catalogos: {
      sucursales: catalogos.sucursales.map((item) => ({
        _id: String(item._id), codigo: item.codigo, nombre: item.nombre,
        estado: item.estado,
        asignacionOperativa: (() => {
          const persona = item.personal?.find((p) =>
            String(p.recursoHumanoId) === String(usuario._id));
          return !persona ? 'NO_ASIGNADA' : (persona.activo ? 'ACTIVA' : 'INACTIVA');
        })(),
      })),
      roles: catalogos.roles.map((item) => ({
        _id: String(item._id), codRol: item.codRol,
        nombreRol: item.nombreRol, estado: item.estado, esGlobal: esRolSuperAdmin(item),
        rutasPermitidas: (item.rutasPermitidas ?? []).filter(Boolean).map((ruta) => ({
          codRuta: ruta.codRuta, nombreRuta: ruta.nombreRuta, urlRuta: ruta.urlRuta,
        })),
      })),
    },
    // ====== Advertencia hasta integrar autorización por sede en validarJWT ======
    autorizacionEnVigor: false,
  };
};

const obtenerAccesosSedesRRHH = async (req, res) => {
  try {
    const usuario = await RecursoHumano.findOne({ codRecHumano: req.params.codRecHumano })
      .select('_id codRecHumano usuarioSistema datosLogueo.estado datosLogueo.requiereCambioPassword datosLogueo.rol datosLogueo.sedeAsignada datosLogueo.accesosSedes datosLogueo.sedePredeterminadaRef datosLogueo.versionAccesos')
      .lean();
    if (!usuario) return res.status(404).json({ ok: false, msg: 'Trabajador no encontrado' });
    const [catalogos, operador] = await Promise.all([
      cargarCatalogos(), actorGlobalAutorizado(req.user?.uid),
    ]);
    res.set('Cache-Control', 'no-store');
    return res.json(construirRespuesta(usuario, catalogos, Boolean(operador)));
  } catch (error) {
    console.error('Error consultando accesos RRHH:', error.message);
    return res.status(500).json({ ok: false, msg: 'No se pudo consultar los accesos por sede' });
  }
};

// ====== Guardado integral con validación y control de edición concurrente ======
const guardarAccesosSedesRRHH = async (req, res) => {
  const entrada = req.body;
  const clavesPermitidas = new Set([
    'versionAccesos', 'accesosSedes', 'sedePredeterminadaRef', 'confirmarRetiro',
  ]);
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
      Object.keys(entrada).some((clave) => !clavesPermitidas.has(clave))) {
    return res.status(422).json({ ok: false, msg: 'Solo se admiten campos de configuración por sede' });
  }
  if (!Number.isSafeInteger(entrada.versionAccesos) || entrada.versionAccesos < 0 ||
      !Array.isArray(entrada.accesosSedes) || entrada.accesosSedes.length > MAX_SEDES ||
      (entrada.confirmarRetiro !== undefined && typeof entrada.confirmarRetiro !== 'boolean')) {
    return res.status(422).json({ ok: false, msg: 'Lista o versión de accesos inválida' });
  }
  const vistos = new Set();
  const accesosNormalizados = [];
  for (const item of entrada.accesosSedes) {
    const sedeId = validarId(item?.sucursalRef);
    const rolId = validarId(item?.rolRef);
    if (!sedeId || !rolId || typeof item.habilitado !== 'boolean' || vistos.has(sedeId) ||
        !item || Object.keys(item).some((k) => !['sucursalRef', 'rolRef', 'habilitado'].includes(k))) {
      return res.status(422).json({ ok: false, msg: 'Sede duplicada o autorización inválida' });
    }
    vistos.add(sedeId);
    accesosNormalizados.push({ sucursalRef: sedeId, rolRef: rolId, habilitado: item.habilitado });
  }
  const sedePredeterminada = entrada.sedePredeterminadaRef === null ||
    entrada.sedePredeterminadaRef === undefined || entrada.sedePredeterminadaRef === ''
    ? null : validarId(entrada.sedePredeterminadaRef);
  if (entrada.sedePredeterminadaRef && !sedePredeterminada) {
    return res.status(422).json({ ok: false, msg: 'Sede predeterminada inválida' });
  }
  try {
    const usuario = await RecursoHumano.findOne({ codRecHumano: req.params.codRecHumano })
      .select('_id codRecHumano usuarioSistema datosLogueo.estado datosLogueo.requiereCambioPassword datosLogueo.rol datosLogueo.sedeAsignada datosLogueo.accesosSedes datosLogueo.sedePredeterminadaRef datosLogueo.versionAccesos')
      .lean();
    if (!usuario) return res.status(404).json({ ok: false, msg: 'Trabajador no encontrado' });
    const actualVersion = Number(usuario.datosLogueo?.versionAccesos ?? 0);
    if (entrada.versionAccesos !== actualVersion) {
      return res.status(409).json({ ok: false, msg: 'La configuración cambió; vuelva a cargar las sedes' });
    }
    const anteriores = Array.isArray(usuario.datosLogueo?.accesosSedes)
      ? usuario.datosLogueo.accesosSedes : [];
    if (anteriores.some((a) => !vistos.has(String(a.sucursalRef))) && entrada.confirmarRetiro !== true) {
      return res.status(409).json({ ok: false,
        msg: 'Está retirando sedes; confirme el retiro o suspenda su acceso sin borrar el rol' });
    }

    const catalogos = await cargarCatalogos();
    // ====== Los SuperAdmin heredados no administran su rol mediante sedes ======
    const rolLegacy = catalogos.roles.find((r) =>
      String(r._id) === idGuardado(usuario.datosLogueo?.rol));
    if (esRolSuperAdmin(rolLegacy)) {
      return res.status(409).json({ ok: false,
        msg: 'La cuenta conserva un SuperAdmin global. No se gestiona por sedes; espere el flujo protegido de RRHH-2D.' });
    }
    const sedesPorId = new Map(catalogos.sucursales.map((item) => [String(item._id), item]));
    const rolesPorId = new Map(catalogos.roles.map((item) => [String(item._id), item]));
    const rolesAnteriores = new Map(anteriores.map((a) => [String(a.sucursalRef), String(a.rolRef)]));
    for (const acceso of accesosNormalizados) {
      const sucursal = sedesPorId.get(acceso.sucursalRef);
      const rol = rolesPorId.get(acceso.rolRef);
      if (!sucursal || !rol) {
        return res.status(422).json({ ok: false, msg: 'Existe una sede o un rol no registrado' });
      }
      if (esRolSuperAdmin(rol)) {
        return res.status(422).json({ ok: false,
          msg: 'SuperAdmin es un perfil global y no se puede asignar como rol de sede' });
      }
      if (rol.estado !== true && rolesAnteriores.get(acceso.sucursalRef) !== acceso.rolRef) {
        return res.status(422).json({ ok: false,
          msg: 'No puede asignar un rol inactivo a una sede nueva' });
      }
    }
    if (sedePredeterminada) {
      const acceso = accesosNormalizados.find((a) => a.sucursalRef === sedePredeterminada);
      if (!acceso || !calcularEstado(usuario, acceso,
          sedesPorId.get(sedePredeterminada), rolesPorId.get(acceso.rolRef))
        .cumpleDobleAutorizacion) {
        return res.status(422).json({ ok: false,
          msg: 'La sede predeterminada requiere cuenta activa, rol vigente y doble autorización' });
      }
    }

    const fecha = new Date();
    const accesosParaGuardar = accesosNormalizados.map((item) => {
      const previo = anteriores.find((a) => String(a.sucursalRef) === item.sucursalRef);
      const sinCambios = previo && String(previo.rolRef) === item.rolRef &&
        previo.habilitado === item.habilitado;
      return {
        ...item,
        actualizadoEn: sinCambios ? (previo.actualizadoEn ?? fecha) : fecha,
        actualizadoPor: sinCambios ? (previo.actualizadoPor ?? '') : req.user.uid,
      };
    });
    const versionFilter = actualVersion === 0
      ? { $or: [{ 'datosLogueo.versionAccesos': 0 },
          { 'datosLogueo.versionAccesos': { $exists: false } }] }
      : { 'datosLogueo.versionAccesos': actualVersion };
    const actualizado = await RecursoHumano.findOneAndUpdate({
      codRecHumano: usuario.codRecHumano,
      ...versionFilter,
    }, {
      $set: {
        'datosLogueo.accesosSedes': accesosParaGuardar,
        'datosLogueo.sedePredeterminadaRef': sedePredeterminada,
        updatedBy: req.user.uid,
        usuarioActualizacion: req.user.nombreUsuario,
        fechaActualizacion: fecha,
      },
      $inc: { 'datosLogueo.versionAccesos': 1 },
    }, { new: true, runValidators: true,
      projection: '_id codRecHumano usuarioSistema datosLogueo.estado datosLogueo.requiereCambioPassword datosLogueo.rol datosLogueo.sedeAsignada datosLogueo.accesosSedes datosLogueo.sedePredeterminadaRef datosLogueo.versionAccesos',
    }).lean();
    if (!actualizado) {
      return res.status(409).json({ ok: false, msg: 'Conflicto de edición: recargue antes de guardar' });
    }
    res.set('Cache-Control', 'no-store');
    const operador = await actorGlobalAutorizado(req.user?.uid);
    return res.json(construirRespuesta(actualizado, catalogos, Boolean(operador)));
  } catch (error) {
    console.error('Error guardando accesos RRHH:', error.message);
    return res.status(500).json({ ok: false, msg: 'No se pudo guardar los accesos por sede' });
  }
};

module.exports = {
  obtenerAccesosSedesRRHH,
  guardarAccesosSedesRRHH,
};
