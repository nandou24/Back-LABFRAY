// ====== Buscar documentos y nombres por separado ======
const CAMPOS_PACIENTE = '_id hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente fechaNacimiento sexoCliente estadoIdentificacion';

const normalizarDocumento = (valor) => String(valor ?? '').trim().toUpperCase();
const escaparRegex = (valor) => String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ====== Comparación flexible de vocales acentuadas, sin confundir Ñ con N ======
const patronNombre = (valor) => {
  const equivalencias = {
    A: '[AÁÀÂÄ]', Á: '[AÁÀÂÄ]', À: '[AÁÀÂÄ]', Â: '[AÁÀÂÄ]', Ä: '[AÁÀÂÄ]',
    E: '[EÉÈÊË]', É: '[EÉÈÊË]', È: '[EÉÈÊË]', Ê: '[EÉÈÊË]', Ë: '[EÉÈÊË]',
    I: '[IÍÌÎÏ]', Í: '[IÍÌÎÏ]', Ì: '[IÍÌÎÏ]', Î: '[IÍÌÎÏ]', Ï: '[IÍÌÎÏ]',
    O: '[OÓÒÔÖ]', Ó: '[OÓÒÔÖ]', Ò: '[OÓÒÔÖ]', Ô: '[OÓÒÔÖ]', Ö: '[OÓÒÔÖ]',
    U: '[UÚÙÛÜ]', Ú: '[UÚÙÛÜ]', Ù: '[UÚÙÛÜ]', Û: '[UÚÙÛÜ]', Ü: '[UÚÙÛÜ]',
  };
  return Array.from(normalizarDocumento(valor).replace(/\s+/g, ' '))
    .map(letra => letra === ' ' ? '\\s+' : (equivalencias[letra] ?? escaparRegex(letra)))
    .join('');
};

const expresionCampo = (valor) => new RegExp(`^\\s*${patronNombre(valor)}\\s*$`, 'i');
const expresionPrimerNombre = (valor) => {
  const primero = normalizarDocumento(valor).split(/\s+/)[0];
  return primero ? new RegExp(`(?:^|\\s)${patronNombre(primero)}(?=\\s|$)`, 'i') : null;
};

const identificarCandidato = (programacion, paciente, validarCoincidenciaIdentidad) => {
  const documentoExacto = Boolean(normalizarDocumento(programacion.tipoDoc) &&
    normalizarDocumento(programacion.nroDoc) &&
    normalizarDocumento(programacion.tipoDoc) === normalizarDocumento(paciente.tipoDoc) &&
    normalizarDocumento(programacion.nroDoc) === normalizarDocumento(paciente.nroDoc));
  const nombresExactos = validarCoincidenciaIdentidad(programacion, paciente).coincide;
  return {
    pacienteId: String(paciente._id), hc: paciente.hc ?? null,
    tipoDoc: paciente.tipoDoc ?? null, nroDoc: paciente.nroDoc ?? null,
    nombreCliente: paciente.nombreCliente, apePatCliente: paciente.apePatCliente,
    apeMatCliente: paciente.apeMatCliente ?? '',
    fechaNacimiento: paciente.fechaNacimiento ?? null,
    sexoCliente: paciente.sexoCliente ?? null,
    documentoExacto, nombresExactos,
    vinculacionPermitida: Boolean(documentoExacto && nombresExactos && paciente.hc &&
      paciente.estadoIdentificacion !== 'PENDIENTE'),
    tipoCoincidencia: documentoExacto
      ? (nombresExactos ? 'EXACTA' : 'DOCUMENTO_DISCREPANTE') : 'NOMBRES',
  };
};

const buscarCoincidenciasVinculacion = async (Paciente, programacion, validarCoincidenciaIdentidad) => {
  const tipoDoc = normalizarDocumento(programacion.tipoDoc);
  const nroDoc = normalizarDocumento(programacion.nroDoc);
  let documentos = [];
  let nombres = [];

  // ====== Buscar documentos en todo el maestro, sin limitar resultados ======
  if (tipoDoc && nroDoc) {
    documentos = await Paciente.find({
      tipoDoc: new RegExp(`^\\s*${escaparRegex(tipoDoc)}\\s*$`, 'i'),
      nroDoc: new RegExp(`^\\s*${escaparRegex(nroDoc)}\\s*$`, 'i'),
    }).select(CAMPOS_PACIENTE).lean();
  }

  // ====== Nombres y apellidos: buscar la combinación, no palabras sueltas ======
  const primerNombre = expresionPrimerNombre(programacion.nombreCliente);
  const apellidos = [programacion.apePatCliente, programacion.apeMatCliente]
    .map((valor, index) => ({ valor, campo: index === 0 ? 'apePatCliente' : 'apeMatCliente' }))
    .filter(item => normalizarDocumento(item.valor))
    .map(item => ({ [item.campo]: expresionCampo(item.valor) }));
  if (primerNombre && apellidos.length) {
    nombres = await Paciente.find({
      nombreCliente: primerNombre, $or: apellidos,
    }).select(CAMPOS_PACIENTE).lean();
  }

  const porDocumento = documentos
    .map(p => identificarCandidato(programacion, p, validarCoincidenciaIdentidad));
  const idsDocumento = new Set(porDocumento.map(p => p.pacienteId));
  const porNombres = nombres
    .map(p => identificarCandidato(programacion, p, validarCoincidenciaIdentidad))
    .filter(p => !idsDocumento.has(p.pacienteId));

  return {
    porDocumento, porNombres,
    // ====== Compatibilidad con el frontend V3: ya no hay resultados ocultos ======
    masPorDocumento: false,
    masPorNombres: false,
    candidatos: [...porDocumento, ...porNombres],
  };
};

module.exports = { buscarCoincidenciasVinculacion };
