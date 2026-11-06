const mongoose = require('mongoose');
const { randomBytes } = require('crypto');
const RecepcionMuestras = require('../../models/Gestion/RecepcionMuestras');
const MuestraLaboratorio = require('../../models/Gestion/MuestraLaboratorio');
const SolicitudAtencion = require('../../models/Gestion/SolicitudAtencion');
const Asociado = require('../../models/Mantenimiento/Asociado');
const Sucursal = require('../../models/Mantenimiento/Sucursal');

const estadosTransportables = ['RECOLECTADA', 'RECEPCIONADA', 'ACEPTADA'];
const estadosPorRecibir = ['PENDIENTE_RECEPCION', 'DESPACHADO'];
const esId = valor => typeof valor === 'string' && /^[0-9a-fA-F]{24}$/.test(valor) && mongoose.Types.ObjectId.isValid(valor);
const limpio = (valor, max = 300) => typeof valor === 'string' ? valor.trim().slice(0, max) : '';
const expresion = valor => new RegExp(valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const error = (res, status, msg) => res.status(status).json({ ok: false, msg });

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
    const [asociados, sucursales] = await Promise.all([
      Asociado.find({ activo: true, 'convenio.enviaMuestras': true })
        .select('codigoAsociado tipoPersona razonSocial nombreComercial nombres apellidoPaterno apellidoMaterno ruc numeroDocumento sedes')
        .sort({ codigoAsociado: 1 }).limit(300).lean(),
      Sucursal.find({ estado: 'ACTIVA' }).select('codigo nombre nombreCorto')
        .sort({ nombre: 1 }).limit(300).lean(),
    ]);
    return res.json({
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
    const solicitudes = await SolicitudAtencion.find({
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

// ====== Contingencia: registrar logística sin crear solicitudes clínicas ======
const crearContingencia = async (req, res) => {
  try {
    const { origenTipo, asociadoId, sucursalId } = req.body || {};
    const prioridad = req.body?.prioridad === 'URGENTE' ? 'URGENTE' : 'NORMAL';
    const rutaIngreso = req.body?.rutaIngreso === 'SUCURSAL' ? 'SUCURSAL' : 'DIRECTO';
    const muestrasIds = req.body?.muestrasIds;
    if (!['ASOCIADO', 'SUCURSAL_PROPIA'].includes(origenTipo)) {
      return error(res, 400, 'Origen de remisión inválido');
    }
    if (!Array.isArray(muestrasIds) || !muestrasIds.length || muestrasIds.length > 80 ||
        muestrasIds.some(id => !esId(id)) || new Set(muestrasIds.map(String)).size !== muestrasIds.length) {
      return error(res, 400, 'Seleccione entre 1 y 80 recipientes físicos distintos');
    }
    if ((origenTipo === 'ASOCIADO' && (!esId(asociadoId) || sucursalId)) ||
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
    if (origenTipo === 'ASOCIADO' && rutaIngreso !== 'DIRECTO') {
      return error(res, 422, 'La vía sucursal requiere un despacho previo; búsquelo por código');
    }
    const origenCodigo = origenTipo === 'ASOCIADO' ? maestro.codigoAsociado : maestro.codigo;
    const origenNombre = origenTipo === 'ASOCIADO'
      ? (maestro.nombreComercial || maestro.razonSocial || [maestro.nombres, maestro.apellidoPaterno, maestro.apellidoMaterno].filter(Boolean).join(' '))
      : (maestro.nombreCorto || maestro.nombre);
    const muestras = await MuestraLaboratorio.find({ _id: { $in: muestrasIds } })
      .select('solicitudAtencionId codSolicitud codigoLaboratorio codigoEtiqueta codMuestra coberturas tipoMuestraId tipoMuestra tuboEnvaseId tuboEnvase estadoMuestra').lean();
    if (muestras.length !== muestrasIds.length || muestras.some(m => !estadosTransportables.includes(m.estadoMuestra))) {
      return error(res, 422, 'Hay recipientes inexistentes o que no están disponibles para traslado');
    }
    const ocupadas = await RecepcionMuestras.exists({
      'remisiones.lineas.muestraLaboratorioId': { $in: muestrasIds },
    });
    if (ocupadas) return error(res, 409, 'Uno o más recipientes ya pertenecen a otro envío');
    const solicitudes = await SolicitudAtencion.find({
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
    // ====== Prefijo de contingencia independiente del correlativo de despacho futuro ======
    const codigoEnvio = `CNT-${new Date().getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
    const envio = await RecepcionMuestras.create({
      codigoEnvio,
      modoRegistro: 'CONTINGENCIA_CENTRAL',
      origenDespacho: origenTipo === 'ASOCIADO' ? 'ASOCIADO' : 'SUCURSAL',
      origenNombre,
      origenCodigo,
      rutaIngreso,
      prioridad,
      sedeOrigen: origenTipo === 'ASOCIADO' ? sedeOrigen : origenNombre,
      observacionRemision: limpio(req.body?.observacionRemision, 2000),
      estado: 'PENDIENTE_RECEPCION',
      remisiones: [{
        origenTipo,
        asociadoId: origenTipo === 'ASOCIADO' ? asociadoId : null,
        sucursalId: origenTipo === 'SUCURSAL_PROPIA' ? sucursalId : null,
        origenNombre,
        origenCodigo,
        referenciaRemision: limpio(req.body?.referenciaRemision, 120),
        lineas,
      }],
      lecturasPrevias: [],
      registradoPor: req.user.uid,
      usuarioRegistro: req.user.nombreUsuario || req.user.uid,
    });
    return res.status(201).json({ ok: true, msg: 'Contingencia registrada', recepcion: envio });
  } catch (e) {
    if (e.code === 11000) return error(res, 409, 'El código o un recipiente ya fue registrado en otro envío');
    if (e.name === 'ValidationError') return error(res, 422, e.message);
    console.error('Crear contingencia:', e);
    return error(res, 500, 'No se pudo registrar la contingencia');
  }
};

// ====== Confirmar una sola vez sin alterar el estado clínico de MuestraLaboratorio ======
const confirmarRecepcion = async (req, res) => {
  if (!esId(req.params.id)) return error(res, 400, 'Identificador de envío inválido');
  try {
    const envio = await RecepcionMuestras.findById(req.params.id).lean();
    if (!envio) return error(res, 404, 'Envío no encontrado');
    if (!estadosPorRecibir.includes(envio.estado) || envio.recepcionCentral) {
      return error(res, 409, 'Este envío ya fue recibido o no admite recepción');
    }
    const filas = (envio.remisiones || []).flatMap(r => r.lineas || []);
    const conteos = req.body?.conteos;
    if (!Array.isArray(conteos) || conteos.length !== filas.length || !filas.length) {
      return error(res, 400, 'Debe cotejar exactamente todos los recipientes declarados');
    }
    const ids = new Set(filas.map(l => String(l._id)));
    const conteoPorId = new Map();
    for (const fila of conteos) {
      const id = String(fila?.lineaId || '');
      const valor = fila?.cantidadRecibida;
      if (!ids.has(id) || conteoPorId.has(id) || !Number.isSafeInteger(valor) || valor < 0 || valor > 1) {
        return error(res, 400, 'Cantidad recibida inválida o línea repetida');
      }
      conteoPorId.set(id, valor);
    }
    const sinLectura = req.body?.sinLectura === true;
    const temperatura = req.body?.temperaturaC;
    const motivo = limpio(req.body?.motivoSinLectura, 500);
    if (sinLectura ? (temperatura !== null && temperatura !== undefined && temperatura !== '') || !motivo
      : (typeof temperatura !== 'number' || !Number.isFinite(temperatura))) {
      return error(res, 400, 'Registre temperatura de llegada numérica o motivo de no medición');
    }
    const totalDeclarado = filas.reduce((sum, l) => sum + l.cantidadDeclarada, 0);
    const totalRecibido = [...conteoPorId.values()].reduce((sum, n) => sum + n, 0);
    const incidencia = limpio(req.body?.incidencia, 2000);
    if (totalDeclarado !== totalRecibido && !incidencia) {
      return error(res, 400, 'Registre la incidencia por diferencia de cantidades');
    }
    const remisiones = envio.remisiones.map(r => ({ ...r, lineas: r.lineas.map(l => ({
      ...l, cantidadRecibida: conteoPorId.get(String(l._id)),
    })) }));
    const actualizado = await RecepcionMuestras.findOneAndUpdate(
      { _id: envio._id, estado: { $in: estadosPorRecibir }, recepcionCentral: null, __v: envio.__v },
      {
        $set: {
          estado: totalDeclarado === totalRecibido ? 'RECIBIDO_COMPLETO' : 'RECIBIDO_CON_DIFERENCIAS',
          remisiones,
          recepcionCentral: {
            fechaHora: new Date(),
            recibidoPor: req.user.uid,
            usuarioRecepcion: req.user.nombreUsuario || req.user.uid,
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
  buscarMuestras,
  listarRecepciones,
  obtenerRecepcion,
  crearContingencia,
  confirmarRecepcion,
};
