const mongoose = require('mongoose');
const Asociado = require('../../models/Mantenimiento/Asociado');
const Servicio = require('../../models/Mantenimiento/Servicio');
const PruebaLab = require('../../models/Mantenimiento/PruebaLab');
const Profesion = require('../../models/Mantenimiento/Profesiones');
const Especialidad = require('../../models/Mantenimiento/Especialidades');

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIPOS_CONTACTO = ['PAGOS_FINANZAS', 'LABORATORIO', 'DIRECTOR', 'ADMINISTRADOR', 'OTROS'];
const COMPROBANTES = ['RPH', 'BOLETA', 'FACTURA', 'NO_ESPECIFICA'];
const fallar = (msg) => { const e = new Error(msg); e.statusCode = 400; throw e; };
const str = (v) => String(v ?? '').trim();
const correoValido = (v, titulo) => { if (v && !EMAIL.test(v)) fallar(`${titulo}: correo inválido`); return v.toLowerCase(); };

// ====== Validar coordenadas de sede, siguiendo Sucursales ======
function coordenadasValidas(valor, sede) {
  const limpio = str(valor);
  if (!limpio) return '';
  if (!/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(limpio)) {
    fallar(`${sede}: coordenadas inválidas; utiliza latitud,longitud`);
  }
  const [latitud, longitud] = limpio.split(',').map(valor => Number(valor.trim()));
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud) ||
      latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
    fallar(`${sede}: coordenadas fuera de rango`);
  }
  return `${latitud},${longitud}`;
}

// ====== Validación por tipo de documento, como Pacientes ======
function identidad(body) {
  const tipoPersona = str(body.tipoPersona);
  if (tipoPersona === 'NATURAL') {
    const tipoDocumento = str(body.tipoDocumento).toUpperCase();
    const numeroDocumento = str(body.numeroDocumento).toUpperCase();
    const reglas = { DNI: /^\d{8}$/, CE: /^[A-Z0-9]{1,13}$/, PASAPORTE: /^[A-Z0-9]{1,16}$/ };
    if (!reglas[tipoDocumento] || !reglas[tipoDocumento].test(numeroDocumento)) fallar('Documento de persona natural inválido');
    if (!str(body.nombres) || !str(body.apellidoPaterno)) fallar('Nombres y apellido paterno son obligatorios');
    return { tipoPersona, identificadorClave: `NATURAL:${tipoDocumento}:${numeroDocumento}`,
      tipoDocumento, numeroDocumento, ruc: '', nombres: str(body.nombres),
      apellidoPaterno: str(body.apellidoPaterno), apellidoMaterno: str(body.apellidoMaterno),
      razonSocial: '', nombreComercial: str(body.nombreComercial), actividad: str(body.actividad),
      profesionId: body.profesionId || null, especialidadId: body.especialidadId || null };
  }
  if (tipoPersona === 'JURIDICA') {
    const ruc = str(body.ruc);
    if (!/^\d{11}$/.test(ruc)) fallar('RUC debe tener exactamente 11 dígitos');
    if (!str(body.razonSocial)) fallar('Razón social obligatoria');
    return { tipoPersona, identificadorClave: `JURIDICA:RUC:${ruc}`, tipoDocumento: null,
      numeroDocumento: '', ruc, nombres: '', apellidoPaterno: '', apellidoMaterno: '',
      razonSocial: str(body.razonSocial), nombreComercial: str(body.nombreComercial),
      actividad: str(body.actividad), profesionId: null, especialidadId: null };
  }
  return fallar('Tipo de persona inválido');
}
function horariosValidos(horarios, sede) {
  if (!Array.isArray(horarios) || horarios.length !== 7) fallar(`${sede}: configure los 7 días del horario`);
  const dias = new Set();
  return horarios.map(h => {
    if (!Number.isInteger(h.dia) || h.dia < 0 || h.dia > 6 || dias.has(h.dia) || typeof h.atiende !== 'boolean') fallar(`${sede}: día duplicado o inválido`);
    dias.add(h.dia);
    if (!Array.isArray(h.turnos)) fallar(`${sede}: turnos inválidos`);
    const turnos = h.turnos.map(t => ({ inicio: str(t.inicio), fin: str(t.fin) })).sort((a, b) => a.inicio.localeCompare(b.inicio));
    if (h.atiende !== (turnos.length > 0)) fallar(`${sede}: día ${h.dia} sin turnos o con turnos no permitidos`);
    for (let i=0; i<turnos.length; i++) {
      if (!HORARIO.test(turnos[i].inicio) || !HORARIO.test(turnos[i].fin) || turnos[i].inicio >= turnos[i].fin || (i && turnos[i].inicio < turnos[i-1].fin)) fallar(`${sede}: turnos inválidos o superpuestos del día ${h.dia}`);
    }
    return { dia: h.dia, atiende: h.atiende, turnos };
  }).sort((a,b) => a.dia-b.dia);
}
function sedesValidas(sedes) {
  if (!Array.isArray(sedes) || sedes.length < 1 || sedes.length > 100) fallar('Debe registrar entre 1 y 100 sedes');
  if (sedes.filter(s => s.principal === true).length !== 1) fallar('Debe existir una única sede principal');
  return sedes.map((s, i) => {
    const nombre = str(s.nombre);
    if (!nombre) fallar(`La sede ${i+1} necesita nombre`);
    if (!str(s.departamento) || !str(s.provincia) || !str(s.distrito) || !str(s.direccion)) fallar(`${nombre}: dirección y ubicación son obligatorias`);
    const contactos = s.contactos ?? [];
    const telefonos = s.telefonos ?? [];
    if (!Array.isArray(contactos) || !Array.isArray(telefonos)) fallar(`${nombre}: contactos o teléfonos inválidos`);
    if (contactos.length && contactos.filter(c => c.principal === true).length !== 1) fallar(`${nombre}: seleccione exactamente un contacto principal`);
    return {
      nombre, principal: s.principal === true, departamento: str(s.departamento), provincia: str(s.provincia),
      distrito: str(s.distrito), direccion: str(s.direccion),
      coordenadasMaps: coordenadasValidas(s.coordenadasMaps, nombre), telefono: str(s.telefono),
      correo: correoValido(str(s.correo), nombre),
      telefonos: telefonos.map(t => {
        if (!str(t.numero) || !str(t.descripcion)) fallar(`${nombre}: cada teléfono adicional necesita número y descripción`);
        return { numero: str(t.numero), descripcion: str(t.descripcion) };
      }),
      contactos: contactos.map(c => {
        if (!str(c.nombre) || !TIPOS_CONTACTO.includes(c.tipo)) fallar(`${nombre}: contacto sin nombre o clasificación`);
        if (c.tipo === 'OTROS' && !str(c.otro)) fallar(`${nombre}: especifique la clasificación Otros`);
        return { nombre: str(c.nombre), cargo: str(c.cargo), tipo: c.tipo,
          otro: c.tipo === 'OTROS' ? str(c.otro) : '', telefono: str(c.telefono),
          correo: correoValido(str(c.correo), `Contacto ${str(c.nombre)}`), principal: c.principal === true };
      }),
      horarios: horariosValidos(s.horarios, nombre),
    };
  });
}
function convenioValido(c) {
  if (!c || (c.enviaMuestras !== true && c.derivaPacientes !== true)) fallar('Seleccione al menos una modalidad de convenio');
  const plazo = Number(c.plazoCreditoDias);
  if (!Number.isInteger(plazo) || plazo < 0 || plazo > 365) fallar('Plazo de crédito inválido');
  if (!['SEMANAL', 'QUINCENAL', 'MENSUAL'].includes(c.periodicidad)) fallar('Periodicidad inválida');
  if (!['CON_MEMBRETE', 'SIN_MEMBRETE'].includes(c.presentacionInforme)) fallar('Presentación del informe inválida');
  const anteriores = c.porcentajeComision;
  if (anteriores != null && anteriores !== '' && (!Number.isFinite(Number(anteriores)) || Number(anteriores) < 0 || Number(anteriores) > 100)) {
    fallar('Porcentaje general anterior inválido');
  }
  return {
    enviaMuestras: c.enviaMuestras === true, derivaPacientes: c.derivaPacientes === true,
    // ====== Legado: se mantiene solo para consulta de registros antiguos ======
    porcentajeComision: c.derivaPacientes && anteriores != null && anteriores !== '' ? Number(anteriores) : null,
    periodicidad: c.periodicidad, plazoCreditoDias: plazo,
    presentacionInforme: c.presentacionInforme, condicionComision: 'PAGO_COMPLETO',
    comisionesPorTipo: c.derivaPacientes ? (c.comisionesPorTipo ?? []) : [],
  };
}

// ====== Comisiones por tipo y servicio ======
async function comisionesValidas(convenio, lista, idsTarifario) {
  if (!Array.isArray(convenio.comisionesPorTipo) || !Array.isArray(lista)) fallar('Comisiones inválidas');
  if (!convenio.derivaPacientes) {
    if (convenio.comisionesPorTipo.length || lista.length) fallar('Desactive las comisiones cuando el convenio no incluye derivación');
    return { porTipo: [], porServicio: [] };
  }
  if (lista.length > 5000) fallar('Demasiados servicios con comisión');
  const tipos = new Map();
  const porcentajeValido = valor => typeof valor === 'number' && Number.isFinite(valor) && valor > 0 && valor <= 100
    && Math.abs(Math.round(valor * 100) - valor * 100) < 1e-7;
  const catalogo = await Servicio.find({ estadoServicio: true }).select('_id tipoServicio claseServicio').lean();
  const porId = new Map(catalogo.map(s => [String(s._id), s]));
  const disponibles = new Set(catalogo.map(s => s.tipoServicio || (s.claseServicio === 'PAQUETE' ? 'Paquete' : 'No definido')));
  for (const item of convenio.comisionesPorTipo) {
    const tipo = str(item.tipoServicio);
    const porcentaje = Number(item.porcentaje);
    if (!disponibles.has(tipo) || tipos.has(tipo) || !porcentajeValido(porcentaje)) fallar('Porcentaje o tipo de servicio inválido o duplicado');
    tipos.set(tipo, porcentaje);
  }
  const ids = new Set();
  const resultado = [];
  for (const item of lista) {
    const id = String(item.servicioId || '');
    if (!mongoose.isValidObjectId(id) || ids.has(id) || idsTarifario.has(id) || !porId.has(id)) {
      fallar('Servicio duplicado, inexistente o asignado simultáneamente a tarifario y comisión');
    }
    ids.add(id);
    const s = porId.get(id);
    const tipo = s.tipoServicio || (s.claseServicio === 'PAQUETE' ? 'Paquete' : 'No definido');
    const personalizado = item.porcentajePersonalizado == null || item.porcentajePersonalizado === ''
      ? null : Number(item.porcentajePersonalizado);
    if (personalizado !== null && !porcentajeValido(personalizado)) fallar('Comisión personalizada inválida (0 a 100 %, máximo dos decimales)');
    if (personalizado === null && !tipos.has(tipo)) fallar(`Configure comisión general para ${tipo} o un porcentaje personalizado`);
    resultado.push({ servicioId: id, porcentajePersonalizado: personalizado });
  }
  if (!resultado.length) fallar('Seleccione al menos un servicio que genere comisión');
  return { porTipo: [...tipos].map(([tipoServicio, porcentaje]) => ({ tipoServicio, porcentaje })), porServicio: resultado };
}
function comprobantesValidos(list) {
  if (!Array.isArray(list) || !list.length || list.some(x => !COMPROBANTES.includes(x)) || new Set(list).size !== list.length) fallar('Seleccione comprobantes válidos');
  if (list.includes('NO_ESPECIFICA') && list.length > 1) fallar('No especifica no puede combinarse con otro comprobante');
  return list;
}
async function tarifasValidas(list) {
  if (!Array.isArray(list)) fallar('Servicios habilitados inválidos');
  if (list.length > 5000) fallar('Demasiados servicios habilitados');
  const ids = list.map(t => String(t.servicioId));
  if (ids.some(id => !mongoose.isValidObjectId(id)) || new Set(ids).size !== ids.length) fallar('Servicio duplicado o inválido');
  const disponibles = await Servicio.countDocuments({ _id: { $in: ids }, estadoServicio: true });
  if (disponibles !== ids.length) fallar('Algunos servicios no existen o están inactivos');
  return list.map(t => {
    const precio = t.precioPersonalizado == null || t.precioPersonalizado === '' ? null : Number(t.precioPersonalizado);
    if (precio !== null && (!Number.isFinite(precio) || precio < 0 || Math.abs(Math.round(precio * 100) - precio * 100) > 1e-7)) fallar('Precio personalizado inválido; máximo dos decimales');
    return { servicioId: t.servicioId, precioPersonalizado: precio };
  });
}
async function construir(body) {
  const id = identidad(body);
  for (const campo of ['profesionId', 'especialidadId']) if (id[campo] && !mongoose.isValidObjectId(id[campo])) fallar(`Referencia ${campo} inválida`);
  if (id.profesionId && !await Profesion.exists({ _id: id.profesionId, estadoProfesion: true })) fallar('La profesión seleccionada no está vigente');
  if (id.especialidadId) {
    if (!id.profesionId) fallar('Seleccione la profesión correspondiente');
    const especialidad = await Especialidad.findOne({ _id: id.especialidadId, estadoEspecialidad: true }).select('profesionRef').lean();
    if (!especialidad || String(especialidad.profesionRef) !== String(id.profesionId)) fallar('La especialidad no pertenece a la profesión seleccionada');
  }
  const convenio = convenioValido(body.convenio);
  const serviciosHabilitados = await tarifasValidas(body.serviciosHabilitados ?? []);
  if (!convenio.enviaMuestras && serviciosHabilitados.length) fallar('El convenio no incluye envío de muestras con tarifario');
  const idsTarifario = new Set(serviciosHabilitados.map(s => String(s.servicioId)));
  const comisiones = await comisionesValidas(convenio, body.serviciosComisionables ?? [], idsTarifario);
  convenio.comisionesPorTipo = comisiones.porTipo;
  return { ...id, sedes: sedesValidas(body.sedes), convenio,
    serviciosHabilitados, serviciosComisionables: comisiones.porServicio,
    comprobantes: comprobantesValidos(body.comprobantes), observaciones: str(body.observaciones),
    activo: body.activo !== false };
}
function errorHttp(res, err, texto) {
  if (err.code === 11000) return res.status(409).json({ ok: false, msg: 'Ya existe un asociado con el mismo documento' });
  if (err.name === 'VersionError') return res.status(409).json({ ok: false, msg: 'El registro fue actualizado por otro usuario; recárguelo' });
  if (err.statusCode || err.name === 'ValidationError') return res.status(err.statusCode || 400).json({ ok: false, msg: err.message });
  console.error(texto, err);
  return res.status(500).json({ ok: false, msg: texto });
}

// ====== Catálogo dinámico; la tarifa general de asociados será otro maestro ======
exports.catalogoServicios = async (_req, res) => {
  try {
    const servicios = await Servicio.find({ estadoServicio: true }).select('codServicio nombreServicio claseServicio tipoServicio precioServicio examenesServicio').lean();
    const refs = [...new Set(servicios.flatMap(s => (s.examenesServicio || []).filter(e => e.tipoExamen === 'LABORATORIO' && e.referenciaId).map(e => String(e.referenciaId))))];
    const pruebas = await PruebaLab.find({ _id: { $in: refs } }).select('areaLab').lean();
    const areas = new Map(pruebas.map(p => [String(p._id), p.areaLab]));
    const catalogo = servicios.map(s => {
      const areaSet = [...new Set((s.examenesServicio || []).filter(e => e.tipoExamen === 'LABORATORIO').map(e => areas.get(String(e.referenciaId))).filter(Boolean))];
      return { _id: s._id, codServicio: s.codServicio, nombreServicio: s.nombreServicio,
        claseServicio: s.claseServicio, tipoServicio: s.tipoServicio || (s.claseServicio === 'PAQUETE' ? 'Paquete' : 'No definido'),
        areaLaboratorio: areaSet.length === 1 ? areaSet[0] : areaSet.length > 1 ? 'Varias áreas' : '',
        precioReferencia: s.precioServicio };
    });
    res.json({ ok: true, servicios: catalogo });
  } catch (err) { errorHttp(res, err, 'No se pudo consultar el catálogo de servicios'); }
};
exports.listar = async (req, res) => {
  try {
    // ====== Buscar por palabras en nombres, apellidos, razón social y documento ======
    const termino = str(req.query.search).slice(0, 120);
    const palabras = termino.split(/\s+/).filter(Boolean).slice(0, 8);
    const campos = ['razonSocial', 'nombreComercial', 'nombres', 'apellidoPaterno', 'apellidoMaterno', 'ruc', 'numeroDocumento'];
    const acentos = { a: '[aáàäâ]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöô]', u: '[uúùüû]', n: '[nñ]' };
    const filtro = palabras.length ? {
      $and: palabras.map(palabra => {
        const texto = [...palabra].map(letra => {
          const normal = letra.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          return acentos[normal] || letra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('');
        return { $or: campos.map(campo => ({ [campo]: { $regex: texto, $options: 'i' } })) };
      }),
    } : {};
    const asociados = await Asociado.find(filtro)
      .select('tipoPersona nombres apellidoPaterno apellidoMaterno razonSocial nombreComercial tipoDocumento numeroDocumento ruc activo convenio createdAt')
      .sort({ createdAt: -1 }).limit(200).lean();
    res.json({ ok: true, asociados, limitado: asociados.length === 200 });
  } catch (err) { errorHttp(res, err, 'No se pudo listar asociados'); }
};
exports.obtener = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, msg: 'ID inválido' });
  try {
    const asociado = await Asociado.findById(req.params.id).lean();
    if (!asociado) return res.status(404).json({ ok: false, msg: 'Asociado no encontrado' });
    res.json({ ok: true, asociado });
  } catch (err) { errorHttp(res, err, 'No se pudo obtener el asociado'); }
};
exports.crear = async (req, res) => {
  try {
    const payload = await construir(req.body);
    const asociado = await Asociado.create({ ...payload, createdBy: req.user.uid, usuarioRegistro: req.user.nombreUsuario || '' });
    res.status(201).json({ ok: true, asociado });
  } catch (err) { errorHttp(res, err, 'No se pudo crear el asociado'); }
};
exports.actualizar = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, msg: 'ID inválido' });
  try {
    if (!Number.isInteger(req.body.__v) || req.body.__v < 0) fallar('Se requiere versión del registro para actualizar');
    const asociado = await Asociado.findById(req.params.id);
    if (!asociado) return res.status(404).json({ ok: false, msg: 'Asociado no encontrado' });
    if (asociado.__v !== req.body.__v) return res.status(409).json({ ok: false, msg: 'El registro cambió; recárguelo' });
    const payload = await construir(req.body);
    if (payload.identificadorClave !== asociado.identificadorClave) fallar('El tipo o documento no se cambia por edición normal');
    delete payload.identificadorClave;
    asociado.set({ ...payload, updatedBy: req.user.uid, usuarioActualizacion: req.user.nombreUsuario || '' });
    await asociado.save();
    res.json({ ok: true, asociado });
  } catch (err) { errorHttp(res, err, 'No se pudo actualizar el asociado'); }
};
