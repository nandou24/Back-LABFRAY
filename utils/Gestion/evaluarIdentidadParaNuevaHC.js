// ====== Evaluar coincidencias con la decisión vigente por HC ======
const texto = (valor) => String(valor ?? '').trim().toUpperCase();
const normalizarNombre = (valor) => texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const mismaIdentidadProgramada = (evento, programacion) => {
  if (texto(evento.tipoDocProgramacion) !== texto(programacion.tipoDoc) ||
      texto(evento.nroDocProgramacion) !== texto(programacion.nroDoc)) return false;
  // Los eventos históricos sin snapshot conservan su compatibilidad.
  if (evento.nombreClienteProgramacion !== undefined &&
      normalizarNombre(evento.nombreClienteProgramacion) !== normalizarNombre(programacion.nombreCliente)) return false;
  if (evento.apePatClienteProgramacion !== undefined &&
      normalizarNombre(evento.apePatClienteProgramacion) !== normalizarNombre(programacion.apePatCliente)) return false;
  if (evento.apeMatClienteProgramacion !== undefined &&
      normalizarNombre(evento.apeMatClienteProgramacion) !== normalizarNombre(programacion.apeMatCliente)) return false;
  return true;
};
const obtenerUltimasDecisiones = (programacion) => {
  const ultimas = new Map();
  for (const item of programacion.historialRevisionIdentidad ?? []) {
    if (!item || !mismaIdentidadProgramada(item, programacion)) continue;
    const id = String(item.pacienteIdCandidato ?? '');
    if (id) ultimas.set(id, item);
  }
  return ultimas;
};
const evaluarIdentidadParaNuevaHC = (programacion, busqueda) => {
  const candidatos = busqueda.candidatos ?? [];
  const porDocumento = busqueda.porDocumento ?? [];
  if (porDocumento.length) return {
    permiteCrear: false, codigo: 'COINCIDENCIA_DOCUMENTO_EXISTENTE',
    msg: 'El documento ya figura en el maestro. Revise y vincule la HC existente; no se creará otra.',
    candidatos: porDocumento,
  };
  const decisiones = obtenerUltimasDecisiones(programacion);
  const pendientes = candidatos.filter(item => decisiones.get(String(item.pacienteId))?.decision !== 'DISTINTO');
  if (pendientes.length) return {
    permiteCrear: false, codigo: 'COINCIDENCIAS_IDENTIDAD_PENDIENTES',
    msg: 'Existen coincidencias nominales sin resolver. Revise cada candidato antes de crear una nueva HC.',
    candidatos: pendientes,
  };
  return { permiteCrear: true, codigo: null, candidatos: [] };
};
module.exports = { evaluarIdentidadParaNuevaHC, obtenerUltimasDecisiones };
