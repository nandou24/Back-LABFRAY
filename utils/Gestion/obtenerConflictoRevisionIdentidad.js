// ====== Obtener última decisión por cada paciente candidato ======
const obtenerConflictoRevisionIdentidad = (programacion = {}) => {
  const tipoDoc = String(programacion.tipoDoc ?? '').trim().toUpperCase();
  const nroDoc = String(programacion.nroDoc ?? '').trim().toUpperCase();
  const historial = Array.isArray(programacion.historialRevisionIdentidad)
    ? programacion.historialRevisionIdentidad : [];
  const revisados = new Set();

  // ====== Los eventos previos permanecen en la auditoría ======
  for (let i = historial.length - 1; i >= 0; i--) {
    const item = historial[i];
    if (!item) continue;
    if (String(item.tipoDocProgramacion ?? '').trim().toUpperCase() !== tipoDoc ||
        String(item.nroDocProgramacion ?? '').trim().toUpperCase() !== nroDoc) continue;

    const candidatoId = String(item.pacienteIdCandidato ?? item.hcCandidata ?? `sin-id-${i}`);
    if (revisados.has(candidatoId)) continue;
    revisados.add(candidatoId);

    if (item.decision === 'PENDIENTE' ||
        (item.decision === 'DISTINTO' && item.documentoCoincidente === true)) {
      return item;
    }
  }
  return null;
};

module.exports = { obtenerConflictoRevisionIdentidad };
