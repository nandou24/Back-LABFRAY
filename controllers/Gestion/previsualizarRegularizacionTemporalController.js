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

// ====== Identidad declarada para regularizar sin modificar datos existentes ======
const normalizarIdentidadPropuesta = (body) => {
  const valores = {};
  for (const campo of ['nombreCliente', 'apePatCliente', 'apeMatCliente']) {
    const valor = String(body?.[campo] ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (valor.length > 80 || (campo !== 'apeMatCliente' && valor.length < 2) ||
        (valor && !/^[\p{L}\s'’-]+$/u.test(valor))) {
      const error = new Error('Revise los nombres y apellidos del paciente (mínimo 2 caracteres en campos obligatorios).');
      error.codigo = 'IDENTIDAD_INVALIDA'; error.status = 400; throw error;
    }
    valores[campo] = valor;
  }
  const sexo = body?.sexoCliente || null;
  if (sexo && !['Masculino', 'Femenino'].includes(sexo)) {
    const error = new Error('El sexo informado no es válido.');
    error.codigo = 'SEXO_INVALIDO'; error.status = 400; throw error;
  }
  valores.sexoCliente = sexo || null;
  const fecha = String(body?.fechaNacimiento || '').trim();
  if (fecha) {
    const valor = new Date(`${fecha}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(valor.getTime()) ||
        valor.toISOString().slice(0, 10) !== fecha || valor > new Date() || fecha < '1900-01-01') {
      const error = new Error('La fecha de nacimiento es inválida o futura.');
      error.codigo = 'FECHA_NACIMIENTO_INVALIDA'; error.status = 400; throw error;
    }
  }
  valores.fechaNacimiento = fecha || null;
  return valores;
};

// ====== Buscar solo con los datos ingresados durante la regularización ======
const buscarCandidatosIdentidadConsultada = async (documento, identidad, session = null) =>
  buscarCoincidenciasVinculacion(Paciente, { ...identidad, ...documento }, compararNombres, session);

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

    const identidadConsultada = normalizarIdentidadPropuesta(req.body);
    const coincidencias = await buscarCandidatosIdentidadConsultada(documento, identidadConsultada);
    const pacientesUnicos = coincidencias.candidatos.length;
    const requiereRevision = pacientesUnicos > 0;

    return res.json({
      ok: true, soloLectura: true, documento, identidadConsultada,
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
      porHistorialDocumento: [], // Compatibilidad temporal del contrato Angular.
      pacientesUnicos,
      estadoRevision: requiereRevision ? 'REQUIERE_REVISION_IDENTIDAD' : 'SIN_COINCIDENCIAS',
      msg: requiereRevision
        ? 'Revise las coincidencias antes de vincular o crear una HC. No se modificó ningún registro.'
        : 'No se encontraron coincidencias. No se modificó ningún registro ni se creó una HC.',
    });
  } catch (error) {
    if (!error.codigo) console.error('Error al previsualizar regularización temporal:', error);
    return res.status(error.status || 500).json({ ok: false, codigo: error.codigo || 'ERROR_PREVISUALIZACION',
      msg: error.codigo ? error.message : 'No se pudo verificar la identidad temporal.' });
  }
};

module.exports = {
  previsualizarRegularizacionTemporal,
  normalizarDocumento,
  esAtencionTemporalPendiente,
  normalizarIdentidadPropuesta,
  buscarCandidatosIdentidadConsultada,
};
