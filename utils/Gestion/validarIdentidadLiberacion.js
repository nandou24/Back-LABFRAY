const mongoose = require('mongoose');
const Paciente = require('../../models/Mantenimiento/Paciente');

// ====== Comprobar identidad definitiva antes de liberar ======
const comprobarDocumento = (tipo, numero) => {
  const t = String(tipo ?? '').trim().toUpperCase();
  const n = String(numero ?? '').trim().toUpperCase();
  const formatos = { DNI: /^\d{8}$/, CE: /^[A-Z0-9]{1,13}$/, PASAPORTE: /^[A-Z0-9]{1,16}$/ };
  return Boolean(formatos[t]?.test(n));
};

// ====== Compatibilidad con pacientes maestros anteriores al estado de identificación ======
const identificacionRegistrada = (paciente) =>
  paciente.estadoIdentificacion === 'REGISTRADA' ||
  paciente.estadoIdentificacion === undefined;

// ====== Verificar documento, HC y paciente maestro asociados ======
const validarIdentidadesParaLiberar = async (solicitudes, { session = null } = {}) => {
  if (!Array.isArray(solicitudes) || !solicitudes.length) return;
  const ids = solicitudes.map(s => s.clienteId).filter(Boolean);
  const idsValidos = [...new Set(ids.map(id => String(id)))];
  const pacientes = idsValidos.length
    ? await Paciente.find({ _id: { $in: idsValidos } })
        .select('_id hc estadoIdentificacion tipoDoc nroDoc').session(session).lean()
    : [];
  const porId = new Map(pacientes.map(p => [String(p._id), p]));
  for (const solicitud of solicitudes) {
    const codigo = solicitud.codSolicitud ?? String(solicitud._id);
    const errorIdentidad = () => {
      const error = new Error(`La solicitud ${codigo} debe regularizar el documento y vincular una HC antes de liberar resultados.`);
      error.codigo = 'IDENTIDAD_PENDIENTE_LIBERACION';
      error.status = 409;
      error.statusCode = 409;
      throw error;
    };
    if (!solicitud.hc || !solicitud.clienteId ||
        !mongoose.isValidObjectId(solicitud.clienteId) ||
        !comprobarDocumento(solicitud.tipoDoc, solicitud.nroDoc)) errorIdentidad();
    const paciente = porId.get(String(solicitud.clienteId));
    if (!paciente || !identificacionRegistrada(paciente) ||
        !paciente.hc || String(paciente.hc) !== String(solicitud.hc) ||
        !comprobarDocumento(paciente.tipoDoc, paciente.nroDoc) ||
        String(paciente.tipoDoc).trim().toUpperCase() !== String(solicitud.tipoDoc).trim().toUpperCase() ||
        String(paciente.nroDoc).trim().toUpperCase() !== String(solicitud.nroDoc).trim().toUpperCase()) {
      errorIdentidad();
    }
  }
};

module.exports = { validarIdentidadesParaLiberar };
