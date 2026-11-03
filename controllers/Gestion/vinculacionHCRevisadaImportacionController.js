const mongoose = require('mongoose');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const Paciente = require('../../models/Mantenimiento/Paciente');
const Solicitud = require('../../models/Gestion/SolicitudAtencion');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const { consultarIdentidadUna } = require('./verificacionMasivaIdentidadEmpresaController');

const texto = (v) => String(v ?? '').trim();
const clave = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();
const fechaISO = (v) => {
  if (!v) return null;
  const fecha = v instanceof Date ? v : new Date(v);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString().slice(0, 10);
};

const obtenerResponsable = async (user) => {
  const uid = texto(user?.uid);
  const usuario = texto(user?.nombreUsuario);
  const condiciones = [];
  if (uid) condiciones.push({ codRecHumano: uid });
  if (usuario) condiciones.push({ 'datosLogueo.nombreUsuario': usuario });
  if (!condiciones.length) return null;
  const personas = await RecursoHumano.find({ $or: condiciones })
    .select('codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano datosLogueo.nombreUsuario').lean();
  const persona = personas.find((x) => texto(x.codRecHumano) === uid)
    ?? personas.find((x) => texto(x.datosLogueo?.nombreUsuario).toLowerCase() === usuario.toLowerCase());
  return persona ? [persona.apePatRecHumano, persona.apeMatRecHumano, persona.nombreRecHumano]
    .map(texto).filter(Boolean).join(' ') : null;
};

// ====== Vincular individualmente la HC con documento coincidente y nombres diferentes ======
const vincularHCRevisadaImportacion = async (req, res) => {
  try {
    const importacionId = texto(req.body?.importacionId);
    const programacionId = texto(req.body?.programacionId);
    const pacienteId = texto(req.body?.pacienteId);
    const huellaConsulta = texto(req.body?.huellaConsulta);
    const motivo = texto(req.body?.motivo);
    const uid = texto(req.user?.uid);
    const usuario = texto(req.user?.nombreUsuario);
    if (!uid) return res.status(401).json({ ok: false, msg: 'Usuario no identificado.' });
    if (!/^\d{8}-\d{4,12}$/.test(importacionId) ||
        !mongoose.isValidObjectId(programacionId) || !mongoose.isValidObjectId(pacienteId) ||
        !/^[a-f0-9]{64}$/.test(huellaConsulta) || motivo.length > 300 ||
        req.body?.confirmacionExpresa !== true) {
      return res.status(400).json({ ok: false,
        msg: 'Verifica la identidad, selecciona la HC y confirma expresamente las diferencias. Motivo máximo: 300 caracteres.' });
    }
    const p = await Programacion.findOne({
      _id: programacionId, importacionId, origenRegistro: 'IMPORTACION_EXCEL',
    }).lean();
    if (!p) return res.status(404).json({ ok: false, msg: 'Programación no encontrada en este lote.' });
    if (p.pacienteId || p.hc) {
      return res.status(409).json({ ok: false,
        msg: 'La programación ya tiene una HC. Refresca la consulta antes de continuar.' });
    }
    if (p.estadoProgramacion !== 'PROGRAMADO' || p.fechaInicioAtencion || p.identidadTemporalActiva) {
      return res.status(409).json({ ok: false,
        msg: 'La vinculación solo está disponible antes del inicio de atención y sin identidad temporal activa.' });
    }
    if (await Solicitud.exists({ programacionEmpresaId: p._id })) {
      return res.status(409).json({ ok: false, msg: 'Existen solicitudes asociadas. No se permite esta vinculación.' });
    }
    const consulta = await consultarIdentidadUna(p);
    if (consulta.huellaConsulta !== huellaConsulta) {
      return res.status(409).json({ ok: false,
        msg: 'Cambió la identidad o el maestro de pacientes. Vuelve a buscar coincidencias.' });
    }
    if (consulta.categoria !== 'DOCUMENTO_REVISAR' || consulta.masCandidatos || consulta.candidatos.length !== 1) {
      return res.status(409).json({ ok: false,
        msg: 'Este caso no corresponde a revisión individual con documento coincidente.' });
    }
    const candidato = consulta.candidatos.find((c) => c.pacienteId === pacienteId);
    if (!candidato?.hc || !candidato.coincideDocumento) {
      return res.status(409).json({ ok: false,
        msg: 'La HC seleccionada no tiene el mismo documento vigente. No se permite vincular.' });
    }
    const paciente = await Paciente.findById(pacienteId)
      .select('hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento tipoHC estadoConciliacion').lean();
    if (!paciente?.hc || !paciente.tipoDoc || !paciente.nroDoc ||
        (paciente.tipoHC === 'PROVISIONAL' && paciente.estadoConciliacion !== 'CONCILIADA') ||
        paciente.hc !== candidato.hc ||
        clave(p.tipoDoc) !== clave(paciente.tipoDoc) || clave(p.nroDoc) !== clave(paciente.nroDoc)) {
      return res.status(409).json({ ok: false,
        msg: 'El maestro ya no coincide con el documento de la programación. Consulta nuevamente.' });
    }
    const ahora = new Date();
    const nombreCompletoUsuario = await obtenerResponsable(req.user);
    const identidadOriginal = {
      nombreCliente: p.nombreCliente, apePatCliente: p.apePatCliente,
      apeMatCliente: p.apeMatCliente ?? null, sexoCliente: p.sexoCliente ?? null,
      fechaNacimiento: fechaISO(p.fechaNacimiento),
    };
    const identidadMaestro = {
      nombreCliente: paciente.nombreCliente,
      apePatCliente: paciente.apePatCliente,
      apeMatCliente: paciente.apeMatCliente ?? '',
      sexoCliente: paciente.sexoCliente ?? p.sexoCliente ?? null,
      fechaNacimiento: paciente.fechaNacimiento ?? p.fechaNacimiento ?? null,
    };
    const cambiosIdentidad = ['nombreCliente', 'apePatCliente', 'apeMatCliente', 'sexoCliente', 'fechaNacimiento']
      .map((campo) => {
        const anterior = campo === 'fechaNacimiento' ? identidadOriginal.fechaNacimiento : texto(identidadOriginal[campo]);
        const nuevo = campo === 'fechaNacimiento' ? fechaISO(identidadMaestro.fechaNacimiento) : texto(identidadMaestro[campo]);
        return anterior === nuevo ? null : { campo, valorAnterior: anterior || null, valorNuevo: nuevo || null };
      }).filter(Boolean);
    const eventoVinculacion = {
      tipo: 'VINCULACION_INICIAL', pacienteIdAnterior: null, hcAnterior: null,
      pacienteIdNuevo: paciente._id, hcNueva: paciente.hc,
      tipoDocAnterior: p.tipoDoc ?? null, nroDocAnterior: p.nroDoc ?? null,
      tipoDocNuevo: paciente.tipoDoc, nroDocNuevo: paciente.nroDoc,
      fecha: ahora, ejecutadoPor: uid, usuario, nombreCompletoUsuario,
      origenDocumento: 'EMPRESA', tipoResolucion: 'DISCREPANCIA_DOCUMENTO_COINCIDENTE',
      motivoDecision: motivo || 'Confirmación de identidad con documento vigente coincidente',
      identidadDeclarada: identidadOriginal, cambiosIdentidad,
    };
    const eventoRevision = {
      decision: 'CONFIRMAR_MAESTRO', categoriaConsulta: consulta.categoria,
      pacienteIdCandidato: paciente._id, hcCandidata: paciente.hc,
      documentoCoincidente: true, huellaConsulta, motivo: motivo || null,
      confirmacionDiferencias: true,
      identidadProgramacion: {
        tipoDoc: p.tipoDoc ?? null, nroDoc: p.nroDoc ?? null,
        nombreCliente: p.nombreCliente, apePatCliente: p.apePatCliente,
        apeMatCliente: p.apeMatCliente ?? '',
      },
      identidadCandidato: {
        tipoDoc: paciente.tipoDoc, nroDoc: paciente.nroDoc,
        nombreCliente: paciente.nombreCliente, apePatCliente: paciente.apePatCliente,
        apeMatCliente: paciente.apeMatCliente ?? '',
      },
      fecha: ahora, ejecutadoPor: uid, usuario, nombreCompletoUsuario,
    };
    // ====== Compare-and-set para conservar decisiones e impedir vínculos duplicados ======
    const actualizado = await Programacion.findOneAndUpdate({
      _id: p._id, importacionId, origenRegistro: 'IMPORTACION_EXCEL', __v: p.__v,
      pacienteId: null, hc: null, estadoProgramacion: 'PROGRAMADO',
      identidadTemporalActiva: { $ne: true }, fechaInicioAtencion: null,
      tipoDoc: p.tipoDoc, nroDoc: p.nroDoc,
      nombreCliente: p.nombreCliente, apePatCliente: p.apePatCliente,
      apeMatCliente: p.apeMatCliente ?? null,
    }, {
      $set: {
        pacienteId: paciente._id, hc: paciente.hc,
        tipoDoc: paciente.tipoDoc, nroDoc: paciente.nroDoc,
        nombreCliente: identidadMaestro.nombreCliente,
        apePatCliente: identidadMaestro.apePatCliente,
        apeMatCliente: identidadMaestro.apeMatCliente,
        sexoCliente: identidadMaestro.sexoCliente,
        fechaNacimiento: identidadMaestro.fechaNacimiento,
        revisionIdentidadImportacion: {
          decision: 'CONFIRMAR_MAESTRO', pacienteIdCandidato: paciente._id,
          hcCandidata: paciente.hc, categoriaConsulta: consulta.categoria,
          huellaConsulta, fecha: ahora, ejecutadoPor: uid, usuario,
          nombreCompletoUsuario, motivo: motivo || null,
        },
        updatedBy: uid, usuarioActualizacion: usuario, fechaActualizacion: ahora,
      },
      $push: {
        historialVinculaciones: eventoVinculacion,
        historialVerificacionIdentidadImportacion: eventoRevision,
      },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true });
    if (!actualizado) return res.status(409).json({ ok: false,
      msg: 'La programación cambió durante la vinculación. Vuelve a consultar.' });
    return res.json({ ok: true, programacionId, hc: paciente.hc,
      msg: `HC ${paciente.hc} vinculada. Prevalecen los datos del maestro y se conservaron los originales en el historial.` });
  } catch (error) {
    console.error('Error al vincular HC con revisión de diferencias:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo completar la vinculación individual.' });
  }
};

module.exports = { vincularHCRevisadaImportacion };
