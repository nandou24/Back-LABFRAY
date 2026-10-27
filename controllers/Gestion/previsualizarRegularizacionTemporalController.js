const { response } = require('express');
const mongoose = require('mongoose');
const ProgramacionPacienteEmpresa = require('../../models/Gestion/programacionPacienteEmpresa');
const SolicitudAtencion = require('../../models/Gestion/SolicitudAtencion');
const Paciente = require('../../models/Mantenimiento/Paciente');
const { buscarCoincidenciasVinculacion } = require('../../utils/Gestion/buscarCoincidenciasVinculacion');

// ====== Validar documento sin modificar la atención ======
const normalizarDocumento = (body = {}) => {
  const tipoDoc = String(body.tipoDoc ?? '').trim().toUpperCase();
  const nroDoc = String(body.nroDoc ?? '').trim().toUpperCase();
  const formatos = {
    DNI: /^\d{8}$/,
    CE: /^[A-Z0-9]{1,13}$/,
    PASAPORTE: /^[A-Z0-9]{1,16}$/,
  };
  return formatos[tipoDoc]?.test(nroDoc) ? { tipoDoc, nroDoc } : null;
};

const normalizarNombre = (valor) => String(valor ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().replace(/\s+/g, ' ').toUpperCase();

const compararNombres = (programacion, paciente) => ({
  coincide: ['nombreCliente', 'apePatCliente', 'apeMatCliente']
    .every(campo => normalizarNombre(programacion[campo]) === normalizarNombre(paciente[campo])),
});

const esAtencionTemporalPendiente = (programacion) => Boolean(
  programacion?.identidadTemporalActiva === true &&
  ['EN ATENCION', 'PENDIENTE DE COMPLETAR'].includes(programacion.estadoProgramacion) &&
  !programacion.pacienteId && !programacion.hc &&
  !programacion.tipoDoc && !programacion.nroDoc
);

// ====== Buscar documentos históricos para evitar crear HC duplicadas ======
const buscarEnHistorialDocumentos = async (tipoDoc, nroDoc) => {
  const coincidencias = await Paciente.find({
    historialDocumentos: {
      $elemMatch: {
        $or: [{ tipoDoc, nroDoc }, { tipoDocNuevo: tipoDoc, nroDocNuevo: nroDoc }],
      },
    },
  }).select('_id hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente estadoIdentificacion').lean();
  return coincidencias.map(p => ({
    pacienteId: String(p._id), hc: p.hc ?? null,
    tipoDoc: p.tipoDoc ?? null, nroDoc: p.nroDoc ?? null,
    nombreCliente: p.nombreCliente, apePatCliente: p.apePatCliente,
    apeMatCliente: p.apeMatCliente ?? '',
    identificacionPendiente: p.estadoIdentificacion === 'PENDIENTE',
    tipoCoincidencia: 'HISTORIAL_DOCUMENTO',
  }));
};

// ====== Solo lectura: la vinculación será una operación posterior ======
const previsualizarRegularizacionTemporal = async (req, res = response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, codigo: 'ID_INVALIDO', msg: 'La programación no es válida.' });
    }
    const documento = normalizarDocumento(req.body);
    if (!documento) {
      return res.status(400).json({ ok: false, codigo: 'DOCUMENTO_INVALIDO',
        msg: 'Ingrese DNI de 8 dígitos, CE de hasta 13 caracteres o pasaporte de hasta 16 caracteres.' });
    }
    const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id).lean();
    if (!programacion) {
      return res.status(404).json({ ok: false, codigo: 'PROGRAMACION_NO_ENCONTRADA', msg: 'La programación no existe.' });
    }
    if (!esAtencionTemporalPendiente(programacion)) {
      return res.status(409).json({ ok: false, codigo: 'ATENCION_NO_TEMPORAL',
        msg: 'Solo se puede verificar una atención temporal iniciada y aún sin documento ni HC.' });
    }

    const solicitudes = await SolicitudAtencion.find({ programacionEmpresaId: programacion._id })
      .select('_id codSolicitud codigoLaboratorio origenAtencion identidadAtencion clienteId hc tipoDoc nroDoc').lean();
    if (!solicitudes.length || solicitudes.some(s =>
      s.origenAtencion !== 'EMPRESA' || s.identidadAtencion !== 'TEMPORAL' ||
      s.clienteId || s.hc || s.tipoDoc || s.nroDoc)) {
      return res.status(409).json({ ok: false, codigo: 'SOLICITUDES_INCONSISTENTES',
        msg: 'Las solicitudes de esta programación no están íntegramente en identidad temporal.' });
    }

    const programacionConDocumento = { ...programacion, ...documento };
    const [coincidencias, historicas] = await Promise.all([
      buscarCoincidenciasVinculacion(Paciente, programacionConDocumento, compararNombres),
      buscarEnHistorialDocumentos(documento.tipoDoc, documento.nroDoc),
    ]);
    const actuales = new Set(coincidencias.candidatos.map(p => p.pacienteId));
    const soloHistoricas = historicas.filter(p => !actuales.has(p.pacienteId));
    const requiereRevision = coincidencias.candidatos.length > 0 || historicas.length > 0;

    return res.json({
      ok: true, soloLectura: true, documento,
      programacion: {
        _id: String(programacion._id), codProgramacion: programacion.codProgramacion,
        nombreCliente: programacion.nombreCliente, apePatCliente: programacion.apePatCliente,
        apeMatCliente: programacion.apeMatCliente ?? '',
        identidadTemporalActiva: true, estadoProgramacion: programacion.estadoProgramacion,
      },
      solicitudes: solicitudes.map(s => ({ _id: String(s._id), codSolicitud: s.codSolicitud,
        codigoLaboratorio: s.codigoLaboratorio ?? null })),
      porDocumento: coincidencias.porDocumento,
      porNombres: coincidencias.porNombres,
      porHistorialDocumento: soloHistoricas,
      pacientesUnicos: coincidencias.candidatos.length + soloHistoricas.length,
      estadoRevision: requiereRevision ? 'REQUIERE_REVISION_IDENTIDAD' : 'SIN_COINCIDENCIAS',
      msg: requiereRevision
        ? 'Revise las coincidencias antes de vincular o crear una HC. No se modificó ningún registro.'
        : 'No se encontraron coincidencias. No se modificó ningún registro ni se creó una HC.',
    });
  } catch (error) {
    console.error('Error al previsualizar regularización temporal:', error);
    return res.status(500).json({ ok: false, codigo: 'ERROR_PREVISUALIZACION',
      msg: 'No se pudo verificar la identidad temporal.' });
  }
};

module.exports = {
  previsualizarRegularizacionTemporal,
  normalizarDocumento,
  esAtencionTemporalPendiente,
};
