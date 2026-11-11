const mongoose = require('mongoose');
const RecepcionMuestras = require('../../models/Gestion/RecepcionMuestras');
const SolicitudAtencion = require('../../models/Gestion/SolicitudAtencion');
const Paciente = require('../../models/Mantenimiento/Paciente');
const PruebaLab = require('../../models/Mantenimiento/PruebaLab');
const Servicio = require('../../models/Mantenimiento/Servicio');
const Asociado = require('../../models/Mantenimiento/Asociado');
const { crearSolicitudesAtencion } = require('./solicitudAtencionController');

const responder = (res, status, msg) => res.status(status).json({ ok: false, msg });
const identificador = valor => mongoose.isValidObjectId(valor);
const texto = (valor, max = 100) => String(valor ?? '').trim().slice(0, max);

// ====== Remisiones aptas para confirmación en Recepción Central ======
const esRecibida = envio => envio.modoRegistro === 'CONTINGENCIA_CENTRAL' &&
  envio.estado === 'REGISTRADA_CENTRAL' ||
  envio.modoRegistro === 'DESPACHO_REGISTRADO' &&
  ['RECIBIDO_COMPLETO', 'RECIBIDO_CON_DIFERENCIAS'].includes(envio.estado);

const extraerAtenciones = envio => (envio.remisiones || []).flatMap(remision =>
  (remision.pacientesAdministrativos || []).map(p => ({
    remisionId: remision._id,
    origenRemisionTipo: remision.origenTipo,
    origen: remision.origenNombre,
    asociadoId: remision.asociadoId,
    clave: p.clave,
    nombre: p.nombre,
    documento: p.documento || '',
    hc: p.hc || '',
    pacienteId: p.pacienteId,
    pruebas: p.pruebas || [],
  })),
);

// ====== Advertencia, nunca bloqueo por paciente y pruebas repetidas ======
const calcularCoincidencias = atenciones => {
  const grupos = new Map();
  for (const a of atenciones) {
    const identidad = a.pacienteId ? String(a.pacienteId) : texto(a.documento, 50).toUpperCase();
    if (!identidad || !a.pruebas.length) continue;
    const clavesPruebas = a.pruebas.map(p => texto(p.codPruebaLab, 30)).sort().join('|');
    const clave = `${identidad}:${clavesPruebas}`;
    grupos.set(clave, [...(grupos.get(clave) || []), `${a.remisionId}:${a.clave}`]);
  }
  const repetidas = [...grupos.values()].filter(g => g.length > 1);
  return { grupos: repetidas.length, claves: new Set(repetidas.flat()) };
};

// ====== Validar servicios habilitados, incluso los incluidos en paquetes ======
const serviciosHabilitadosAsociado = async (asociadoId, session) => {
  if (!asociadoId) return null;
  let consulta = Asociado.findById(asociadoId).select('activo convenio serviciosHabilitados');
  if (session) consulta = consulta.session(session);
  const asociado = await consulta.lean();
  if (!asociado?.activo || !asociado.convenio?.enviaMuestras) {
    throw new Error('El asociado no está habilitado para remitir muestras');
  }
  const habilitados = new Set();
  let pendientes = (asociado.serviciosHabilitados || []).map(item => String(item.servicioId || '')).filter(Boolean);
  for (let nivel = 0; nivel < 4 && pendientes.length; nivel++) {
    const nuevos = [...new Set(pendientes)].filter(id => !habilitados.has(id));
    nuevos.forEach(id => habilitados.add(id));
    if (!nuevos.length) break;
    let query = Servicio.find({ _id: { $in: nuevos }, estadoServicio: true })
      .select('serviciosIncluidos');
    if (session) query = query.session(session);
    const documentos = await query.lean();
    pendientes = documentos.flatMap(s => (s.serviciosIncluidos || []).map(x => String(x.servicioId || '')).filter(Boolean));
  }
  return habilitados;
};

// ====== Resolver servicios clínicos sin inferir servicios no solicitados ======
const resolverServicios = async (atencion, session = null) => {
  if (!identificador(atencion.pacienteId)) {
    throw new Error('Vincule el paciente con su historia clínica del maestro antes de confirmar');
  }
  let consulta = Paciente.findById(atencion.pacienteId);
  if (session) consulta = consulta.session(session);
  const paciente = await consulta.lean();
  if (!paciente?.hc || !paciente.nombreCliente || !paciente.apePatCliente) {
    throw new Error('El paciente debe tener HC, apellidos y nombres válidos');
  }
  if (!atencion.pruebas.length) throw new Error('La atención no tiene pruebas declaradas');

  const codigos = atencion.pruebas.map(p => texto(p.codPruebaLab, 50).toUpperCase());
  if (new Set(codigos).size !== codigos.length) throw new Error('La atención contiene pruebas repetidas');
  let consultaPruebas = PruebaLab.find({ codPruebaLab: { $in: codigos }, estadoPrueba: 'ACTIVO' })
    .select('_id codPruebaLab nombrePruebaLab');
  if (session) consultaPruebas = consultaPruebas.session(session);
  const pruebas = await consultaPruebas.lean();
  if (pruebas.length !== codigos.length) throw new Error('Una prueba del catálogo ya no está activa');

  const idsPruebas = pruebas.map(p => p._id);
  let queryServicios = Servicio.find({ estadoServicio: true, claseServicio: 'INDIVIDUAL',
    examenesServicio: { $elemMatch: { tipoExamen: 'LABORATORIO', referenciaId: { $in: idsPruebas } } },
  }).select('_id codServicio nombreServicio tipoServicio examenesServicio');
  if (session) queryServicios = queryServicios.session(session);
  const servicios = await queryServicios.lean();
  const permitidos = await serviciosHabilitadosAsociado(atencion.asociadoId, session);
  const porId = new Map();
  for (const servicio of servicios) {
    if (permitidos && !permitidos.has(String(servicio._id))) continue;
    if (!['LAB', 'LABORATORIO'].includes(texto(servicio.tipoServicio, 30).toUpperCase())) continue;
    const examenes = (servicio.examenesServicio || []).filter(e => e.tipoExamen === 'LABORATORIO' && e.referenciaId);
    // Solo servicios individuales que representen exactamente la prueba solicitada.
    if (examenes.length !== 1) continue;
    const id = String(examenes[0].referenciaId);
    porId.set(id, [...(porId.get(id) || []), servicio]);
  }

  const serviciosSeleccionados = [];
  for (const codigo of codigos) {
    const prueba = pruebas.find(p => p.codPruebaLab.toUpperCase() === codigo);
    const candidatos = porId.get(String(prueba._id)) || [];
    if (!candidatos.length) throw new Error(`La prueba ${codigo} no tiene un servicio individual de laboratorio compatible`);
    if (candidatos.length > 1) throw new Error(`La prueba ${codigo} tiene varios servicios posibles; requiere configurar la vinculación`);
    serviciosSeleccionados.push({ servicioId: candidatos[0]._id, cantidad: 1 });
  }

  return { paciente: {
    clienteId: paciente._id, hc: paciente.hc, tipoDoc: paciente.tipoDoc || null,
    nroDoc: paciente.nroDoc || null, nombreCliente: paciente.nombreCliente,
    apePatCliente: paciente.apePatCliente, apeMatCliente: paciente.apeMatCliente || '',
  }, servicios: serviciosSeleccionados };
};

// ====== Estado por cada fila de atención ======
const listarAtencionesRecepcion = async (req, res) => {
  if (!identificador(req.params.id)) return responder(res, 400, 'Remisión inválida');
  try {
    const envio = await RecepcionMuestras.findById(req.params.id).lean();
    if (!envio) return responder(res, 404, 'Remisión no encontrada');
    const atenciones = extraerAtenciones(envio);
    const duplicadas = calcularCoincidencias(atenciones);
    const confirmadas = new Map((envio.atencionesConfirmadas || [])
      .map(c => [`${c.remisionId}:${c.claveAtencion}`, c]));
    const filas = [];
    for (const a of atenciones) {
      const claveUnica = `${a.remisionId}:${a.clave}`;
      const confirmada = confirmadas.get(claveUnica);
      let motivoNoConfirmable = '';
      if (!confirmada) {
        if (!esRecibida(envio)) motivoNoConfirmable = 'Primero registre la recepción administrativa en Central';
        else {
          try { await resolverServicios(a); }
          catch (err) { motivoNoConfirmable = err.message; }
        }
      }
      filas.push({
        clave: claveUnica, remisionId: String(a.remisionId), nombre: a.nombre,
        documento: a.documento, hc: a.hc, pruebas: a.pruebas, origen: a.origen,
        confirmada: !!confirmada, solicitudAtencionId: confirmada ? String(confirmada.solicitudAtencionId) : null,
        codSolicitud: confirmada?.codSolicitud || null,
        codigoLaboratorio: confirmada?.codigoLaboratorio || null,
        sePuedeConfirmar: !confirmada && !motivoNoConfirmable,
        motivoNoConfirmable, coincidencia: duplicadas.claves.has(claveUnica),
      });
    }
    return res.json({ ok: true, codigoEnvio: envio.codigoEnvio, version: envio.__v,
      atenciones: filas, coincidencias: duplicadas.grupos });
  } catch (e) {
    console.error('Consultar atenciones recepción:', e);
    return responder(res, 500, 'No se pudieron consultar las atenciones de la remisión');
  }
};

// ====== Confirmar atenciones en una transacción, sin deduplicar por DNI ======
const confirmarAtencionesRecepcion = async (req, res) => {
  if (!identificador(req.params.id)) return responder(res, 400, 'Remisión inválida');
  const claves = req.body?.claves;
  const version = req.body?.version;
  if (!Array.isArray(claves) || !claves.length || claves.length > 30 ||
      claves.some(c => !texto(c, 80)) || new Set(claves).size !== claves.length) {
    return responder(res, 400, 'Seleccione entre 1 y 30 atenciones diferentes');
  }
  if (!Number.isInteger(version) || version < 0) return responder(res, 400, 'Actualice la remisión antes de confirmar');
  const observacion = texto(req.body?.observacion, 500);
  const session = await mongoose.startSession();
  let confirmadas = 0;
  try {
    await session.withTransaction(async () => {
      const envio = await RecepcionMuestras.findById(req.params.id).session(session).lean();
      if (!envio) { const e = new Error('Remisión no encontrada'); e.status = 404; throw e; }
      if (!esRecibida(envio)) { const e = new Error('La remisión todavía no está recibida administrativamente'); e.status = 409; throw e; }
      if (envio.__v !== version) { const e = new Error('La remisión cambió, recárguela antes de confirmar'); e.status = 409; throw e; }
      const atenciones = extraerAtenciones(envio);
      const seleccionadas = claves.map(clave => atenciones.find(a => `${a.remisionId}:${a.clave}` === clave));
      if (seleccionadas.some(a => !a)) { const e = new Error('Una atención ya no existe en la remisión'); e.status = 409; throw e; }
      const confirmadasActuales = new Set((envio.atencionesConfirmadas || []).map(a => `${a.remisionId}:${a.claveAtencion}`));
      if (seleccionadas.some(a => confirmadasActuales.has(`${a.remisionId}:${a.clave}`))) {
        const e = new Error('Una atención seleccionada ya tiene solicitud. Actualice la pantalla'); e.status = 409; throw e;
      }
      const referencias = [];
      for (const atencion of seleccionadas) {
        let datos;
        try { datos = await resolverServicios(atencion, session); }
        catch (error) { error.status = 422; throw error; }
        const nuevas = await crearSolicitudesAtencion({
          origenAtencion: 'RECEPCION_MUESTRAS',
          servicios: datos.servicios, paciente: datos.paciente,
          datosOrigen: {
            recepcionMuestrasId: envio._id,
            claveAtencionRecepcion: atencion.clave,
            remisionItemId: atencion.remisionId,
            codigoRemisionOrigen: envio.codigoEnvio,
            origenRemisionTipo: atencion.origenRemisionTipo,
          },
          session, uid: req.user.uid, nombreUsuario: req.user.nombreUsuario,
        });
        if (nuevas.length !== 1 || nuevas[0].tipo !== 'Laboratorio') {
          throw new Error('La atención debe generar exactamente una solicitud de laboratorio');
        }
        const sol = nuevas[0];
        referencias.push({
          claveAtencion: atencion.clave, remisionId: atencion.remisionId,
          solicitudAtencionId: sol._id, codSolicitud: sol.codSolicitud,
          codigoLaboratorio: sol.codigoLaboratorio || '', fechaConfirmacion: new Date(),
          confirmadoPor: String(req.user.uid), usuarioConfirmacion: String(req.user.nombreUsuario), observacion,
        });
      }
      const modificado = await RecepcionMuestras.findOneAndUpdate(
        { _id: envio._id, __v: version },
        { $push: { atencionesConfirmadas: { $each: referencias } }, $inc: { __v: 1 } },
        { session, new: true, runValidators: true },
      );
      if (!modificado) { const e = new Error('Otro usuario modificó la remisión; actualice la pantalla'); e.status = 409; throw e; }
      confirmadas = referencias.length;
    });
    return res.json({ ok: true, confirmadas, version: version + 1 });
  } catch (e) {
    if (e.status) return responder(res, e.status, e.message);
    if (e.code === 11000 || /WriteConflict|TransientTransactionError/.test(e.message || '')) {
      return responder(res, 409, 'El correlativo o la atención cambió durante la confirmación. Actualice y vuelva a intentar');
    }
    console.error('Confirmar atenciones:', e);
    return responder(res, 500, 'No se pudieron generar las solicitudes clínicas; no se confirmó ninguna atención');
  } finally { await session.endSession(); }
};

// ====== Imprimir únicamente la solicitud vinculada a la remisión ======
const obtenerSolicitudConfirmada = async (req, res) => {
  if (!identificador(req.params.id)) return responder(res, 400, 'Remisión inválida');
  try {
    const envio = await RecepcionMuestras.findById(req.params.id).select('atencionesConfirmadas').lean();
    if (!envio) return responder(res, 404, 'Remisión no encontrada');
    const referencia = (envio.atencionesConfirmadas || [])
      .find(c => `${c.remisionId}:${c.claveAtencion}` === req.params.clave);
    if (!referencia) return responder(res, 404, 'Esta atención aún no tiene solicitud confirmada');
    const solicitud = await SolicitudAtencion.findOne({ _id: referencia.solicitudAtencionId,
      recepcionMuestrasId: envio._id, claveAtencionRecepcion: referencia.claveAtencion,
      remisionItemId: referencia.remisionId }).lean();
    if (!solicitud) return responder(res, 404, 'No se encontró la solicitud clínica vinculada');
    return res.json({ ok: true, solicitud });
  } catch (e) {
    console.error('Cargar solicitud para imprimir:', e);
    return responder(res, 500, 'No se pudo cargar la solicitud');
  }
};

module.exports = { listarAtencionesRecepcion, confirmarAtencionesRecepcion, obtenerSolicitudConfirmada };
