const mongoose = require('mongoose');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const Solicitud = require('../../models/Gestion/SolicitudAtencion');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');

const texto = (v) => String(v ?? '').trim();

// ====== Identificar al responsable para la auditoría ======
const obtenerNombreOperador = async (user) => {
  const uid = texto(user?.uid);
  const nombreUsuario = texto(user?.nombreUsuario);
  const filtros = [];
  if (uid) filtros.push({ codRecHumano: uid });
  if (nombreUsuario) filtros.push({ 'datosLogueo.nombreUsuario': nombreUsuario });
  if (!filtros.length) return null;
  const recursos = await RecursoHumano.find({ $or: filtros })
    .select('codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano datosLogueo.nombreUsuario').lean();
  const recurso = recursos.find((r) => texto(r.codRecHumano) === uid)
    ?? recursos.find((r) => texto(r.datosLogueo?.nombreUsuario).toLowerCase() === nombreUsuario.toLowerCase());
  return recurso ? [recurso.apePatRecHumano, recurso.apeMatRecHumano, recurso.nombreRecHumano]
    .map(texto).filter(Boolean).join(' ') : null;
};

// ====== Desvinculación auditada solo antes del inicio de atención ======
const desvincularHCImportacion = async (req, res) => {
  try {
    const importacionId = texto(req.body?.importacionId);
    const programacionId = texto(req.body?.programacionId);
    const hcActual = texto(req.body?.hcActual);
    const motivo = texto(req.body?.motivo);
    const uid = texto(req.user?.uid);
    const nombreUsuario = texto(req.user?.nombreUsuario);

    if (!uid) return res.status(401).json({ ok: false, msg: 'Usuario no identificado.' });
    if (!/^[a-zA-Z0-9-]{18,80}$/.test(importacionId) ||
        !mongoose.isValidObjectId(programacionId) || !hcActual ||
        motivo.length < 10 || motivo.length > 300) {
      return res.status(400).json({ ok: false,
        msg: 'Datos inválidos. Indica la HC y un motivo entre 10 y 300 caracteres.' });
    }

    const p = await Programacion.findOne({
      _id: programacionId, importacionId, origenRegistro: 'IMPORTACION_EXCEL',
    }).lean();
    if (!p) return res.status(404).json({ ok: false, msg: 'No se encontró la programación en este lote.' });
    if (!p.pacienteId || !p.hc) {
      return res.status(409).json({ ok: false, msg: 'La programación ya está sin HC vinculada.' });
    }
    if (p.hc !== hcActual) {
      return res.status(409).json({ ok: false,
        msg: 'La HC vinculada cambió. Vuelve a consultar la programación.' });
    }
    if (p.estadoProgramacion !== 'PROGRAMADO') {
      return res.status(409).json({ ok: false,
        msg: `La programación está en estado ${texto(p.estadoProgramacion) || 'SIN ESTADO'}. Solo se permite desvincular en PROGRAMADO.` });
    }
    if (p.fechaInicioAtencion) {
      return res.status(409).json({ ok: false,
        msg: 'La programación tiene una fecha de inicio de atención registrada. No se puede desvincular.' });
    }
    if (await Solicitud.exists({ programacionEmpresaId: p._id })) {
      return res.status(409).json({ ok: false,
        msg: 'Ya existen solicitudes asociadas. No se puede desvincular desde este módulo.' });
    }

    // ====== Restaurar los nombres importados cuando fueron reemplazados por los del maestro ======
    const ultimoVinculo = [...(p.historialVinculaciones ?? [])].reverse().find((v) =>
      v.tipo === 'VINCULACION_INICIAL' && String(v.pacienteIdNuevo) === String(p.pacienteId) &&
      v.hcNueva === p.hc);
    const original = ultimoVinculo?.tipoResolucion === 'DISCREPANCIA_DOCUMENTO_COINCIDENTE'
      ? ultimoVinculo.identidadDeclarada : null;
    const restaurar = original?.nombreCliente && original?.apePatCliente ? {
      nombreCliente: original.nombreCliente,
      apePatCliente: original.apePatCliente,
      apeMatCliente: original.apeMatCliente ?? '',
      sexoCliente: original.sexoCliente ?? null,
      fechaNacimiento: original.fechaNacimiento ?? null,
    } : {};
    const cambiosRestaurados = [];
    for (const campo of ['nombreCliente', 'apePatCliente', 'apeMatCliente', 'sexoCliente', 'fechaNacimiento']) {
      if (!Object.prototype.hasOwnProperty.call(restaurar, campo)) continue;
      const anterior = campo === 'fechaNacimiento' && p[campo]
        ? new Date(p[campo]).toISOString().slice(0, 10) : texto(p[campo]);
      const nuevo = campo === 'fechaNacimiento' && restaurar[campo]
        ? new Date(restaurar[campo]).toISOString().slice(0, 10) : texto(restaurar[campo]);
      if (anterior !== nuevo) cambiosRestaurados.push({ campo, valorAnterior: anterior || null, valorNuevo: nuevo || null });
    }
    const fecha = new Date();
    const nombreCompletoUsuario = await obtenerNombreOperador(req.user);
    const evento = {
      tipo: 'DESVINCULACION_PRE_ATENCION',
      pacienteIdAnterior: p.pacienteId, hcAnterior: p.hc,
      pacienteIdNuevo: null, hcNueva: null,
      tipoDocAnterior: p.tipoDoc ?? null, nroDocAnterior: p.nroDoc ?? null,
      tipoDocNuevo: p.tipoDoc ?? null, nroDocNuevo: p.nroDoc ?? null,
      fecha, ejecutadoPor: uid, usuario: nombreUsuario, nombreCompletoUsuario,
      origenDocumento: 'EMPRESA', tipoResolucion: 'RECTIFICACION_PRE_ATENCION',
      motivoDecision: motivo,
      identidadDeclarada: {
        nombreCliente: p.nombreCliente ?? null,
        apePatCliente: p.apePatCliente ?? null,
        apeMatCliente: p.apeMatCliente ?? null,
        sexoCliente: p.sexoCliente ?? null,
        fechaNacimiento: p.fechaNacimiento
          ? new Date(p.fechaNacimiento).toISOString().slice(0, 10) : null,
      },
      cambiosIdentidad: cambiosRestaurados,
    };

    // ====== Compare-and-set para no desvincular una programación modificada ======
    const actualizado = await Programacion.findOneAndUpdate({
      _id: p._id, importacionId, origenRegistro: 'IMPORTACION_EXCEL',
      __v: p.__v,
      pacienteId: p.pacienteId, hc: p.hc,
      estadoProgramacion: 'PROGRAMADO', fechaInicioAtencion: null,
    }, {
      $set: {
        pacienteId: null, hc: null, revisionIdentidadImportacion: null,
        ...restaurar,
        updatedBy: uid, usuarioActualizacion: nombreUsuario, fechaActualizacion: fecha,
      },
      $push: { historialVinculaciones: evento },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true });

    if (!actualizado) {
      return res.status(409).json({ ok: false,
        msg: 'La programación cambió durante la operación. Vuelve a consultar.' });
    }
    return res.json({ ok: true, programacionId, hcAnterior: p.hc,
      msg: `HC ${p.hc} desvinculada. La programación conserva sus datos y su historial.` });
  } catch (error) {
    console.error('Error al desvincular HC de importación:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo desvincular la HC.' });
  }
};

module.exports = { desvincularHCImportacion };
