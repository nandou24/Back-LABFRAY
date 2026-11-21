const mongoose = require('mongoose');
const RemisionSucursal = require('../../models/Gestion/RemisionSucursal');
const RecepcionMuestras = require('../../models/Gestion/RecepcionMuestras');
const Correlativo = require('../../models/Gestion/RecepcionMuestrasCorrelativo');
const RecHumano = require('../../models/Mantenimiento/RecHumano');
const Sucursal = require('../../models/Mantenimiento/Sucursal');
const Asociado = require('../../models/Mantenimiento/Asociado');
const Paciente = require('../../models/Mantenimiento/Paciente');
const PruebaLab = require('../../models/Mantenimiento/PruebaLab');
const Servicio = require('../../models/Mantenimiento/Servicio');
const TuboEnvase = require('../../models/Mantenimiento/TuboEnvase');
const { agregarCambio, crearEvento } = require('../../helpers/historialRecepcionMuestras');

const esId = valor => typeof valor === 'string' && mongoose.Types.ObjectId.isValid(valor) && /^[\da-f]{24}$/i.test(valor);
const texto = (valor, max = 200) => typeof valor === 'string' ? valor.trim().slice(0, max) : '';
const error = (res, estado, msg) => res.status(estado).json({ ok: false, msg });
const fallo = (msg, status = 422) => { const e = new Error(msg); e.status = status; throw e; };
const regExp = valor => new RegExp(valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const nombreHumano = humano => [humano.nombreRecHumano, humano.apePatRecHumano, humano.apeMatRecHumano]
  .filter(Boolean).map(v => texto(v, 100)).join(' ').trim();
const nombreAsociado = a => a.tipoPersona === 'JURIDICA'
  ? (a.nombreComercial || a.razonSocial || '')
  : [a.nombres, a.apellidoPaterno, a.apellidoMaterno].filter(Boolean).join(' ');
const scope = req => ({ sucursalReceptoraId: req.sucursalOperativa._id });

// ====== La sede operativa proviene del JWT validado y de su contexto actual ======
const contextoSucursal = async (req, res, next) => {
  try {
    const sedeRef = req.user?.sucursalOperativaRef;
    if (!esId(sedeRef)) return error(res, 403, 'No se pudo identificar la sede autorizada de la sesión');

    // ====== validarJWT ya comprobó el permiso por sede o el perfil global ======
    const [humano, sucursal] = await Promise.all([
      RecHumano.findOne({ codRecHumano: req.user.uid, 'datosLogueo.estado': true })
        .select('_id nombreRecHumano apePatRecHumano apeMatRecHumano').lean(),
      Sucursal.findOne({ _id: sedeRef, estado: 'ACTIVA' })
        .select('_id codigo nombre nombreCorto esPrincipal').lean(),
    ]);
    if (!humano) return error(res, 403, 'No existe un operador activo para esta sesión');
    if (!sucursal) return error(res, 403, 'La sucursal operativa no está activa o autorizada');

    req.sucursalOperativa = sucursal;
    req.nombreResponsableSucursal = nombreHumano(humano);
    if (!req.nombreResponsableSucursal) return error(res, 403, 'No se pudo identificar al responsable');
    next();
  } catch (e) {
    console.error('Contexto sucursal:', e);
    return error(res, 500, 'No se pudo validar la sucursal del operador');
  }
};

// ====== Consultas maestras con datos mínimos ======
const catalogos = async (req, res) => {
  try {
    const asociados = await Asociado.find({ activo: true, 'convenio.enviaMuestras': true })
      .select('codigoAsociado tipoPersona razonSocial nombreComercial nombres apellidoPaterno apellidoMaterno ruc numeroDocumento sedes._id sedes.nombre')
      .sort({ codigoAsociado: 1 }).limit(500).lean();
    return res.json({ ok: true, responsable: { nombreCompleto: req.nombreResponsableSucursal },
      sucursal: { _id: req.sucursalOperativa._id, codigo: req.sucursalOperativa.codigo,
        nombre: req.sucursalOperativa.nombreCorto || req.sucursalOperativa.nombre,
        esPrincipal: req.sucursalOperativa.esPrincipal === true },
      asociados: asociados.map(a => ({ _id: a._id, codigo: a.codigoAsociado || '',
        nombre: nombreAsociado(a), documento: a.ruc || a.numeroDocumento || '',
        sedes: (a.sedes || []).map(s => ({ _id: s._id, nombre: s.nombre })).filter(s => !!s._id) })) });
  } catch (e) { console.error('Catálogos sucursal:', e); return error(res, 500, 'No se pudo consultar asociados'); }
};

const catalogosRecipientes = async (req, res) => {
  try {
    const recipientes = await TuboEnvase.find({ estadoTuboEnvase: 'ACTIVO' })
      .select('_id codTuboEnvase nombreTuboEnvase color aditivo')
      .sort({ nombreTuboEnvase: 1 }).lean();
    return res.json({ ok: true, recipientes });
  } catch (e) { console.error('Recipientes sucursal:', e); return error(res, 500, 'No se pudo consultar recipientes'); }
};

const buscarPacientes = async (req, res) => {
  const search = texto(req.query.search, 90);
  if (search.length < 2) return res.json({ ok: true, pacientes: [] });
  try {
    const exp = regExp(search);
    const pacientes = await Paciente.find({ $or: [
      { hc: exp }, { nroDoc: exp }, { nombreCliente: exp },
      { apePatCliente: exp }, { apeMatCliente: exp },
    ] }).select('_id hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento phones')
      .sort({ updatedAt: -1 }).limit(15).lean();
    return res.json({ ok: true, pacientes: pacientes.map(p => ({
      _id: p._id, hc: p.hc || '', tipoDoc: p.tipoDoc || '', nroDoc: p.nroDoc || '',
      nombres: p.nombreCliente || '', apePat: p.apePatCliente || '', apeMat: p.apeMatCliente || '',
      sexo: p.sexoCliente || '', fechaNacimiento: p.fechaNacimiento || null,
      telefono: p.phones?.[0]?.phoneNumber || '',
    })) });
  } catch (e) { console.error('Pacientes sucursal:', e); return error(res, 500, 'No se pudo buscar pacientes'); }
};

// ====== Resolver convenios y paquetes hasta cuatro niveles como Central ======
const permitidasPorConvenio = async asociado => {
  const visitados = new Set();
  const pruebas = new Set();
  let pendientes = (asociado.serviciosHabilitados || []).map(s => String(s.servicioId || '')).filter(esId);
  for (let nivel = 0; nivel < 4 && pendientes.length; nivel++) {
    const ids = [...new Set(pendientes)].filter(id => !visitados.has(id));
    ids.forEach(id => visitados.add(id));
    if (!ids.length) break;
    const servicios = await Servicio.find({ _id: { $in: ids }, estadoServicio: true })
      .select('examenesServicio serviciosIncluidos').lean();
    pendientes = [];
    for (const s of servicios) {
      for (const e of (s.examenesServicio || [])) {
        if (e.tipoExamen === 'LABORATORIO' && e.referenciaId) pruebas.add(String(e.referenciaId));
      }
      for (const incluido of (s.serviciosIncluidos || [])) {
        if (incluido.servicioId && !visitados.has(String(incluido.servicioId))) pendientes.push(String(incluido.servicioId));
      }
    }
  }
  return pruebas;
};

const buscarPruebas = async (req, res) => {
  const asociadoId = texto(req.query.asociadoId, 40);
  if (!esId(asociadoId)) return error(res, 400, 'Seleccione un asociado');
  try {
    const asociado = await Asociado.findOne({ _id: asociadoId, activo: true,
      'convenio.enviaMuestras': true }).select('serviciosHabilitados').lean();
    if (!asociado) return error(res, 422, 'El asociado no está habilitado');
    const ids = [...await permitidasPorConvenio(asociado)];
    if (!ids.length) return res.json({ ok: true, pruebas: [] });
    const search = texto(req.query.search, 90);
    const filtro = { _id: { $in: ids }, estadoPrueba: 'ACTIVO' };
    if (search) filtro.$or = [{ codPruebaLab: regExp(search) }, { nombrePruebaLab: regExp(search) }];
    const pruebas = await PruebaLab.find(filtro).select('_id codPruebaLab nombrePruebaLab areaLab')
      .sort({ nombrePruebaLab: 1 }).limit(3000).lean();
    return res.json({ ok: true, pruebas });
  } catch (e) { console.error('Pruebas sucursal:', e); return error(res, 500, 'No se pudieron consultar las pruebas'); }
};

// ====== Validar todos los IDs y reconstruir snapshots desde maestros ======
const prepararDatos = async body => {
  const asociadoId = texto(body?.asociadoId, 40);
  const sedeId = texto(body?.sedeAsociadoId, 40);
  if (!esId(asociadoId) || !esId(sedeId)) fallo('Seleccione el asociado y su sede remitente');
  const asociado = await Asociado.findOne({ _id: asociadoId, activo: true,
    'convenio.enviaMuestras': true }).lean();
  if (!asociado) fallo('El asociado no está habilitado para enviar muestras');
  const sede = (asociado.sedes || []).find(s => String(s._id) === sedeId);
  if (!sede) fallo('La sede ya no pertenece al asociado seleccionado');
  const pacientesInput = body?.pacientes;
  const recipientesInput = body?.recipientes;
  if (!Array.isArray(pacientesInput) || pacientesInput.length < 1 || pacientesInput.length > 80 ||
      !Array.isArray(recipientesInput) || recipientesInput.length < 1 || recipientesInput.length > 150) {
    fallo('Registre de 1 a 80 pacientes y de 1 a 150 grupos de recipientes');
  }
  const claves = new Set();
  const pruebasIds = new Set();
  const idsPaciente = new Set();
  const pacientes = pacientesInput.map(p => {
    const clave = texto(p?.clave, 80);
    if (!clave || claves.has(clave) || !texto(p?.apePat, 80) || !texto(p?.nombres, 120) ||
        !Array.isArray(p.pruebas) || !p.pruebas.length || p.pruebas.length > 100) {
      fallo('Cada paciente debe identificarse y tener al menos una prueba');
    }
    claves.add(clave);
    const repetidas = new Set();
    const ids = p.pruebas.map(pr => {
      const id = texto(pr?._id, 40);
      if (!esId(id) || repetidas.has(id)) fallo('Hay pruebas inválidas o repetidas en una misma atención');
      repetidas.add(id); pruebasIds.add(id); return id;
    });
    const pacienteId = p.pacienteId ? texto(p.pacienteId, 40) : null;
    if (pacienteId && !esId(pacienteId)) fallo('Identificador de paciente inválido');
    if (pacienteId) idsPaciente.add(pacienteId);
    const fecha = p.fechaNacimiento ? new Date(p.fechaNacimiento) : null;
    const edad = p.edadDeclarada == null ? null : p.edadDeclarada;
    const unidad = p.unidadEdad || 'ANIOS';
    const limite = unidad === 'ANIOS' ? 130 : unidad === 'MESES' ? 1560 : 47482;
    if (!['ANIOS', 'MESES', 'DIAS'].includes(unidad) ||
        (fecha && (Number.isNaN(fecha.getTime()) || fecha > new Date())) ||
        (edad !== null && (!Number.isInteger(edad) || edad < 0 || edad > limite)) ||
        (!fecha && edad === null)) fallo('Fecha de nacimiento o edad declarada inválida');
    return { clave, pacienteId, hc: '', apePat: texto(p.apePat, 80), apeMat: texto(p.apeMat, 80),
      nombres: texto(p.nombres, 120), tipoDoc: texto(p.tipoDoc, 30), nroDoc: texto(p.nroDoc, 40),
      sexo: texto(p.sexo, 30), fechaNacimiento: fecha, edadDeclarada: edad,
      unidadEdad: unidad, telefono: texto(p.telefono, 30), pruebasIds: ids };
  });

  if (idsPaciente.size) {
    const maestros = await Paciente.find({ _id: { $in: [...idsPaciente] } })
      .select('_id hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento phones').lean();
    if (maestros.length !== idsPaciente.size) fallo('Un paciente seleccionado ya no existe');
    const porId = new Map(maestros.map(p => [String(p._id), p]));
    for (const p of pacientes) if (p.pacienteId) {
      const m = porId.get(p.pacienteId);
      p.hc = m.hc || ''; p.apePat = m.apePatCliente || ''; p.apeMat = m.apeMatCliente || '';
      p.nombres = m.nombreCliente || ''; p.tipoDoc = m.tipoDoc || ''; p.nroDoc = m.nroDoc || '';
      p.sexo = m.sexoCliente || ''; p.fechaNacimiento = m.fechaNacimiento || null;
      p.telefono = m.phones?.[0]?.phoneNumber || '';
      if (p.fechaNacimiento) p.edadDeclarada = null;
    }
  }
  // ====== No declarar como nuevo un DNI existente en el maestro ======
  const dniSinVinculo = [...new Set(pacientes
    .filter(p => !p.pacienteId && String(p.tipoDoc).toUpperCase() === 'DNI' && /^\d{8}$/.test(p.nroDoc))
    .map(p => p.nroDoc))];
  if (dniSinVinculo.length) {
    const existente = await Paciente.findOne({ tipoDoc: 'DNI', nroDoc: { $in: dniSinVinculo } })
      .select('_id hc nroDoc').lean();
    if (existente) fallo(`El DNI ${existente.nroDoc} ya pertenece a un paciente del maestro. Selecciónelo para registrar una atención independiente.`, 422);
  }

  const autorizadas = await permitidasPorConvenio(asociado);
  if ([...pruebasIds].some(id => !autorizadas.has(id))) fallo('El convenio del asociado no permite una o más pruebas');
  const pruebas = await PruebaLab.find({ _id: { $in: [...pruebasIds] }, estadoPrueba: 'ACTIVO' })
    .select('_id codPruebaLab nombrePruebaLab areaLab').lean();
  if (pruebas.length !== pruebasIds.size) fallo('Una prueba no está disponible actualmente');
  const mapaPruebas = new Map(pruebas.map(p => [String(p._id), p]));
  const pacientesFinal = pacientes.map(p => ({
    clave: p.clave, pacienteId: p.pacienteId, hc: p.hc,
    apePat: p.apePat, apeMat: p.apeMat, nombres: p.nombres,
    nombre: [p.apePat, p.apeMat, p.nombres].filter(Boolean).join(' '),
    tipoDoc: p.tipoDoc, nroDoc: p.nroDoc, sexo: p.sexo,
    fechaNacimiento: p.fechaNacimiento, edadDeclarada: p.edadDeclarada,
    unidadEdad: p.unidadEdad, telefono: p.telefono,
    pruebas: p.pruebasIds.map(id => ({ pruebaLabId: mapaPruebas.get(id)._id,
      codPruebaLab: mapaPruebas.get(id).codPruebaLab,
      nombrePruebaLab: mapaPruebas.get(id).nombrePruebaLab,
      areaLab: mapaPruebas.get(id).areaLab || '' })),
  }));
  const tuboIds = new Set();
  const etiquetas = new Set();
  for (const r of recipientesInput) {
    if (!claves.has(texto(r?.clavePaciente, 80)) || !esId(texto(r?.tuboEnvaseId, 40)) ||
        !Number.isInteger(r.cantidad) || r.cantidad < 1 || r.cantidad > 100) {
      fallo('Recipiente, paciente o cantidad inválidos');
    }
    tuboIds.add(r.tuboEnvaseId);
    const etiqueta = texto(r.codigoEtiqueta, 100).toUpperCase();
    if (etiqueta && etiquetas.has(etiqueta)) fallo('La etiqueta externa se repite dentro de esta remisión');
    if (etiqueta) etiquetas.add(etiqueta);
  }
  const tubos = await TuboEnvase.find({ _id: { $in: [...tuboIds] }, estadoTuboEnvase: 'ACTIVO' })
    .select('_id codTuboEnvase nombreTuboEnvase color').lean();
  if (tubos.length !== tuboIds.size) fallo('Hay un recipiente inexistente o inactivo');
  const mapaTubo = new Map(tubos.map(t => [String(t._id), t]));
  const recipientes = recipientesInput.map(r => {
    const fecha = r.fechaToma ? new Date(r.fechaToma) : null;
    if (fecha && (Number.isNaN(fecha.getTime()) || fecha > new Date())) fallo('Fecha de toma inválida');
    const t = mapaTubo.get(String(r.tuboEnvaseId));
    const _id = r.clave && esId(r.clave) ? r.clave : undefined;
    return { _id, clavePaciente: texto(r.clavePaciente, 80), tuboEnvaseId: t._id,
      tuboEnvaseCodigo: t.codTuboEnvase, tuboEnvaseNombre: t.nombreTuboEnvase,
      color: t.color || '', cantidadDeclarada: r.cantidad,
      codigoEtiqueta: texto(r.codigoEtiqueta, 100), fechaToma: fecha };
  });
  return { asociadoId: asociado._id, asociadoCodigo: asociado.codigoAsociado,
    asociadoNombre: nombreAsociado(asociado), sedeAsociadoId: sede._id,
    sedeAsociadoNombre: sede.nombre,
    prioridad: body.prioridad === 'URGENTE' ? 'URGENTE' : 'NORMAL',
    referenciaRemision: texto(body.referenciaRemision, 120),
    observacionRemision: texto(body.observacionRemision, 2000),
    pacientes: pacientesFinal, recipientes };
};

// ====== Recepción: lectura obligatoria o justificación sin medición ======
const prepararRecepcion = (body, req) => {
  const sinLectura = body?.sinLectura === true;
  const temperatura = body?.temperaturaC;
  const motivo = texto(body?.motivoSinLectura, 500);
  if (sinLectura ? ((temperatura != null && temperatura !== '') || !motivo)
    : (typeof temperatura !== 'number' || !Number.isFinite(temperatura))) {
    fallo('Registre temperatura numérica o motivo obligatorio de no medición');
  }
  const fechaTexto = texto(body?.fechaHoraRecepcion, 40);
  const fecha = fechaTexto ? new Date(fechaTexto) : null;
  if (!fecha || Number.isNaN(fecha.getTime()) || fecha.getUTCFullYear() < 2000 ||
      fecha.getTime() > Date.now() + 10 * 60000) fallo('Fecha y hora de recepción inválida');
  return { temperaturaC: sinLectura ? null : temperatura,
    motivoSinLectura: sinLectura ? motivo : '', fechaHora: fecha,
    fechaRegistroSistema: new Date(), responsableId: req.user.uid,
    usuarioResponsable: req.user.nombreUsuario || req.user.uid,
    nombreResponsable: req.nombreResponsableSucursal,
    observacion: texto(body?.incidencia, 2000) };
};

// ====== Cambios por clave estable; evita falsas diferencias por reordenar filas ======
const resumenPaciente = p => ({ clave: p.clave, pacienteId: String(p.pacienteId || ''),
  nombre: p.nombre, tipoDoc: p.tipoDoc, nroDoc: p.nroDoc, hc: p.hc,
  sexo: p.sexo, fechaNacimiento: p.fechaNacimiento, edadDeclarada: p.edadDeclarada,
  unidadEdad: p.unidadEdad, telefono: p.telefono,
  pruebas: (p.pruebas || []).map(t => `${t.codPruebaLab}: ${t.nombrePruebaLab}`) });
const resumenRecipiente = r => ({ clavePaciente: r.clavePaciente,
  recipiente: r.tuboEnvaseNombre, tuboEnvaseId: String(r.tuboEnvaseId || ''),
  cantidadDeclarada: r.cantidadDeclarada, codigoEtiqueta: r.codigoEtiqueta,
  fechaToma: r.fechaToma });
const compararListas = (cambios, titulo, anteriores, nuevos, clave, snapshot) => {
  const previos = new Map((anteriores || []).map(x => [clave(x), snapshot(x)]));
  const actuales = new Map((nuevos || []).map(x => [clave(x), snapshot(x)]));
  for (const [k, anterior] of previos) agregarCambio(cambios, `${titulo} ${k}`, anterior, actuales.get(k) || null);
  for (const [k, actual] of actuales) if (!previos.has(k)) agregarCambio(cambios, `${titulo} ${k}`, null, actual);
};
const construirCambios = (anterior, nuevo) => {
  const cambios = [];
  for (const campo of ['asociadoId', 'asociadoCodigo', 'asociadoNombre', 'sedeAsociadoId',
    'sedeAsociadoNombre', 'prioridad', 'referenciaRemision', 'observacionRemision']) {
    agregarCambio(cambios, campo, anterior?.[campo] || null, nuevo[campo]);
  }
  compararListas(cambios, 'Paciente', anterior?.pacientes, nuevo.pacientes,
    p => String(p.clave), resumenPaciente);
  compararListas(cambios, 'Recipiente', anterior?.recipientes, nuevo.recipientes,
    r => String(r._id), resumenRecipiente);
  const a = anterior?.recepcionSucursal || {};
  const b = nuevo.recepcionSucursal || {};
  for (const campo of ['temperaturaC', 'motivoSinLectura', 'fechaHora', 'observacion']) {
    agregarCambio(cambios, `Recepción: ${campo}`, a[campo], b[campo]);
  }
  return cambios;
};

// ====== Correlativo propio por sede y año, separado de la futura remisión ======
const siguienteCodigo = async (sucursal) => {
  // ====== Año corto sin tope de 99: 2026 -> 26, 2100 -> 100 ======
  const anio = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date())) - 2000;
  // ====== Admitir códigos maestros antiguos LF-0002 y nuevos LF2 sin migrar referencias ======
  const coincidencia = /^LF-?0*([1-9]\d*)$/i.exec(String(sucursal.codigo || '').trim());
  if (!coincidencia || anio < 0) fallo('La sede no tiene un código válido para emitir recepciones', 422);
  const sede = `LF${coincidencia[1]}`;
  const prefijo = `REC-${sede}-${anio}`;
  let correlativo;
  try {
    correlativo = await Correlativo.findOneAndUpdate({ _id: prefijo },
      { $inc: { secuencia: 1 } }, { upsert: true, new: true });
  } catch (e) {
    if (e.code !== 11000) throw e;
    correlativo = await Correlativo.findOneAndUpdate({ _id: prefijo },
      { $inc: { secuencia: 1 } }, { new: true });
  }
  if (!correlativo) throw new Error('No se pudo generar correlativo de recepción');
  return `${prefijo}-${correlativo.secuencia}`;
};

const respuestaError = (res, e, etiqueta) => {
  if (e.status) return error(res, e.status, e.message);
  if (e.code === 11000) return error(res, 409, 'Conflicto de código; revise el correlativo de remisiones');
  if (e.name === 'ValidationError' || e.name === 'CastError') return error(res, 422, e.message);
  console.error(etiqueta, e);
  return error(res, 500, 'No se pudo completar la operación');
};

const crear = async (req, res) => {
  if (req.sucursalOperativa?.esPrincipal === true) {
    return error(res, 403, 'La sede principal solo puede consultar remisiones de este módulo');
  }
  try {
    const datos = await prepararDatos(req.body || {});
    datos.recipientes.forEach(r => { r._id = new mongoose.Types.ObjectId(); });
    const recepcionSucursal = prepararRecepcion(req.body, req);
    const base = { ...datos, recepcionSucursal,
      sucursalReceptoraId: req.sucursalOperativa._id,
      sucursalReceptoraCodigo: req.sucursalOperativa.codigo,
      sucursalReceptoraNombre: req.sucursalOperativa.nombreCorto || req.sucursalOperativa.nombre,
      registradoPor: req.user.uid, usuarioRegistro: req.user.nombreUsuario || req.user.uid };
    // ====== Evitar colisiones entre recepciones e historiales anteriores ======
    for (let intento = 0; intento < 4; intento++) {
      const codigoRemision = await siguienteCodigo(req.sucursalOperativa);
      const repetidoCentral = await RecepcionMuestras.exists({ codigoEnvio: codigoRemision });
      const repetidoSucursal = await RemisionSucursal.exists({ codigoRemision });
      if (repetidoCentral || repetidoSucursal) continue;
      const evento = crearEvento({ accion: 'CREACION', usuario: req.user,
        nombreCompleto: req.nombreResponsableSucursal,
        cambios: construirCambios(null, base) });
      try {
        const remision = await RemisionSucursal.create({ ...base, codigoRemision, historialCambios: [evento] });
        return res.status(201).json({ ok: true, msg: 'Recepción registrada para envío posterior', remision });
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    return error(res, 409, 'No fue posible reservar un código de remisión no repetido');
  } catch (e) { return respuestaError(res, e, 'Crear remisión sucursal:'); }
};

const listar = async (req, res) => {
  try {
    const search = texto(req.query.search, 100);
    const filtro = { ...scope(req) };
    if (search) filtro.$or = [
      { codigoRemision: regExp(search) }, { asociadoCodigo: regExp(search) },
      { asociadoNombre: regExp(search) }, { referenciaRemision: regExp(search) },
      { 'pacientes.nroDoc': regExp(search) }, { 'pacientes.nombre': regExp(search) },
    ];
    const remisiones = await RemisionSucursal.find(filtro)
      .select('codigoRemision asociadoNombre asociadoCodigo sedeAsociadoNombre estado prioridad referenciaRemision createdAt pacientes.clave recipientes.cantidadDeclarada')
      .sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ ok: true, remisiones: remisiones.map(r => ({ _id: r._id,
      codigoRemision: r.codigoRemision, asociadoNombre: r.asociadoNombre,
      asociadoCodigo: r.asociadoCodigo, sedeAsociadoNombre: r.sedeAsociadoNombre,
      prioridad: r.prioridad, estado: r.estado, referenciaRemision: r.referenciaRemision,
      fechaRegistro: r.createdAt, pacientes: r.pacientes?.length || 0,
      recipientes: (r.recipientes || []).reduce((n, x) => n + x.cantidadDeclarada, 0),
    })) });
  } catch (e) { return respuestaError(res, e, 'Listar remisiones sucursal:'); }
};

const detalle = async (req, res) => {
  if (!esId(req.params.id)) return error(res, 400, 'Identificador inválido');
  try {
    const remision = await RemisionSucursal.findOne({ _id: req.params.id, ...scope(req) })
      .select('-historialCambios').lean();
    if (!remision) return error(res, 404, 'Remisión no encontrada en su sucursal');
    return res.json({ ok: true, remision });
  } catch (e) { return respuestaError(res, e, 'Detalle remisión sucursal:'); }
};

const edicion = async (req, res) => {
  if (!esId(req.params.id)) return error(res, 400, 'Identificador inválido');
  try {
    const r = await RemisionSucursal.findOne({ _id: req.params.id, ...scope(req) }).lean();
    if (!r) return error(res, 404, 'Remisión no encontrada en su sucursal');
    if (r.estado !== 'DISPONIBLE_PARA_ENVIO') return error(res, 409, 'La remisión ya no admite edición');
    const pacientes = (r.pacientes || []).map(p => ({
      clave: p.clave, pacienteId: p.pacienteId || null, hc: p.hc || '',
      tipoDoc: p.tipoDoc || '', nroDoc: p.nroDoc || '', nombres: p.nombres || '',
      apePat: p.apePat || '', apeMat: p.apeMat || '', sexo: p.sexo || '',
      fechaNacimiento: p.fechaNacimiento || null, edadDeclarada: p.edadDeclarada ?? null,
      unidadEdad: p.unidadEdad || 'ANIOS', telefono: p.telefono || '',
      pruebas: (p.pruebas || []).map(pr => ({ _id: pr.pruebaLabId,
        codPruebaLab: pr.codPruebaLab, nombrePruebaLab: pr.nombrePruebaLab, areaLab: pr.areaLab })),
    }));
    const recipientes = (r.recipientes || []).map(x => ({
      clave: String(x._id), clavePaciente: x.clavePaciente, tuboEnvaseId: x.tuboEnvaseId,
      cantidad: x.cantidadDeclarada, codigoEtiqueta: x.codigoEtiqueta,
      fechaToma: x.fechaToma || null,
    }));
    return res.json({ ok: true, version: r.__v, datos: {
      asociadoId: r.asociadoId, sedeAsociadoId: r.sedeAsociadoId, prioridad: r.prioridad,
      referenciaRemision: r.referenciaRemision, observacionRemision: r.observacionRemision,
      pacientes, recipientes, temperaturaC: r.recepcionSucursal.temperaturaC,
      sinLectura: r.recepcionSucursal.temperaturaC === null,
      motivoSinLectura: r.recepcionSucursal.motivoSinLectura,
      fechaHoraRecepcion: r.recepcionSucursal.fechaHora,
      incidencia: r.recepcionSucursal.observacion,
    } });
  } catch (e) { return respuestaError(res, e, 'Edición remisión sucursal:'); }
};

const actualizar = async (req, res) => {
  if (req.sucursalOperativa?.esPrincipal === true) {
    return error(res, 403, 'La sede principal solo puede consultar remisiones de este módulo');
  }
  if (!esId(req.params.id)) return error(res, 400, 'Identificador inválido');
  if (!Number.isSafeInteger(req.body?.version) || req.body.version < 0) return error(res, 400, 'Versión inválida');
  const motivoCambio = texto(req.body?.motivoCambio, 500);
  if (motivoCambio.length < 5) return error(res, 422, 'Indique el motivo de edición (mínimo 5 caracteres)');
  try {
    const anterior = await RemisionSucursal.findOne({ _id: req.params.id, ...scope(req) }).lean();
    if (!anterior) return error(res, 404, 'Remisión no encontrada en su sucursal');
    if (anterior.estado !== 'DISPONIBLE_PARA_ENVIO') return error(res, 409, 'La remisión ya no admite edición');
    if (anterior.__v !== req.body.version) return error(res, 409, 'Otro operador modificó la remisión; vuelva a cargarla');
    const datos = await prepararDatos(req.body);
    const nuevosIds = new Set();
    const previos = new Set((anterior.recipientes || []).map(r => String(r._id)));
    for (let i = 0; i < datos.recipientes.length; i++) {
      const clave = texto(req.body.recipientes[i]?.clave, 40);
      if (esId(clave)) {
        if (!previos.has(clave) || nuevosIds.has(clave)) fallo('La referencia de un recipiente no pertenece a esta remisión');
        nuevosIds.add(clave);
        datos.recipientes[i]._id = clave;
      } else datos.recipientes[i]._id = new mongoose.Types.ObjectId();
    }
    const lectura = prepararRecepcion(req.body, req);
    const previa = anterior.recepcionSucursal;
    // ====== No sustituir al responsable original si la lectura no cambió ======
    const mismaLectura = lectura.temperaturaC === previa.temperaturaC &&
      lectura.motivoSinLectura === previa.motivoSinLectura &&
      lectura.fechaHora.getTime() === new Date(previa.fechaHora).getTime();
    if (mismaLectura) {
      lectura.fechaRegistroSistema = previa.fechaRegistroSistema;
      lectura.responsableId = previa.responsableId;
      lectura.usuarioResponsable = previa.usuarioResponsable;
      lectura.nombreResponsable = previa.nombreResponsable;
    }
    const nuevos = { ...datos, recepcionSucursal: lectura };
    const cambios = construirCambios(anterior, nuevos);
    if (!cambios.length) return res.json({ ok: true, msg: 'Sin modificaciones', remision: anterior });
    const evento = crearEvento({ accion: 'EDICION', usuario: req.user,
      nombreCompleto: req.nombreResponsableSucursal, motivo: motivoCambio,
      versionAnterior: anterior.__v, cambios });
    const remision = await RemisionSucursal.findOneAndUpdate({ _id: req.params.id, ...scope(req),
      estado: 'DISPONIBLE_PARA_ENVIO', __v: anterior.__v }, {
      $set: { ...nuevos, actualizadoPor: req.user.uid },
      $push: { historialCambios: evento }, $inc: { __v: 1 },
    }, { new: true, runValidators: true, projection: { historialCambios: 0 } }).lean();
    if (!remision) return error(res, 409, 'La remisión cambió durante la edición; vuelva a cargarla');
    return res.json({ ok: true, msg: 'Recepción actualizada', remision });
  } catch (e) { return respuestaError(res, e, 'Editar remisión sucursal:'); }
};

const historial = async (req, res) => {
  if (!esId(req.params.id)) return error(res, 400, 'Identificador inválido');
  try {
    const r = await RemisionSucursal.findOne({ _id: req.params.id, ...scope(req) })
      .select('codigoRemision historialCambios').lean();
    if (!r) return error(res, 404, 'Remisión no encontrada en su sucursal');
    return res.json({ ok: true, codigoRemision: r.codigoRemision,
      historial: [...(r.historialCambios || [])].reverse() });
  } catch (e) { return respuestaError(res, e, 'Historial remisión sucursal:'); }
};

module.exports = { contextoSucursal, catalogos, catalogosRecipientes,
  buscarPacientes, buscarPruebas, crear, listar, detalle, edicion, actualizar, historial };
