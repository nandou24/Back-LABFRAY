const mongoose = require('mongoose');
const RecepcionMuestras = require('../../models/Gestion/RecepcionMuestras');
const Correlativo = require('../../models/Gestion/RecepcionMuestrasCorrelativo');
const MuestraLaboratorio = require('../../models/Gestion/MuestraLaboratorio');
const SolicitudAtencion = require('../../models/Gestion/SolicitudAtencion');
const Asociado = require('../../models/Mantenimiento/Asociado');
const Sucursal = require('../../models/Mantenimiento/Sucursal');
const RecHumano = require('../../models/Mantenimiento/RecHumano');
const Paciente = require('../../models/Mantenimiento/Paciente');
const PruebaLab = require('../../models/Mantenimiento/PruebaLab');
const Servicio = require('../../models/Mantenimiento/Servicio');
const TipoMuestra = require('../../models/Mantenimiento/TipoMuestra');
const TuboEnvase = require('../../models/Mantenimiento/TuboEnvase');

const estadosTransportables = ['RECOLECTADA', 'RECEPCIONADA', 'ACEPTADA'];
const estadosPorRecibir = ['PENDIENTE_RECEPCION', 'DESPACHADO'];
const estadosEditablesCentral = ['REGISTRADA_CENTRAL', 'PENDIENTE_RECEPCION'];
const esId = valor => typeof valor === 'string' && /^[0-9a-fA-F]{24}$/.test(valor) && mongoose.Types.ObjectId.isValid(valor);
const limpio = (valor, max = 300) => typeof valor === 'string' ? valor.trim().slice(0, max) : '';
const expresion = valor => new RegExp(valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const error = (res, status, msg) => res.status(status).json({ ok: false, msg });

// ====== Diferenciar un índice obsoleto de una duplicidad real de código ======
const responderIndiceDuplicado = (res, e) => {
  if (e?.code !== 11000) return false;
  const campos = Object.keys(e.keyPattern || e.keyValue || {});
  const detalle = `${e.index || ''} ${e.message || ''}`;
  const indiceClinico = campos.includes('remisiones.lineas.muestraLaboratorioId') ||
    /una_remision_por_muestra_fisica|remisiones\.lineas\.muestraLaboratorioId/.test(detalle);
  if (indiceClinico) {
    console.error('Índice único de muestra clínica incompatible con remisiones declarativas:', {
      indice: e.index || '', campos: e.keyPattern || {},
    });
    error(res, 503, 'La base de datos conserva un índice único antiguo que impide registrar remisiones declarativas. No es un paciente ni un recipiente duplicado. Solicite revisar los índices de RecepcionMuestras.');
    return true;
  }
  const codigoDuplicado = campos.includes('codigoEnvio') || /codigoEnvio_1/.test(detalle);
  if (codigoDuplicado) {
    error(res, 409, 'El código correlativo ya existe. Verifique el contador anual de remisiones antes de volver a registrar.');
    return true;
  }
  console.error('Índice único inesperado al guardar remisión:', { indice: e.index || '', campos: e.keyPattern || {} });
  error(res, 409, 'Hay un conflicto con un índice único de MongoDB. Revise el índice indicado en el servidor; no se puede atribuir a paciente o recipiente.');
  return true;
};

// ====== Correlativo atómico anual; no renumerar códigos históricos CNT ======
const siguienteCodigoRemision = async () => {
  const anio = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date()));
  const prefijo = `REM-${anio}`;
  let valor;
  try {
    valor = await Correlativo.findOneAndUpdate(
      { _id: prefijo }, { $inc: { secuencia: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: false },
    );
  } catch (e) {
    // ====== Dos solicitudes pudieron crear el contador anual simultáneamente ======
    if (e.code !== 11000) throw e;
    valor = await Correlativo.findOneAndUpdate(
      { _id: prefijo }, { $inc: { secuencia: 1 } }, { new: true },
    );
  }
  if (!valor) throw new Error('No se pudo generar el correlativo anual');
  return `${prefijo}-${String(valor.secuencia).padStart(6, '0')}`;
};

// ====== Estado de edición de remisiones creadas directamente en Central ======
const esEditableCentral = envio => envio &&
  envio.modoRegistro === 'CONTINGENCIA_CENTRAL' &&
  estadosEditablesCentral.includes(envio.estado) &&
  (envio.remisiones || []).length === 1 &&
  !(envio.remisiones[0].lineas || []).length;

// ====== Lectura administrativa opcional para remisión originada en Central ======
const lecturaCentralDeclarada = (datos, usuario, total, anterior = null) => {
  const sinLectura = datos?.sinLectura === true;
  const temperatura = datos?.temperaturaC;
  const motivo = limpio(datos?.motivoSinLectura, 500);
  const tieneTemperatura = temperatura !== null && temperatura !== undefined && temperatura !== '';
  if (sinLectura && (tieneTemperatura || !motivo)) {
    const e = new Error('Indique el motivo de no medición, sin temperatura'); e.status = 422; throw e;
  }
  if (!sinLectura && tieneTemperatura && (typeof temperatura !== 'number' || !Number.isFinite(temperatura))) {
    const e = new Error('Temperatura inválida'); e.status = 422; throw e;
  }
  if (!sinLectura && !tieneTemperatura) return anterior ? { ...anterior, totalDeclarado: total, totalRecibido: total } : null;
  const fecha = new Date(datos?.fechaHoraRecepcion || '');
  if (!datos?.fechaHoraRecepcion || Number.isNaN(fecha.getTime()) ||
      fecha.getTime() > Date.now() + 10 * 60 * 1000 || fecha.getUTCFullYear() < 2000) {
    const e = new Error('Fecha de recepción inválida'); e.status = 422; throw e;
  }
  return {
    fechaHora: fecha,
    fechaRegistroSistema: anterior?.fechaRegistroSistema || new Date(),
    recibidoPor: anterior?.recibidoPor || usuario.uid,
    usuarioRecepcion: anterior?.usuarioRecepcion || usuario.nombreUsuario || usuario.uid,
    nombreResponsableRecepcion: anterior?.nombreResponsableRecepcion || '',
    temperaturaC: sinLectura ? null : temperatura,
    motivoSinLectura: sinLectura ? motivo : '',
    incidencia: anterior?.incidencia || '',
    totalDeclarado: total,
    totalRecibido: total,
  };
};

// ====== Responsable: identificar al personal desde uid autenticado ======
const nombreResponsable = async uid => {
  const humano = await RecHumano.findOne({ codRecHumano: uid })
    .select('nombreRecHumano apePatRecHumano apeMatRecHumano').lean();
  return [humano?.nombreRecHumano, humano?.apePatRecHumano, humano?.apeMatRecHumano]
    .filter(Boolean).map(x => String(x).trim()).join(' ').trim();
};

// ====== Resolver pruebas únicamente desde snapshots clínicos existentes ======
const pruebasDeMuestra = muestra => {
  const coberturas = Array.isArray(muestra.coberturas) ? muestra.coberturas : [];
  const pruebas = coberturas.map(c => ({
    codPruebaLab: limpio(c.codPruebaLab, 80),
    nombrePruebaLab: limpio(c.nombrePruebaLab, 200),
  })).filter(p => p.codPruebaLab && p.nombrePruebaLab);
  return [...new Map(pruebas.map(p => [p.codPruebaLab, p])).values()];
};

const nombrePaciente = solicitud => [
  solicitud.nombreCliente, solicitud.apePatCliente, solicitud.apeMatCliente,
].filter(Boolean).join(' ').trim();

// ====== Catálogos restringidos al alcance de recepción ======
const obtenerCatalogos = async (req, res) => {
  try {
    const [asociados, sucursales, nombreCompleto] = await Promise.all([
      Asociado.find({ activo: true, 'convenio.enviaMuestras': true })
        .select('codigoAsociado tipoPersona razonSocial nombreComercial nombres apellidoPaterno apellidoMaterno ruc numeroDocumento sedes')
        .sort({ codigoAsociado: 1 }).limit(300).lean(),
      Sucursal.find({ estado: 'ACTIVA' }).select('codigo nombre nombreCorto')
        .sort({ nombre: 1 }).limit(300).lean(),
      nombreResponsable(req.user.uid),
    ]);
    if (!nombreCompleto) return error(res, 403, 'No se encontró el recurso humano asociado a esta sesión');
    return res.json({
      responsable: { nombreCompleto },
      ok: true,
      asociados: asociados.map(a => ({
        _id: a._id,
        codigo: a.codigoAsociado || '',
        documento: a.ruc || a.numeroDocumento || '',
        sedes: (a.sedes || []).map(s => s.nombre).filter(Boolean),
        nombre: a.tipoPersona === 'JURIDICA'
          ? a.nombreComercial || a.razonSocial
          : [a.nombres, a.apellidoPaterno, a.apellidoMaterno].filter(Boolean).join(' '),
      })),
      sucursales: sucursales.map(s => ({ _id: s._id, codigo: s.codigo, nombre: s.nombreCorto || s.nombre })),
    });
  } catch (e) {
    console.error('Catalogos recepción:', e);
    return error(res, 500, 'No se pudieron cargar los catálogos');
  }
};


// ====== Catálogos de recipientes y muestras activos para selección administrativa ======
const catalogosRecipientes = async (req, res) => {
  try {
    const [recipientes, muestras] = await Promise.all([
      TuboEnvase.find({ estadoTuboEnvase: 'ACTIVO' })
        .select('_id codTuboEnvase nombreTuboEnvase color aditivo')
        .sort({ nombreTuboEnvase: 1 }).lean(),
      TipoMuestra.find({ estadoTipoMuestra: 'ACTIVO' })
        .select('_id codTipoMuestra nombreTipoMuestra')
        .sort({ nombreTipoMuestra: 1 }).lean(),
    ]);
    return res.json({ ok: true, recipientes, muestras });
  } catch (e) {
    console.error('Catálogos de recipientes:', e);
    return error(res, 500, 'No se pudo cargar el catálogo de recipientes y muestras');
  }
};

// ====== Pruebas activas habilitadas por convenio del asociado ======
const pruebasPermitidas = async maestro => {
  const visitados = new Set();
  const permitidas = new Set();
  let pendientes = (maestro.serviciosHabilitados || []).map(s => String(s.servicioId || '')).filter(Boolean);
  for (let nivel = 0; nivel < 4 && pendientes.length; nivel++) {
    const lote = [...new Set(pendientes)].filter(id => !visitados.has(id));
    lote.forEach(id => visitados.add(id));
    if (!lote.length) break;
    const servicios = await Servicio.find({ _id: { $in: lote }, estadoServicio: true })
      .select('examenesServicio serviciosIncluidos').lean();
    pendientes = [];
    for (const servicio of servicios) {
      (servicio.examenesServicio || []).forEach(e => {
        if (e.tipoExamen === 'LABORATORIO' && e.referenciaId) permitidas.add(String(e.referenciaId));
      });
      (servicio.serviciosIncluidos || []).forEach(x => {
        if (x.servicioId && !visitados.has(String(x.servicioId))) pendientes.push(String(x.servicioId));
      });
    }
  }
  return permitidas;
};

// ====== Buscar pacientes existentes sin alterar el maestro ======
const buscarPacientes = async (req, res) => {
  const termino = limpio(req.query.search, 90);
  if (termino.length < 2) return res.json({ ok: true, pacientes: [] });
  try {
    const filtro = { $or: [
      { hc: expresion(termino) },
      { nroDoc: expresion(termino) },
      { nombreCliente: expresion(termino) },
      { apePatCliente: expresion(termino) },
      { apeMatCliente: expresion(termino) },
    ] };
    const pacientes = await Paciente.find(filtro)
      .select('_id hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento phones')
      .sort({ updatedAt: -1 }).limit(15).lean();
    return res.json({ ok: true, pacientes: pacientes.map(p => ({
      _id: p._id, hc: p.hc || '', tipoDoc: p.tipoDoc || '', nroDoc: p.nroDoc || '',
      nombres: p.nombreCliente || '', apePat: p.apePatCliente || '', apeMat: p.apeMatCliente || '',
      sexo: p.sexoCliente || '', fechaNacimiento: p.fechaNacimiento || null,
      telefono: (p.phones || [])[0]?.phoneNumber || '',
    })) });
  } catch (e) {
    console.error('Buscar pacientes recepción:', e);
    return error(res, 500, 'No se pudieron buscar pacientes');
  }
};

// ====== Buscar pruebas habilitadas para el origen seleccionado ======
const buscarPruebas = async (req, res) => {
  const origenTipo = limpio(req.query.origenTipo, 30);
  const asociadoId = limpio(req.query.asociadoId, 40);
  const termino = limpio(req.query.search, 90);
  if (!['ASOCIADO', 'SUCURSAL_PROPIA'].includes(origenTipo)) return error(res, 400, 'Origen inválido');
  if (origenTipo === 'ASOCIADO' && !esId(asociadoId)) return error(res, 400, 'Seleccione un asociado');
  try {
    let autorizadas = null;
    if (origenTipo === 'ASOCIADO') {
      const asociado = await Asociado.findOne({
        _id: asociadoId, activo: true, 'convenio.enviaMuestras': true,
      }).select('serviciosHabilitados').lean();
      if (!asociado) return error(res, 422, 'Asociado no habilitado para enviar muestras');
      autorizadas = [...await pruebasPermitidas(asociado)];
      if (!autorizadas.length) return res.json({ ok: true, pruebas: [] });
    }
    const filtro = { estadoPrueba: 'ACTIVO' };
    if (autorizadas) filtro._id = { $in: autorizadas };
    if (termino) filtro.$or = [
      { codPruebaLab: expresion(termino) }, { nombrePruebaLab: expresion(termino) },
    ];
    const pruebas = await PruebaLab.find(filtro).select('_id codPruebaLab nombrePruebaLab areaLab')
      .sort({ nombrePruebaLab: 1 }).limit(3000).lean();
    return res.json({ ok: true, pruebas: pruebas.map(p => ({
      _id: p._id, codPruebaLab: p.codPruebaLab, nombrePruebaLab: p.nombrePruebaLab,
      areaLab: p.areaLab || '',
    })) });
  } catch (e) {
    console.error('Buscar pruebas recepción:', e);
    return error(res, 500, 'No se pudieron buscar las pruebas');
  }
};

// ====== Buscar recipientes reales por código de laboratorio o solicitud ======
const buscarMuestras = async (req, res) => {
  const codigo = limpio(req.query.codigoLaboratorio, 80).toUpperCase();
  if (!codigo) return error(res, 400, 'Ingrese un código de laboratorio o de solicitud');
  try {
    const muestras = await MuestraLaboratorio.find({
      $or: [{ codigoLaboratorio: codigo }, { codSolicitud: codigo }],
      estadoMuestra: { $in: estadosTransportables },
    }).select('solicitudAtencionId codSolicitud codigoLaboratorio codigoEtiqueta codMuestra coberturas tipoMuestraId tipoMuestra tuboEnvaseId tuboEnvase estadoMuestra')
      .sort({ codMuestra: 1 }).limit(100).lean();
    if (!muestras.length) return res.json({ ok: true, muestras: [] });
    const solicitudes = detalleNuevo ? [] : await SolicitudAtencion.find({
      _id: { $in: muestras.map(m => m.solicitudAtencionId) },
      estado: { $ne: 'ANULADO' },
    }).select('codSolicitud codigoLaboratorio nombreCliente apePatCliente apeMatCliente nroDoc unidadesLaboratorio estado').lean();
    const porId = new Map(solicitudes.map(s => [String(s._id), s]));
    const ocupados = await RecepcionMuestras.find({
      'remisiones.lineas.muestraLaboratorioId': { $in: muestras.map(m => m._id) },
    }).select('remisiones.lineas.muestraLaboratorioId').lean();
    const usados = new Set(ocupados.flatMap(e => e.remisiones.flatMap(r => r.lineas.map(l => String(l.muestraLaboratorioId)))));
    const disponibles = muestras.flatMap(m => {
      const s = porId.get(String(m.solicitudAtencionId));
      if (!s) return [];
      return [{
        _id: m._id,
        solicitudAtencionId: m.solicitudAtencionId,
        codSolicitud: s.codSolicitud,
        codigoLaboratorio: s.codigoLaboratorio || m.codigoLaboratorio || '',
        codigoEtiqueta: m.codigoEtiqueta || m.codMuestra,
        pacienteNombre: nombrePaciente(s),
        pacienteDocumento: s.nroDoc || '',
        pruebas: pruebasDeMuestra(m),
        tipoMuestraNombre: m.tipoMuestra?.nombreTipoMuestra || '',
        tuboEnvaseNombre: m.tuboEnvase?.nombreTuboEnvase || '',
        disponible: !usados.has(String(m._id)),
      }];
    });
    return res.json({ ok: true, muestras: disponibles });
  } catch (e) {
    console.error('Buscar muestras recepción:', e);
    return error(res, 500, 'No se pudieron consultar las muestras');
  }
};

// ====== Buscar envíos existentes; nunca datos simulados ======
const listarRecepciones = async (req, res) => {
  try {
    const busqueda = limpio(req.query.search, 100);
    const filtro = busqueda ? { $or: [
      { codigoEnvio: expresion(busqueda) },
      { origenNombre: expresion(busqueda) },
      { 'remisiones.origenNombre': expresion(busqueda) },
      { 'remisiones.origenCodigo': expresion(busqueda) },
      { 'remisiones.referenciaRemision': expresion(busqueda) },
    ] } : {};
    const envios = await RecepcionMuestras.find(filtro)
      .select('codigoEnvio estado modoRegistro origenNombre origenCodigo origenDespacho remisiones.origenTipo remisiones.origenNombre remisiones.origenCodigo remisiones.referenciaRemision createdAt')
      .sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ ok: true, recepciones: envios.map(e => ({
      _id: e._id,
      codigoEnvio: e.codigoEnvio,
      origenNombre: e.origenNombre,
      origenCodigo: e.origenCodigo,
      origenDespacho: e.origenDespacho,
      modoRegistro: e.modoRegistro,
      estado: e.estado,
      fechaRegistro: e.createdAt,
      remisiones: e.remisiones.map(r => ({ origenTipo: r.origenTipo, origenNombre: r.origenNombre, origenCodigo: r.origenCodigo, referenciaRemision: r.referenciaRemision })),
    })) });
  } catch (e) {
    console.error('Listar envíos:', e);
    return error(res, 500, 'No se pudieron consultar los envíos');
  }
};

const obtenerRecepcion = async (req, res) => {
  if (!esId(req.params.id)) return error(res, 400, 'Identificador de envío inválido');
  try {
    const envio = await RecepcionMuestras.findById(req.params.id).lean();
    if (!envio) return error(res, 404, 'Envío no encontrado');
    return res.json({ ok: true, recepcion: envio });
  } catch (e) {
    console.error('Detalle envío:', e);
    return error(res, 500, 'No se pudo consultar el envío');
  }
};

// ====== Validar y preparar pacientes/recipientes declarados desde Central ======
const prepararDetalleAdministrativo = async (pacientes, recipientes, origenTipo, maestro) => {
  const invalidar = mensaje => { const e = new Error(mensaje); e.status = 422; throw e; };
  if (!Array.isArray(pacientes) || !pacientes.length || pacientes.length > 80 ||
      !Array.isArray(recipientes) || !recipientes.length || recipientes.length > 150) {
    invalidar('Registre pacientes y al menos un recipiente administrativo (máximo 80 pacientes y 150 grupos)');
  }
  const claves = new Set();
  const pruebasIds = new Set();
  const pacientesLimpios = pacientes.map(p => {
    const clave = limpio(p?.clave, 80);
    const nombre = [p?.apePat, p?.apeMat, p?.nombres].map(x => limpio(x, 100)).filter(Boolean).join(' ').trim();
    const pruebas = p?.pruebas;
    if (!clave || claves.has(clave) || !limpio(p?.apePat, 100) || !limpio(p?.nombres, 100) ||
        !Array.isArray(pruebas) || !pruebas.length || pruebas.length > 100) invalidar('Paciente o pruebas de paciente no válidos');
    claves.add(clave);
    const pruebasPaciente = new Set();
    for (const prueba of pruebas) {
      if (!esId(prueba?._id)) invalidar('La prueba seleccionada no tiene un identificador válido');
      if (pruebasPaciente.has(String(prueba._id))) invalidar('No repita la misma prueba para un paciente');
      pruebasPaciente.add(String(prueba._id));
      pruebasIds.add(String(prueba._id));
    }
    const edad = p?.edadDeclarada == null ? null : p.edadDeclarada;
    if ((edad !== null && (!Number.isInteger(edad) || edad < 0 || edad > 130)) ||
        !['ANIOS', 'MESES', 'DIAS'].includes(p.unidadEdad || 'ANIOS')) invalidar('Edad declarada no válida');
    const fecha = p?.fechaNacimiento ? new Date(p.fechaNacimiento) : null;
    if (fecha && (Number.isNaN(fecha.getTime()) || fecha > new Date())) invalidar('Fecha de nacimiento no válida');
    if (!fecha && edad === null) invalidar('Registre fecha de nacimiento o edad declarada');
    if (p?.pacienteId && !esId(p.pacienteId)) invalidar('Paciente del maestro no válido');
    return {
      clave, pacienteId: p.pacienteId || null, hc: limpio(p.hc, 40), nombre,
      apePat: limpio(p.apePat, 100), apeMat: limpio(p.apeMat, 100), nombres: limpio(p.nombres, 100),
      tipoDoc: limpio(p.tipoDoc, 30), nroDoc: limpio(p.nroDoc, 40), telefono: limpio(p.telefono, 30),
      documento: [limpio(p.tipoDoc, 30), limpio(p.nroDoc, 40)].filter(Boolean).join(' '),
      sexo: limpio(p.sexo, 30), fechaNacimiento: fecha, edadDeclarada: edad,
      unidadEdad: p.unidadEdad || 'ANIOS', pruebasIds: pruebas.map(t => String(t._id)),
    };
  });
  const pacientesMaestroIds = pacientesLimpios.map(p => String(p.pacienteId || '')).filter(Boolean);
  if (new Set(pacientesMaestroIds).size !== pacientesMaestroIds.length) invalidar('No repita al mismo paciente maestro en una remisión');
  if (pacientesLimpios.some(p => p.pacienteId)) {
    const idsPacientes = [...new Set(pacientesLimpios.map(p => p.pacienteId).filter(Boolean))];
    const existentes = await Paciente.find({ _id: { $in: idsPacientes } })
      .select('_id nombreCliente apePatCliente apeMatCliente tipoDoc nroDoc hc fechaNacimiento sexoCliente').lean();
    if (existentes.length !== idsPacientes.length) invalidar('Uno de los pacientes del maestro no existe');
    const porId = new Map(existentes.map(p => [String(p._id), p]));
    for (const p of pacientesLimpios) if (p.pacienteId) {
      const original = porId.get(String(p.pacienteId));
      p.apePat = original.apePatCliente || '';
      p.apeMat = original.apeMatCliente || '';
      p.nombres = original.nombreCliente || '';
      p.nombre = [p.apePat, p.apeMat, p.nombres].filter(Boolean).join(' ');
      p.tipoDoc = original.tipoDoc || '';
      p.nroDoc = original.nroDoc || '';
      p.documento = [p.tipoDoc, p.nroDoc].filter(Boolean).join(' ');
      p.hc = original.hc || '';
      p.sexo = original.sexoCliente || '';
      p.fechaNacimiento = original.fechaNacimiento || null;
      if (p.fechaNacimiento) p.edadDeclarada = null;
    }
  }
  const pruebas = await PruebaLab.find({ _id: { $in: [...pruebasIds] }, estadoPrueba: 'ACTIVO' })
    .select('_id codPruebaLab nombrePruebaLab').lean();
  if (pruebas.length !== pruebasIds.size) invalidar('Una prueba no existe o está inactiva');
  if (origenTipo === 'ASOCIADO') {
    const permitidas = await pruebasPermitidas(maestro);
    if ([...pruebasIds].some(id => !permitidas.has(id))) invalidar('Hay pruebas no habilitadas en el convenio del asociado');
  }
  const porPrueba = new Map(pruebas.map(p => [String(p._id), p]));
  const pacientesAdministrativos = pacientesLimpios.map(p => ({
    ...p, pruebasIds: undefined,
    pruebas: p.pruebasIds.map(id => ({
      codPruebaLab: porPrueba.get(id).codPruebaLab,
      nombrePruebaLab: porPrueba.get(id).nombrePruebaLab,
    })),
  }));
  // ====== Central valida el recipiente visible, no exige clasificación técnica ======
  const recipienteIds = new Set(), muestraIds = new Set();
  for (const item of recipientes) {
    if (!claves.has(limpio(item?.clavePaciente, 80)) || !esId(item?.tuboEnvaseId) ||
        !Number.isInteger(item?.cantidad) || item.cantidad < 1 || item.cantidad > 100) {
      invalidar('Paciente, recipiente o cantidad inválidos');
    }
    const muestraId = item?.tipoMuestraId;
    if (muestraId != null && muestraId !== '' && !esId(muestraId)) {
      invalidar('El tipo de muestra declarado no es válido');
    }
    recipienteIds.add(String(item.tuboEnvaseId));
    if (muestraId) muestraIds.add(String(muestraId));
  }
  const [tubos, muestras] = await Promise.all([
    TuboEnvase.find({ _id: { $in: [...recipienteIds] }, estadoTuboEnvase: 'ACTIVO' })
      .select('_id nombreTuboEnvase color').lean(),
    muestraIds.size
      ? TipoMuestra.find({ _id: { $in: [...muestraIds] }, estadoTipoMuestra: 'ACTIVO' })
          .select('_id nombreTipoMuestra').lean()
      : Promise.resolve([]),
  ]);
  if (tubos.length !== recipienteIds.size) invalidar('Hay recipientes inactivos o inexistentes');
  if (muestras.length !== muestraIds.size) invalidar('El tipo de muestra declarado no existe o está inactivo');
  const tMap = new Map(tubos.map(t => [String(t._id), t]));
  const mMap = new Map(muestras.map(t => [String(t._id), t]));
  const etiquetas = new Set();
  const recipientesAdministrativos = recipientes.map(item => {
    const etiqueta = limpio(item.codigoEtiqueta, 100);
    if (etiqueta && etiquetas.has(etiqueta.toUpperCase())) invalidar('Una etiqueta externa está repetida en esta remisión');
    if (etiqueta) etiquetas.add(etiqueta.toUpperCase());
    const fechaToma = item.fechaToma ? new Date(item.fechaToma) : null;
    if (fechaToma && (Number.isNaN(fechaToma.getTime()) || fechaToma > new Date())) invalidar('Fecha de toma inválida');
    return {
      clavePaciente: limpio(item.clavePaciente, 80),
      tuboEnvaseId: item.tuboEnvaseId, tuboEnvaseNombre: tMap.get(String(item.tuboEnvaseId)).nombreTuboEnvase,
      color: tMap.get(String(item.tuboEnvaseId)).color || '',
      // ====== No inferir contenido biológico a partir del color del tubo ======
      tipoMuestraId: item.tipoMuestraId || null,
      tipoMuestraNombre: item.tipoMuestraId ? mMap.get(String(item.tipoMuestraId)).nombreTipoMuestra : '',
      cantidadDeclarada: item.cantidad, cantidadRecibida: null,
      codigoEtiqueta: etiqueta, fechaToma,
    };
  });
  return { pacientesAdministrativos, recipientesAdministrativos };
};

// ====== Identificar la sucursal que remite un asociado a Central ======
const sucursalRemitente = async (origenTipo, rutaIngreso, sucursalId) => {
  if (origenTipo !== 'ASOCIADO' || rutaIngreso !== 'SUCURSAL') return null;
  if (!esId(sucursalId)) {
    const e = new Error('Seleccione la sucursal LABFRAY remitente'); e.status = 422; throw e;
  }
  const sucursal = await Sucursal.findOne({ _id: sucursalId, estado: 'ACTIVA' })
    .select('_id codigo nombre nombreCorto').lean();
  if (!sucursal) {
    const e = new Error('La sucursal remitente no existe o no está activa'); e.status = 422; throw e;
  }
  return sucursal;
};

// ====== Contingencia: registrar logística sin crear solicitudes clínicas ======
const crearContingencia = async (req, res) => {
  try {
    const { origenTipo, asociadoId, sucursalId } = req.body || {};
    const prioridad = req.body?.prioridad === 'URGENTE' ? 'URGENTE' : 'NORMAL';
    const rutaIngreso = req.body?.rutaIngreso === 'SUCURSAL' ? 'SUCURSAL' : 'DIRECTO';
    const muestrasIds = req.body?.muestrasIds || [];
    const detalleNuevo = Array.isArray(req.body?.pacientes) && req.body.pacientes.length > 0;
    if (!['ASOCIADO', 'SUCURSAL_PROPIA'].includes(origenTipo)) {
      return error(res, 400, 'Origen de remisión inválido');
    }
    if (!Array.isArray(muestrasIds) || muestrasIds.length > 80 ||
        muestrasIds.some(id => !esId(id)) || new Set(muestrasIds.map(String)).size !== muestrasIds.length ||
        (detalleNuevo && muestrasIds.length) || (!detalleNuevo && !muestrasIds.length)) {
      return error(res, 400, 'Seleccione recipientes administrativos por paciente o muestras físicas existentes, sin mezclar modalidades');
    }
    if ((origenTipo === 'ASOCIADO' && (!esId(asociadoId) || (rutaIngreso === 'DIRECTO' && sucursalId))) ||
        (origenTipo === 'SUCURSAL_PROPIA' && (!esId(sucursalId) || asociadoId))) {
      return error(res, 400, 'Debe indicar únicamente el maestro correspondiente al origen');
    }
    const maestro = origenTipo === 'ASOCIADO'
      ? await Asociado.findOne({ _id: asociadoId, activo: true, 'convenio.enviaMuestras': true }).lean()
      : await Sucursal.findOne({ _id: sucursalId, estado: 'ACTIVA' }).lean();
    if (!maestro) return error(res, 422, 'El asociado o sucursal no está habilitado para enviar muestras');
    const sedeOrigen = limpio(req.body?.sedeOrigen, 150);
    if (origenTipo === 'ASOCIADO' && (!sedeOrigen || !maestro.sedes?.some(s => s.nombre === sedeOrigen))) {
      return error(res, 422, 'Seleccione una sede vigente del asociado');
    }
    if (origenTipo === 'SUCURSAL_PROPIA' && rutaIngreso !== 'DIRECTO') {
      return error(res, 422, 'La contingencia de sucursal propia se registra directamente en Central');
    }
    const remitente = await sucursalRemitente(origenTipo, rutaIngreso, sucursalId);
    const origenCodigo = origenTipo === 'ASOCIADO' ? maestro.codigoAsociado : maestro.codigo;
    const origenNombre = origenTipo === 'ASOCIADO'
      ? (maestro.nombreComercial || maestro.razonSocial || [maestro.nombres, maestro.apellidoPaterno, maestro.apellidoMaterno].filter(Boolean).join(' '))
      : (maestro.nombreCorto || maestro.nombre);
    const detalle = detalleNuevo ? await prepararDetalleAdministrativo(req.body.pacientes, req.body.recipientes, origenTipo, maestro) : null;
    const muestras = detalleNuevo ? [] : await MuestraLaboratorio.find({ _id: { $in: muestrasIds } })
      .select('solicitudAtencionId codSolicitud codigoLaboratorio codigoEtiqueta codMuestra coberturas tipoMuestraId tipoMuestra tuboEnvaseId tuboEnvase estadoMuestra').lean();
    if (muestras.length !== muestrasIds.length || muestras.some(m => !estadosTransportables.includes(m.estadoMuestra))) {
      return error(res, 422, 'Hay recipientes inexistentes o que no están disponibles para traslado');
    }
    const ocupadas = detalleNuevo ? null : await RecepcionMuestras.exists({
      'remisiones.lineas.muestraLaboratorioId': { $in: muestrasIds },
    });
    if (ocupadas) return error(res, 409, 'Uno o más recipientes ya pertenecen a otro envío');
    const solicitudes = detalleNuevo ? [] : await SolicitudAtencion.find({
      _id: { $in: muestras.map(m => m.solicitudAtencionId) },
      estado: { $ne: 'ANULADO' },
    }).select('codSolicitud codigoLaboratorio nombreCliente apePatCliente apeMatCliente nroDoc unidadesLaboratorio estado').lean();
    const porId = new Map(solicitudes.map(s => [String(s._id), s]));
    if (muestras.some(m => !porId.has(String(m.solicitudAtencionId)))) {
      return error(res, 422, 'Una de las solicitudes clínicas fue anulada o no existe');
    }
    const lineas = muestrasIds.map(id => {
      const m = muestras.find(x => String(x._id) === id);
      const s = porId.get(String(m.solicitudAtencionId));
      return {
        muestraLaboratorioId: m._id,
        solicitudAtencionId: s._id,
        codSolicitud: s.codSolicitud,
        codigoLaboratorio: s.codigoLaboratorio || m.codigoLaboratorio || '',
        codigoEtiqueta: m.codigoEtiqueta || m.codMuestra,
        pacienteNombre: nombrePaciente(s),
        pacienteDocumento: s.nroDoc || '',
        pruebas: pruebasDeMuestra(m),
        tipoMuestraId: m.tipoMuestraId || null,
        tipoMuestraNombre: m.tipoMuestra?.nombreTipoMuestra || '',
        tuboEnvaseId: m.tuboEnvaseId || null,
        tuboEnvaseNombre: m.tuboEnvase?.nombreTuboEnvase || '',
        cantidadDeclarada: 1,
        cantidadRecibida: null,
      };
    });
    if (lineas.some(l => !l.pacienteNombre || !l.pruebas.length)) {
      return error(res, 422, 'Una muestra no tiene paciente o pruebas clínicas identificables');
    }
    const totalRecipientes = (detalle?.recipientesAdministrativos || []).reduce((n, r) => n + r.cantidadDeclarada, 0) + lineas.length;
    const lectura = lecturaCentralDeclarada(req.body, req.user, totalRecipientes);
    if (lectura) lectura.nombreResponsableRecepcion = await nombreResponsable(req.user.uid);
    // ====== Emitir el correlativo después de validar todos los datos ======
    const codigoEnvio = await siguienteCodigoRemision();
    const envio = await RecepcionMuestras.create({
      codigoEnvio,
      modoRegistro: 'CONTINGENCIA_CENTRAL',
      origenDespacho: origenTipo === 'ASOCIADO' && rutaIngreso === 'DIRECTO' ? 'ASOCIADO' : 'SUCURSAL',
      origenNombre,
      origenCodigo,
      rutaIngreso,
      prioridad,
      sedeOrigen: origenTipo === 'ASOCIADO' ? sedeOrigen : origenNombre,
      observacionRemision: limpio(req.body?.observacionRemision, 2000),
      estado: 'REGISTRADA_CENTRAL',
      remisiones: [{
        origenTipo,
        asociadoId: origenTipo === 'ASOCIADO' ? asociadoId : null,
        sucursalId: origenTipo === 'SUCURSAL_PROPIA' || rutaIngreso === 'SUCURSAL' ? sucursalId : null,
        sucursalRemitenteNombre: remitente ? remitente.nombreCorto || remitente.nombre : '',
        origenNombre,
        origenCodigo,
        referenciaRemision: limpio(req.body?.referenciaRemision, 120),
        lineas,
        pacientesAdministrativos: detalle?.pacientesAdministrativos || [],
        recipientesAdministrativos: detalle?.recipientesAdministrativos || [],
      }],
      lecturasPrevias: [],
      recepcionCentral: lectura,
      registradoPor: req.user.uid,
      usuarioRegistro: req.user.nombreUsuario || req.user.uid,
    });
    return res.status(201).json({ ok: true, msg: 'Remisión registrada en Central', recepcion: envio });
  } catch (e) {
    if (responderIndiceDuplicado(res, e)) return;
    if (e.status) return error(res, e.status, e.message);
    if (e.name === 'ValidationError') return error(res, 422, e.message);
    console.error('Crear contingencia:', e);
    return error(res, 500, 'No se pudo registrar la contingencia');
  }
};

// ====== Recuperar borrador editable sin modificar el registro ======
const obtenerBorradorCentral = async (req, res) => {
  if (!esId(req.params.id)) return error(res, 400, 'Identificador de remisión inválido');
  try {
    const envio = await RecepcionMuestras.findById(req.params.id).lean();
    if (!envio) return error(res, 404, 'Remisión no encontrada');
    if (!esEditableCentral(envio)) return error(res, 409, 'La remisión no es editable desde Central');
    const r = envio.remisiones[0];
    const codigos = [...new Set((r.pacientesAdministrativos || [])
      .flatMap(p => p.pruebas.map(pr => pr.codPruebaLab)))];
    const pruebas = await PruebaLab.find({ codPruebaLab: { $in: codigos }, estadoPrueba: 'ACTIVO' })
      .select('_id codPruebaLab nombrePruebaLab areaLab').lean();
    const porCodigo = new Map(pruebas.map(p => [p.codPruebaLab, p]));
    if (codigos.some(c => !porCodigo.has(c))) {
      return error(res, 409, 'Una prueba de esta remisión ya no está activa. Revísela antes de editar.');
    }
    const idsMaestros = [...new Set((r.pacientesAdministrativos || []).map(p => p.pacienteId).filter(Boolean).map(String))];
    const pacientesMaestro = idsMaestros.length ? await Paciente.find({ _id: { $in: idsMaestros } })
      .select('_id tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente phones fechaNacimiento sexoCliente').lean() : [];
    const mapaMaestros = new Map(pacientesMaestro.map(p => [String(p._id), p]));
    const pacientes = (r.pacientesAdministrativos || []).map(p => {
      const m = p.pacienteId ? mapaMaestros.get(String(p.pacienteId)) : null;
      const apePat = m?.apePatCliente || p.apePat || '';
      const apeMat = m?.apeMatCliente || p.apeMat || '';
      const nombres = m?.nombreCliente || p.nombres || '';
      if (!apePat || !nombres) {
        const e = new Error('La remisión antigua no conserva apellidos y nombres por separado; requiere revisión previa.');
        e.status = 409; throw e;
      }
      return {
        clave: p.clave, pacienteId: p.pacienteId || null, hc: p.hc || '',
        apePat, apeMat, nombres, tipoDoc: m?.tipoDoc || p.tipoDoc || '',
        nroDoc: m?.nroDoc || p.nroDoc || '', sexo: m?.sexoCliente || p.sexo || '',
        fechaNacimiento: m?.fechaNacimiento || p.fechaNacimiento || null,
        edadDeclarada: p.edadDeclarada ?? null, unidadEdad: p.unidadEdad || 'ANIOS',
        telefono: m?.phones?.[0]?.phoneNumber || p.telefono || '',
        pruebas: (p.pruebas || []).map(pr => porCodigo.get(pr.codPruebaLab)),
      };
    });
    const recipientes = (r.recipientesAdministrativos || []).map(item => ({
      clave: String(item._id), clavePaciente: item.clavePaciente,
      tuboEnvaseId: String(item.tuboEnvaseId), tipoMuestraId: item.tipoMuestraId || null,
      cantidad: item.cantidadDeclarada, codigoEtiqueta: item.codigoEtiqueta || '',
      fechaToma: item.fechaToma || null,
    }));
    return res.json({ ok: true, version: envio.__v, datos: {
      origenTipo: r.origenTipo,
      asociadoId: r.asociadoId || '', sucursalId: r.sucursalId || '',
      sedeOrigen: envio.sedeOrigen, rutaIngreso: envio.rutaIngreso,
      prioridad: envio.prioridad, referenciaRemision: r.referenciaRemision,
      observacionRemision: envio.observacionRemision,
      pacientes, recipientes,
    } });
  } catch (e) {
    if (e.status) return error(res, e.status, e.message);
    console.error('Obtener borrador central:', e);
    return error(res, 500, 'No se pudo preparar la edición de la remisión');
  }
};

// ====== Editar solo remisión Central pendiente, con control de concurrencia ======
const actualizarContingencia = async (req, res) => {
  if (!esId(req.params.id)) return error(res, 400, 'Identificador de remisión inválido');
  if (!Number.isSafeInteger(req.body?.version) || req.body.version < 0) return error(res, 400, 'Falta la versión de la remisión');
  try {
    const actual = await RecepcionMuestras.findById(req.params.id).lean();
    if (!actual) return error(res, 404, 'Remisión no encontrada');
    if (!esEditableCentral(actual)) return error(res, 409, 'Esta remisión no se puede modificar; podría haber sido aceptada o cerrada');
    if (actual.__v !== req.body.version) return error(res, 409, 'La remisión fue modificada por otro usuario. Cárguela nuevamente');
    const { origenTipo, asociadoId, sucursalId } = req.body || {};
    const rutaIngreso = req.body?.rutaIngreso === 'SUCURSAL' ? 'SUCURSAL' : 'DIRECTO';
    if (!['ASOCIADO', 'SUCURSAL_PROPIA'].includes(origenTipo)) return error(res, 400, 'Origen inválido');
    if ((origenTipo === 'ASOCIADO' && (!esId(asociadoId) || (rutaIngreso === 'DIRECTO' && sucursalId))) ||
        (origenTipo === 'SUCURSAL_PROPIA' && (!esId(sucursalId) || asociadoId || rutaIngreso !== 'DIRECTO'))) {
      return error(res, 400, 'Seleccione el asociado y, si corresponde, la sucursal remitente');
    }
    const remitente = await sucursalRemitente(origenTipo, rutaIngreso, sucursalId);
    const maestro = origenTipo === 'ASOCIADO'
      ? await Asociado.findOne({ _id: asociadoId, activo: true, 'convenio.enviaMuestras': true }).lean()
      : await Sucursal.findOne({ _id: sucursalId, estado: 'ACTIVA' }).lean();
    if (!maestro) return error(res, 422, 'Origen inactivo o inexistente');
    const sede = limpio(req.body.sedeOrigen, 150);
    if (origenTipo === 'ASOCIADO' && (!sede || !maestro.sedes?.some(s => s.nombre === sede))) {
      return error(res, 422, 'Seleccione una sede válida del asociado');
    }
    const detalle = await prepararDetalleAdministrativo(req.body.pacientes, req.body.recipientes, origenTipo, maestro);
    const origenCodigo = origenTipo === 'ASOCIADO' ? maestro.codigoAsociado : maestro.codigo;
    const origenNombre = origenTipo === 'ASOCIADO'
      ? (maestro.nombreComercial || maestro.razonSocial || [maestro.nombres, maestro.apellidoPaterno, maestro.apellidoMaterno].filter(Boolean).join(' '))
      : (maestro.nombreCorto || maestro.nombre);
    // ====== Conservar IDs de líneas y remisión existentes para trazabilidad ======
    const recipientesPrevios = new Map((actual.remisiones[0].recipientesAdministrativos || [])
      .map(x => [String(x._id), x]));
    for (let i = 0; i < detalle.recipientesAdministrativos.length; i++) {
      const previo = recipientesPrevios.get(String(req.body.recipientes[i]?.clave || ''));
      if (previo) detalle.recipientesAdministrativos[i]._id = previo._id;
    }
    const total = detalle.recipientesAdministrativos.reduce((n, x) => n + x.cantidadDeclarada, 0);
    const lectura = lecturaCentralDeclarada(req.body, req.user, total, actual.recepcionCentral);
    if (lectura && !lectura.nombreResponsableRecepcion) lectura.nombreResponsableRecepcion = await nombreResponsable(req.user.uid);
    const remision = {
      _id: actual.remisiones[0]._id,
      origenTipo, asociadoId: origenTipo === 'ASOCIADO' ? asociadoId : null,
      sucursalId: origenTipo === 'SUCURSAL_PROPIA' || rutaIngreso === 'SUCURSAL' ? sucursalId : null,
      sucursalRemitenteNombre: remitente ? remitente.nombreCorto || remitente.nombre : '',
      origenNombre, origenCodigo, referenciaRemision: limpio(req.body.referenciaRemision, 120),
      lineas: [], pacientesAdministrativos: detalle.pacientesAdministrativos,
      recipientesAdministrativos: detalle.recipientesAdministrativos,
    };
    const actualizado = await RecepcionMuestras.findOneAndUpdate(
      { _id: actual._id, modoRegistro: 'CONTINGENCIA_CENTRAL',
        estado: { $in: estadosEditablesCentral }, __v: actual.__v },
      { $set: {
        origenDespacho: origenTipo === 'ASOCIADO' && rutaIngreso === 'DIRECTO' ? 'ASOCIADO' : 'SUCURSAL',
        origenNombre, origenCodigo, rutaIngreso,
        prioridad: req.body.prioridad === 'URGENTE' ? 'URGENTE' : 'NORMAL',
        sedeOrigen: origenTipo === 'ASOCIADO' ? sede : origenNombre,
        observacionRemision: limpio(req.body.observacionRemision, 2000),
        remisiones: [remision], recepcionCentral: lectura,
        actualizadoPor: req.user.uid,
      }, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    ).lean();
    if (!actualizado) return error(res, 409, 'La remisión cambió de estado o fue editada. Vuelva a cargarla');
    return res.json({ ok: true, msg: 'Remisión actualizada', recepcion: actualizado });
  } catch (e) {
    if (e.status) return error(res, e.status, e.message);
    if (e.name === 'ValidationError') return error(res, 422, e.message);
    if (responderIndiceDuplicado(res, e)) return;
    console.error('Actualizar remisión central:', e);
    return error(res, 500, 'No se pudo actualizar la remisión');
  }
};

// ====== Confirmar una sola vez sin alterar el estado clínico de MuestraLaboratorio ======
const confirmarRecepcion = async (req, res) => {
  if (!esId(req.params.id)) return error(res, 400, 'Identificador de envío inválido');
  try {
    const envio = await RecepcionMuestras.findById(req.params.id).lean();
    if (!envio) return error(res, 404, 'Envío no encontrado');
    if (envio.modoRegistro === 'CONTINGENCIA_CENTRAL') return error(res, 409, 'Las remisiones registradas en Central no requieren confirmar su propia recepción');
    if (!estadosPorRecibir.includes(envio.estado) || envio.recepcionCentral) {
      return error(res, 409, 'Este envío ya fue recibido o no admite recepción');
    }
    const filas = (envio.remisiones || []).flatMap(r => [...(r.lineas || []), ...(r.recipientesAdministrativos || [])]);
    const conteos = req.body?.conteos;
    if (!Array.isArray(conteos) || conteos.length !== filas.length || !filas.length) {
      return error(res, 400, 'Debe cotejar exactamente todos los recipientes declarados');
    }
    const ids = new Set(filas.map(l => String(l._id)));
    const conteoPorId = new Map();
    for (const fila of conteos) {
      const id = String(fila?.lineaId || '');
      const valor = fila?.cantidadRecibida;
      if (!ids.has(id) || conteoPorId.has(id) || !Number.isSafeInteger(valor) || valor < 0 || valor > (filas.find(l => String(l._id) === id)?.cantidadDeclarada || 0)) {
        return error(res, 400, 'Cantidad recibida inválida o línea repetida');
      }
      conteoPorId.set(id, valor);
    }
    // ====== Conservar fecha declarada y sello de tiempo del servidor ======
    const fechaTexto = req.body?.fechaHoraRecepcion;
    const fechaRecepcion = typeof fechaTexto === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(fechaTexto)
      ? new Date(fechaTexto) : null;
    const registroSistema = new Date();
    if (!fechaRecepcion || Number.isNaN(fechaRecepcion.getTime()) ||
        fechaRecepcion.toISOString() !== fechaTexto ||
        fechaRecepcion.getTime() > registroSistema.getTime() + 10 * 60 * 1000 ||
        fechaRecepcion.getUTCFullYear() < 2000) {
      return error(res, 400, 'Fecha y hora de recepción inválida o posterior a la fecha del servidor');
    }
    const responsable = await nombreResponsable(req.user.uid);
    if (!responsable) return error(res, 403, 'El usuario autenticado no tiene un recurso humano válido');
    const sinLectura = req.body?.sinLectura === true;
    const temperatura = req.body?.temperaturaC;
    const motivo = limpio(req.body?.motivoSinLectura, 500);
    if (sinLectura ? (temperatura !== null && temperatura !== undefined && temperatura !== '') || !motivo
      : (typeof temperatura !== 'number' || !Number.isFinite(temperatura))) {
      return error(res, 400, 'Registre temperatura de recepción en Central numérica o motivo de no medición');
    }
    const totalDeclarado = filas.reduce((sum, l) => sum + l.cantidadDeclarada, 0);
    const totalRecibido = [...conteoPorId.values()].reduce((sum, n) => sum + n, 0);
    const incidencia = limpio(req.body?.incidencia, 2000);
    if (totalDeclarado !== totalRecibido && !incidencia) {
      return error(res, 400, 'Registre la incidencia por diferencia de cantidades');
    }
    const remisiones = envio.remisiones.map(r => ({
      ...r,
      lineas: (r.lineas || []).map(l => ({ ...l, cantidadRecibida: conteoPorId.get(String(l._id)) })),
      recipientesAdministrativos: (r.recipientesAdministrativos || []).map(l => ({
        ...l, cantidadRecibida: conteoPorId.get(String(l._id)),
      })),
    }));
    const actualizado = await RecepcionMuestras.findOneAndUpdate(
      { _id: envio._id, estado: { $in: estadosPorRecibir }, recepcionCentral: null, __v: envio.__v },
      {
        $set: {
          estado: totalDeclarado === totalRecibido ? 'RECIBIDO_COMPLETO' : 'RECIBIDO_CON_DIFERENCIAS',
          remisiones,
          recepcionCentral: {
            fechaHora: fechaRecepcion,
            fechaRegistroSistema: registroSistema,
            recibidoPor: req.user.uid,
            usuarioRecepcion: req.user.nombreUsuario || req.user.uid,
            nombreResponsableRecepcion: responsable,
            temperaturaC: sinLectura ? null : temperatura,
            motivoSinLectura: sinLectura ? motivo : '',
            incidencia,
            totalDeclarado,
            totalRecibido,
          },
          actualizadoPor: req.user.uid,
        },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!actualizado) return error(res, 409, 'El envío cambió durante la recepción; vuelva a cargarlo');
    return res.json({ ok: true, msg: 'Recepción administrativa confirmada', recepcion: actualizado });
  } catch (e) {
    if (e.name === 'ValidationError') return error(res, 422, e.message);
    console.error('Confirmar recepción:', e);
    return error(res, 500, 'No se pudo confirmar la recepción');
  }
};

module.exports = {
  obtenerCatalogos,
  catalogosRecipientes,
  buscarPacientes,
  buscarPruebas,
  buscarMuestras,
  listarRecepciones,
  obtenerRecepcion,
  crearContingencia,
  obtenerBorradorCentral,
  actualizarContingencia,
  confirmarRecepcion,
};
