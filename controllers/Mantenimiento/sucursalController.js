const mongoose = require('mongoose');
const { response } = require('express');
const Sucursal = require('../../models/Mantenimiento/Sucursal');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const { subirArchivoStorage, generarUrlTemporal, eliminarArchivo } = require('../../utils/aws/s3Storage');

const DIAS = [0, 1, 2, 3, 4, 5, 6];
const TIPOS_ARCHIVO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const CAMPOS_TEXTO = ['nombre', 'nombreCorto', 'departamento', 'provincia', 'distrito', 'direccion', 'referencia', 'coordenadasMaps', 'telefono', 'whatsapp', 'correo', 'observaciones'];
const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const COORDENADAS_REGEX = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;
const CAMPOS_CONTACTO = ['telefono', 'whatsapp', 'correo', 'observaciones'];

// ====== Validar fechas y turnos ======
function validarFecha(valor, campo) {
  if (valor === null || valor === '' || valor === undefined) return null;
  if (typeof valor !== 'string' || !FECHA_VALIDA.test(valor) || Number.isNaN(new Date(`${valor}T12:00:00Z`).getTime()) || new Date(`${valor}T12:00:00Z`).toISOString().slice(0, 10) !== valor) {
    throw new Error(`${campo} debe ser una fecha válida (AAAA-MM-DD)`);
  }
  return valor;
}
function validarCoordenadas(valor) {
  if (!valor) return '';
  const limpio = String(valor).trim();
  if (!limpio) return '';
  if (!COORDENADAS_REGEX.test(limpio)) throw new Error('Las coordenadas deben tener el formato latitud,longitud');
  const [latitud, longitud] = limpio.split(',').map((item) => Number(item.trim()));
  if (Number.isNaN(latitud) || Number.isNaN(longitud) || latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
    throw new Error('Las coordenadas están fuera de rango');
  }
  return `${latitud},${longitud}`;
}
function construirUrlMaps(coordenadas) {
  if (!coordenadas) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(coordenadas)}`;
}
function validarTurnos(turnos, etiqueta) {
  if (!Array.isArray(turnos)) throw new Error(`${etiqueta}: turnos debe ser un array`);
  const lista = turnos.map((t) => {
    if (!t || typeof t !== 'object' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.inicio) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.fin) || t.fin <= t.inicio) {
      throw new Error(`${etiqueta}: horario inválido; fin debe ser posterior a inicio`);
    }
    return { inicio: t.inicio, fin: t.fin };
  }).sort((a, b) => a.inicio.localeCompare(b.inicio));
  if (lista.some((t, i) => i > 0 && t.inicio < lista[i - 1].fin)) {
    throw new Error(`${etiqueta}: existen turnos superpuestos`);
  }
  return lista;
}
function validarHorarios(horarios) {
  if (!Array.isArray(horarios) || horarios.length !== 7) throw new Error('Debe configurar los siete días de la semana');
  const dias = new Set();
  const salida = horarios.map((h) => {
    if (!h || !DIAS.includes(h.dia) || dias.has(h.dia) || typeof h.atiende !== 'boolean') {
      throw new Error('Días de atención duplicados o inválidos');
    }
    dias.add(h.dia);
    const turnos = validarTurnos(h.turnos, `Día ${h.dia}`);
    if (h.atiende !== (turnos.length > 0)) throw new Error(`Día ${h.dia}: configure turnos o marque sin atención`);
    return { dia: h.dia, atiende: h.atiende, turnos };
  });
  return salida.sort((a, b) => a.dia - b.dia);
}
// ====== Conservar versiones anteriores y documentos S3 ======
function normalizarPermisos(permisos, original, usuario = '') {
  if (!Array.isArray(permisos)) throw new Error('Permisos debe ser un array');
  const previos = new Map((original?.permisos ?? []).map((p) => [String(p._id), p]));
  const usados = new Set();
  const tipos = new Set();
  const nuevos = permisos.map((p) => {
    if (!p || typeof p.tipoPermiso !== 'string' || !p.tipoPermiso.trim() ||
        typeof p.numeroDocumento !== 'string' || !p.numeroDocumento.trim() ||
        typeof p.entidadEmisora !== 'string' || !p.entidadEmisora.trim()) {
      throw new Error('Cada permiso requiere tipo, número de documento y entidad emisora');
    }
    const id = p._id ? String(p._id) : null;
    if (id && (!mongoose.isValidObjectId(id) || !previos.has(id) || usados.has(id))) {
      throw new Error('Identificador de permiso inválido o duplicado');
    }
    if (id) usados.add(id);
    const previo = id ? previos.get(id) : null;
    const tipo = String(p.tipoPermiso).trim();
    const tipoClave = tipo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (tipos.has(tipoClave)) throw new Error('No puede registrar dos permisos del mismo tipo; utilice Renovar para nuevas versiones');
    tipos.add(tipoClave);
    if (previo && previo.tipoPermiso !== tipo) throw new Error('No puede cambiar el tipo de un permiso guardado; cree un permiso adicional');

    const fechaEmision = validarFecha(p.fechaEmision, 'Fecha de emisión');
    const fechaVencimiento = validarFecha(p.fechaVencimiento, 'Fecha de vencimiento');
    if (fechaEmision && fechaVencimiento && fechaVencimiento < fechaEmision) throw new Error('Vencimiento anterior a emisión');

    const renovar = p.renovar === true;
    // ====== No sobrescribir datos de una versión ya emitida ======
    if (previo && !renovar) {
      const fechaBase = (valor) => valor ? new Date(valor).toISOString().slice(0, 10) : null;
      const cambio = ['numeroDocumento', 'entidadEmisora', 'observaciones']
        .some((campo) => String(previo[campo] || '').trim() !== String(p[campo] || '').trim());
      const fechasCambiadas = fechaBase(previo.fechaEmision) !== fechaEmision || fechaBase(previo.fechaVencimiento) !== fechaVencimiento;
      if (cambio || fechasCambiadas) throw new Error('Para cambiar datos de un permiso guardado use Registrar nueva versión');
    }
    if (renovar && !previo) throw new Error('Primero debe guardar el permiso inicial antes de renovarlo');
    if (renovar && !fechaEmision) throw new Error('La nueva versión requiere fecha de emisión');
    const historialPrevio = previo?.historial?.map((h) => h.toObject()) || [];
    const historial = renovar ? [
      ...historialPrevio,
      {
        versionNumero: previo.versionActual || 1,
        numeroDocumento: previo.numeroDocumento,
        entidadEmisora: previo.entidadEmisora,
        fechaEmision: previo.fechaEmision || null,
        fechaVencimiento: previo.fechaVencimiento || null,
        observaciones: previo.observaciones || '',
        archivos: previo.archivos.map((a) => a.toObject()),
        fechaReemplazo: new Date(),
        motivoReemplazo: typeof p.motivoRenovacion === 'string' ? p.motivoRenovacion.trim().slice(0, 250) : '',
        reemplazadoPor: usuario,
      },
    ] : historialPrevio;

    return {
      ...(id ? { _id: id } : {}),
      tipoPermiso: tipo,
      numeroDocumento: p.numeroDocumento.trim(),
      entidadEmisora: p.entidadEmisora.trim(),
      fechaEmision,
      fechaVencimiento,
      observaciones: String(p.observaciones || '').trim(),
      versionActual: renovar ? (previo.versionActual || 1) + 1 : (previo?.versionActual || 1),
      historial,
      // ====== El cliente nunca puede escribir referencias de almacenamiento ======
      archivos: renovar ? [] : (previo ? previo.archivos.map((a) => a.toObject()) : []),
    };
  });
  for (const id of previos.keys()) {
    if (!usados.has(id)) throw new Error('Los permisos guardados no pueden eliminarse; se conserva su historial');
  }
  return nuevos;
}
async function normalizarPersonal(personal) {
  if (!Array.isArray(personal)) throw new Error('Personal debe ser un array');
  const ids = new Set();
  let responsables = 0;
  for (const persona of personal) {
    const id = String(persona?.recursoHumanoId || '');
    if (!mongoose.isValidObjectId(id) || ids.has(id)) throw new Error('Personal duplicado o con identificador inválido');
    ids.add(id);
    if (persona.esResponsable && !persona.activo) throw new Error('El responsable debe estar activo');
    if (persona.esResponsable) responsables++;
  }
  if (responsables > 1) throw new Error('Sólo puede asignar un responsable por sede');
  if (!ids.size) return [];

  // ====== Resolver profesiones registradas en Recursos Humanos ======
  const trabajadores = await RecursoHumano.find({ _id: { $in: [...ids] } })
    .select('_id profesionesRecurso')
    .populate({ path: 'profesionesRecurso.profesionRef', select: 'nombreProfesion estadoProfesion' })
    .lean();
  if (trabajadores.length !== ids.size) throw new Error('Uno o más trabajadores no existen en Recursos Humanos');
  const porId = new Map(trabajadores.map((item) => [String(item._id), item]));
  return personal.map((persona) => {
    const trabajador = porId.get(String(persona.recursoHumanoId));
    const profesiones = (trabajador?.profesionesRecurso || [])
      .map((item) => item.profesionRef)
      .filter((item) => item && item._id && item.estadoProfesion !== false);
    // ====== Compatibilidad con asignaciones anteriores sin profesionRef ======
    const elegida = persona.profesionRef
      ? profesiones.find((item) => String(item._id) === String(persona.profesionRef))
      : profesiones.find((item) => item.nombreProfesion.toUpperCase() === String(persona.puesto || '').trim().toUpperCase());
    if (!elegida) throw new Error('La profesión seleccionada debe estar registrada y activa en el trabajador');
    return {
      ...(persona._id && mongoose.isValidObjectId(persona._id) ? { _id: persona._id } : {}),
      recursoHumanoId: persona.recursoHumanoId,
      profesionRef: elegida._id,
      puesto: elegida.nombreProfesion,
      esResponsable: persona.esResponsable === true,
      fechaAsignacion: validarFecha(persona.fechaAsignacion, 'Fecha de asignación'),
      activo: persona.activo !== false,
    };
  });
}
function crearRegistroContacto(datos, usuario, tipoRegistro) {
  return {
    tipoRegistro,
    telefono: datos.telefono || '',
    whatsapp: datos.whatsapp || '',
    correo: datos.correo || '',
    observaciones: datos.observaciones || '',
    fechaCambio: new Date(),
    usuarioCambio: usuario || '',
  };
}
function contactoCambio(original, datos) {
  return CAMPOS_CONTACTO.some((campo) => String(original?.[campo] || '') !== String(datos?.[campo] || ''));
}
async function construirPayload(body, original = null, usuario = '') {
  const datos = {};
  for (const key of CAMPOS_TEXTO) datos[key] = typeof body[key] === 'string' ? body[key].trim() : '';
  for (const key of ['nombre', 'departamento', 'provincia', 'distrito', 'direccion']) {
    if (!datos[key]) throw new Error(`El campo ${key} es obligatorio`);
  }
  if (body.estado !== 'ACTIVA' && body.estado !== 'INACTIVA') throw new Error('Estado de sucursal inválido');
  if (typeof body.esPrincipal !== 'boolean') throw new Error('Indique si es sede principal');
  if (body.esPrincipal && body.estado !== 'ACTIVA') throw new Error('La sede principal debe permanecer activa');
  if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) throw new Error('Correo electrónico inválido');
  datos.coordenadasMaps = validarCoordenadas(datos.coordenadasMaps);
  datos.googleMapsUrl = construirUrlMaps(datos.coordenadasMaps);
  datos.fechaApertura = validarFecha(body.fechaApertura, 'Fecha de apertura');
  datos.estado = body.estado;
  datos.esPrincipal = body.esPrincipal;
  datos.horarios = validarHorarios(body.horarios);
  datos.personal = await normalizarPersonal(body.personal);
  datos.permisos = normalizarPermisos(body.permisos, original, usuario);
  return datos;
}
async function verificarPrincipal(id, solicitado) {
  if (!solicitado) return;
  const principal = await Sucursal.findOne({ esPrincipal: true, ...(id ? { _id: { $ne: id } } : {}) }).select('_id codigo').lean();
  if (principal) {
    const error = new Error(`Ya existe una sede principal: ${principal.codigo}`);
    error.status = 409;
    throw error;
  }
}
function manejarError(res, error) {
  if (error.status) return res.status(error.status).json({ ok: false, msg: error.message });
  if (error.code === 11000) return res.status(409).json({ ok: false, msg: 'Código duplicado o ya existe una sede principal' });
  if (error.name === 'ValidationError' || error.name === 'CastError') return res.status(400).json({ ok: false, msg: error.message });
  console.error('[sucursales]', error);
  return res.status(500).json({ ok: false, msg: 'No se pudo procesar la solicitud' });
}
function sanitizar(objeto) {
  const dato = objeto.toJSON ? objeto.toJSON() : JSON.parse(JSON.stringify(objeto));
  for (const permiso of dato.permisos || []) {
    for (const archivo of permiso.archivos || []) {
      delete archivo.storageKey;
      delete archivo.storageVersionId;
    }
    for (const version of permiso.historial || []) {
      for (const archivo of version.archivos || []) {
        delete archivo.storageKey;
        delete archivo.storageVersionId;
      }
    }
  }
  return dato;
}

// ====== Consultar sucursales y métricas ======
const listarSucursales = async (req, res = response) => {
  try {
    const search = String(req.query.search || '').trim().slice(0, 100);
    const estado = req.query.estado;
    const filtro = {};
    if (estado === 'ACTIVA' || estado === 'INACTIVA') filtro.estado = estado;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filtro.$or = ['codigo', 'nombre', 'nombreCorto', 'distrito'].map((campo) => ({ [campo]: { $regex: escaped, $options: 'i' } }));
    }
    const sucursales = await Sucursal.find(filtro).sort({ esPrincipal: -1, nombre: 1 }).limit(200).lean();
    const [total, activas, principales] = await Promise.all([
      Sucursal.countDocuments(),
      Sucursal.countDocuments({ estado: 'ACTIVA' }),
      Sucursal.countDocuments({ esPrincipal: true }),
    ]);
    return res.json({ ok: true, sucursales: sucursales.map(sanitizar), resumen: { total, activas, principales }, limitado: sucursales.length >= 200 });
  } catch (error) {
    return manejarError(res, error);
  }
};
const obtenerSucursal = async (req, res = response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, msg: 'ID inválido' });
    const sucursal = await Sucursal.findById(req.params.id).lean();
    if (!sucursal) return res.status(404).json({ ok: false, msg: 'Sucursal no encontrada' });
    return res.json({ ok: true, sucursal: sanitizar(sucursal) });
  } catch (error) {
    return manejarError(res, error);
  }
};
const crearSucursal = async (req, res = response) => {
  try {
    let datos;
    try {
      datos = await construirPayload(req.body, null, req.user.nombreUsuario || req.user.uid);
    } catch (error) {
      return res.status(400).json({ ok: false, msg: error.message });
    }
    await verificarPrincipal(null, datos.esPrincipal);
    // ====== Consecutivo atómico para códigos institucionales ======
    const secuencia = mongoose.connection.collection('sucursalesConsecutivosCollection');
    const consecutivo = await secuencia.findOneAndUpdate({ _id: 'sucursal' }, { $inc: { numero: 1 } }, { upsert: true, returnDocument: 'after' });
    const numero = consecutivo?.numero ?? consecutivo?.value?.numero;
    if (!Number.isInteger(numero)) throw new Error('No se pudo generar el consecutivo de sucursal');
    const sucursal = await Sucursal.create({
      ...datos,
      codigo: `LF-${String(numero).padStart(4, '0')}`,
      contactoHistorial: [crearRegistroContacto(datos, req.user.nombreUsuario, 'CREACION')],
      createdBy: req.user.uid,
      usuarioRegistro: req.user.nombreUsuario,
    });
    return res.status(201).json({ ok: true, msg: 'Sucursal creada', sucursal: sanitizar(sucursal) });
  } catch (error) {
    return manejarError(res, error);
  }
};
const actualizarSucursal = async (req, res = response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, msg: 'ID inválido' });
    const sucursal = await Sucursal.findById(req.params.id).select('+permisos.archivos.storageKey +permisos.archivos.storageVersionId +permisos.historial.archivos.storageKey +permisos.historial.archivos.storageVersionId');
    if (!sucursal) return res.status(404).json({ ok: false, msg: 'Sucursal no encontrada' });
    let datos;
    try {
      datos = await construirPayload(req.body, sucursal, req.user.nombreUsuario || req.user.uid);
    } catch (error) {
      return res.status(400).json({ ok: false, msg: error.message });
    }
    await verificarPrincipal(sucursal._id, datos.esPrincipal);
    if (contactoCambio(sucursal, datos)) {
      const historial = [...(sucursal.contactoHistorial || []), crearRegistroContacto(datos, req.user.nombreUsuario, 'ACTUALIZACION')];
      sucursal.contactoHistorial = historial.slice(-20);
    }
    sucursal.set({ ...datos, updatedBy: req.user.uid, usuarioActualizacion: req.user.nombreUsuario });
    await sucursal.save();
    return res.json({ ok: true, msg: 'Sucursal actualizada', sucursal: sanitizar(sucursal) });
  } catch (error) {
    return manejarError(res, error);
  }
};
const personalDisponible = async (req, res = response) => {
  try {
    const term = String(req.query.search || '').trim().slice(0, 70);
    const ids = String(req.query.ids || '').split(',').filter(Boolean);
    if (ids.length > 100 || ids.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ ok: false, msg: 'Los IDs solicitados no son válidos' });
    }
    // ====== Buscar nombres completos, apellidos, documento o código ======
    const camposBusqueda = ['codRecHumano', 'nombreRecHumano', 'apePatRecHumano', 'apeMatRecHumano', 'nroDoc'];
    const acentos = {
      a: '[aáàäâ]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöô]',
      u: '[uúùüû]', n: '[nñ]', c: '[cç]',
    };
    const regexToken = (token) => [...token].map((letra) => {
      const normalizada = letra.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return acentos[normalizada] || letra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    const tokens = term.split(/[\s,;()]+/).filter(Boolean).slice(0, 8);
    const filtro = ids.length
      ? { _id: { $in: ids } }
      : tokens.length
        ? { $and: tokens.map((token) => ({
          $or: camposBusqueda.map((campo) => ({ [campo]: { $regex: regexToken(token), $options: 'i' } })),
        })) }
        : {};

    // ====== Consultar recursos humanos y poblar sus profesiones ======
    const registros = await RecursoHumano.find(filtro)
      .select('codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano nroDoc profesionesRecurso')
      .populate({ path: 'profesionesRecurso.profesionRef', select: 'nombreProfesion estadoProfesion' })
      .sort({ apePatRecHumano: 1, apeMatRecHumano: 1, nombreRecHumano: 1 })
      .limit(100)
      .lean();
    const personal = registros.map((trabajador) => {
      const profesiones = (trabajador.profesionesRecurso || [])
        .map((item) => item.profesionRef)
        .filter((profesion) => profesion && profesion._id && profesion.estadoProfesion !== false)
        .map((profesion) => ({ _id: String(profesion._id), nombreProfesion: profesion.nombreProfesion }));
      return {
        _id: String(trabajador._id),
        codRecHumano: trabajador.codRecHumano,
        nombreRecHumano: trabajador.nombreRecHumano,
        apePatRecHumano: trabajador.apePatRecHumano,
        apeMatRecHumano: trabajador.apeMatRecHumano || '',
        nroDoc: trabajador.nroDoc || '',
        profesiones: [...new Map(profesiones.map((profesion) => [profesion._id, profesion])).values()],
      };
    });
    return res.json({ ok: true, personal, limitado: personal.length === 100 });
  } catch (error) {
    return manejarError(res, error);
  }
};
const subirArchivoPermiso = async (req, res = response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.permisoId)) return res.status(400).json({ ok: false, msg: 'ID inválido' });
    if (!req.file || !TIPOS_ARCHIVO.includes(req.file.mimetype)) return res.status(400).json({ ok: false, msg: 'Seleccione una imagen o PDF válido' });
    if (!process.env.AWS_S3_BUCKET) return res.status(503).json({ ok: false, msg: 'Almacenamiento S3 no configurado' });
    const sucursal = await Sucursal.findById(req.params.id).select('+permisos.archivos.storageKey +permisos.archivos.storageVersionId +permisos.historial.archivos.storageKey +permisos.historial.archivos.storageVersionId');
    const permiso = sucursal?.permisos.id(req.params.permisoId);
    if (!permiso) return res.status(404).json({ ok: false, msg: 'Permiso no encontrado' });
    const { buffer, mimetype, originalname, size } = req.file;
    const firma = buffer.subarray(0, 8);
    const valida = mimetype === 'application/pdf'
      ? buffer.subarray(0, 5).toString('ascii') === '%PDF-'
      : mimetype === 'image/png'
        ? firma.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mimetype === 'image/jpeg'
          ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
          : mimetype === 'image/webp'
            ? buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
            : false;
    if (!valida) return res.status(400).json({ ok: false, msg: 'Contenido de archivo no coincide con el formato declarado' });
    const archivoStorage = await subirArchivoStorage({ keyPrefix: `sucursales/${sucursal._id}/permisos/${permiso._id}`, buffer, mimeType: mimetype });
    permiso.archivos.push({ nombreArchivo: String(originalname).slice(0, 180), mimeType: mimetype, tamanioBytes: size, storageKey: archivoStorage.key, storageVersionId: archivoStorage.versionId, creadoPor: req.user.uid });
    sucursal.updatedBy = req.user.uid;
    sucursal.usuarioActualizacion = req.user.nombreUsuario;
    try {
      await sucursal.save();
    } catch (e) {
      await eliminarArchivo(archivoStorage.key, archivoStorage.versionId ?? undefined).catch(() => {});
      throw e;
    }
    return res.status(201).json({ ok: true, msg: 'Archivo adjuntado', archivo: sanitizar(sucursal).permisos.find((p) => String(p._id) === String(permiso._id)).archivos.slice(-1)[0] });
  } catch (error) {
    return manejarError(res, error);
  }
};
// ====== Visor S3: versión vigente o archivo histórico ======
const urlArchivoPermiso = async (req, res = response) => {
  try {
    const { id, permisoId, archivoId } = req.params;
    const historialId = typeof req.query.historialId === 'string' ? req.query.historialId.trim() : '';
    if (![id, permisoId, archivoId, ...(historialId ? [historialId] : [])].every(mongoose.isValidObjectId)) {
      return res.status(400).json({ ok: false, msg: 'Identificador inválido' });
    }
    const sucursal = await Sucursal.findById(id).select('+permisos.archivos.storageKey +permisos.archivos.storageVersionId +permisos.historial.archivos.storageKey +permisos.historial.archivos.storageVersionId');
    const permiso = sucursal?.permisos.id(permisoId);
    const contenedor = historialId ? permiso?.historial.id(historialId) : permiso;
    const archivo = contenedor?.archivos.id(archivoId);
    if (!archivo || !archivo.storageKey) return res.status(404).json({ ok: false, msg: 'Archivo no encontrado' });
    const url = await generarUrlTemporal(archivo.storageKey, 180, archivo.storageVersionId || undefined);
    return res.json({ ok: true, url, mimeType: archivo.mimeType, nombreArchivo: archivo.nombreArchivo, expiresIn: 180 });
  } catch (error) { return manejarError(res, error); }
};
const retirarArchivoPermiso = async (req, res = response) => {
  try {
    const sucursal = await Sucursal.findById(req.params.id).select('+permisos.archivos.storageKey +permisos.archivos.storageVersionId +permisos.historial.archivos.storageKey +permisos.historial.archivos.storageVersionId');
    const archivo = sucursal?.permisos.id(req.params.permisoId)?.archivos.id(req.params.archivoId);
    if (!archivo) return res.status(404).json({ ok: false, msg: 'Archivo no encontrado' });
    const key = archivo.storageKey;
    const versionId = archivo.storageVersionId || undefined;
    archivo.deleteOne();
    sucursal.updatedBy = req.user.uid;
    sucursal.usuarioActualizacion = req.user.nombreUsuario;
    await sucursal.save();
    await eliminarArchivo(key, versionId).catch((error) => console.error('No se pudo limpiar objeto S3:', error));
    return res.json({ ok: true, msg: 'Archivo retirado' });
  } catch (error) {
    return manejarError(res, error);
  }
};
module.exports = { listarSucursales, obtenerSucursal, crearSucursal, actualizarSucursal, personalDisponible, subirArchivoPermiso, urlArchivoPermiso, retirarArchivoPermiso };
