const mongoose = require('mongoose');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const Paciente = require('../../models/Mantenimiento/Paciente');
const Solicitud = require('../../models/Gestion/SolicitudAtencion');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const { consultarIdentidadUna } = require('./verificacionMasivaIdentidadEmpresaController');

const texto = (valor) => String(valor ?? '').trim();
const clave = (valor) => texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();
const errorFila = (programacionId, msg) => ({ programacionId, estado: 'ERROR', msg });

const obtenerOperador = async (user) => {
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

// ====== Vincular únicamente documento vigente y nombres conformes ======
const vincularUna = async (importacionId, entrada, usuario, nombreCompletoUsuario) => {
  const programacionId = texto(entrada?.programacionId);
  const pacienteId = texto(entrada?.pacienteId);
  const huellaConsulta = texto(entrada?.huellaConsulta);
  if (!mongoose.isValidObjectId(programacionId) || !mongoose.isValidObjectId(pacienteId) ||
      !/^[a-f0-9]{64}$/.test(huellaConsulta)) {
    return errorFila(programacionId, 'Datos de vinculación inválidos. Vuelve a consultar.');
  }
  const p = await Programacion.findOne({ _id: programacionId, importacionId,
    origenRegistro: 'IMPORTACION_EXCEL' }).lean();
  if (!p) return errorFila(programacionId, 'La programación no pertenece a este lote.');

  // ====== No crear eventos duplicados al reintentar un lote ======
  if (p.pacienteId || p.hc) {
    if (texto(p.pacienteId) === pacienteId && p.hc) {
      const pacienteVinculado = await Paciente.findById(pacienteId).select('hc').lean();
      if (pacienteVinculado?.hc === p.hc) {
        return { programacionId, estado: 'YA_VINCULADA', hc: p.hc,
          msg: 'La programación ya tenía vinculada esta HC.' };
      }
    }
    return errorFila(programacionId, 'Esta programación ya está vinculada con otra HC o tiene datos inconsistentes.');
  }
  if (p.estadoProgramacion !== 'PROGRAMADO' || p.identidadTemporalActiva || p.fechaInicioAtencion) {
    return errorFila(programacionId, 'Solo se permite primera vinculación antes de iniciar la atención.');
  }
  if (await Solicitud.exists({ programacionEmpresaId: p._id })) {
    return errorFila(programacionId, 'La programación ya tiene solicitudes. No se modifica.');
  }
  const consulta = await consultarIdentidadUna(p);
  if (consulta.huellaConsulta !== huellaConsulta) {
    return errorFila(programacionId, 'La identidad o los candidatos cambiaron. Vuelve a consultar.');
  }
  const candidato = consulta.candidatos[0];
  if (consulta.categoria !== 'DOCUMENTO_CONFORME' || consulta.masCandidatos ||
      consulta.candidatos.length !== 1 || candidato?.pacienteId !== pacienteId ||
      !candidato.hc || !candidato.coincideDocumento || !candidato.coincideNombreCompleto) {
    return errorFila(programacionId, 'No existe una coincidencia documental y nominal única y conforme.');
  }
  const paciente = await Paciente.findById(pacienteId)
    .select('hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento tipoHC estadoConciliacion').lean();
  if (!paciente?.hc || (paciente.tipoHC === 'PROVISIONAL' && paciente.estadoConciliacion !== 'CONCILIADA') ||
      !paciente.tipoDoc || !paciente.nroDoc || paciente.hc !== candidato.hc ||
      clave(p.tipoDoc) !== clave(paciente.tipoDoc) || clave(p.nroDoc) !== clave(paciente.nroDoc) ||
      clave(p.nombreCliente) !== clave(paciente.nombreCliente) ||
      clave(p.apePatCliente) !== clave(paciente.apePatCliente) ||
      (p.apeMatCliente && paciente.apeMatCliente && clave(p.apeMatCliente) !== clave(paciente.apeMatCliente))) {
    return errorFila(programacionId, 'Los datos actuales del maestro no permiten una vinculación masiva segura.');
  }
  const fecha = new Date();
  const evento = {
    tipo: 'VINCULACION_INICIAL', pacienteIdAnterior: null, hcAnterior: null,
    pacienteIdNuevo: paciente._id, hcNueva: paciente.hc,
    tipoDocAnterior: p.tipoDoc ?? null, nroDocAnterior: p.nroDoc ?? null,
    tipoDocNuevo: paciente.tipoDoc, nroDocNuevo: paciente.nroDoc,
    fecha, ejecutadoPor: usuario.uid, usuario: usuario.nombreUsuario,
    nombreCompletoUsuario, origenDocumento: 'EMPRESA', tipoResolucion: 'COINCIDENCIA_EXACTA',
    motivoDecision: 'Vinculación masiva de identidad conforme (PE.6.5E.5C.1)',
    identidadDeclarada: {
      nombreCliente: p.nombreCliente, apePatCliente: p.apePatCliente,
      apeMatCliente: p.apeMatCliente ?? null, sexoCliente: p.sexoCliente ?? null,
      fechaNacimiento: p.fechaNacimiento ? new Date(p.fechaNacimiento).toISOString().slice(0, 10) : null,
    },
  };
  // ====== La HC registrada prevalece sobre los datos enviados en Excel ======
  const identidadMaestro = {
    nombreCliente: paciente.nombreCliente,
    apePatCliente: paciente.apePatCliente,
    apeMatCliente: paciente.apeMatCliente ?? '',
    sexoCliente: paciente.sexoCliente ?? p.sexoCliente ?? null,
    fechaNacimiento: paciente.fechaNacimiento ?? p.fechaNacimiento ?? null,
  };
  evento.cambiosIdentidad = Object.entries(identidadMaestro)
    .map(([campo, valorNuevo]) => {
      const normalizar = (v) => campo === 'fechaNacimiento'
        ? (v ? new Date(v).toISOString().slice(0, 10) : null) : texto(v);
      const valorAnterior = normalizar(p[campo]);
      const nuevo = normalizar(valorNuevo);
      return valorAnterior === nuevo ? null : { campo, valorAnterior, valorNuevo: nuevo };
    }).filter(Boolean);
  // ====== Actualización atómica: una sola primera vinculación por programación ======
  const actualizado = await Programacion.findOneAndUpdate({
    _id: p._id, importacionId, origenRegistro: 'IMPORTACION_EXCEL',
    __v: p.__v, pacienteId: null, hc: null, estadoProgramacion: 'PROGRAMADO',
    identidadTemporalActiva: { $ne: true }, fechaInicioAtencion: null,
    tipoDoc: p.tipoDoc, nroDoc: p.nroDoc,
    nombreCliente: p.nombreCliente, apePatCliente: p.apePatCliente,
    apeMatCliente: p.apeMatCliente ?? null,
  }, {
    $set: { pacienteId: paciente._id, hc: paciente.hc, ...identidadMaestro,
      tipoDoc: paciente.tipoDoc, nroDoc: paciente.nroDoc,
      updatedBy: usuario.uid, usuarioActualizacion: usuario.nombreUsuario,
      fechaActualizacion: fecha },
    $push: { historialVinculaciones: evento },
    $inc: { __v: 1 },
  }, { new: true, runValidators: true });
  if (!actualizado) {
    return errorFila(programacionId, 'La programación cambió durante el proceso. Consulta otra vez.');
  }
  return { programacionId, estado: 'VINCULADA', hc: actualizado.hc,
    msg: 'HC vinculada con historial de auditoría.' };
};

// ====== Ejecutar lote pequeño sin vincular casos observados ======
const vincularHCConformesImportacion = async (req, res) => {
  try {
    const importacionId = texto(req.body?.importacionId);
    const vinculaciones = req.body?.vinculaciones;
    if (!/^\d{8}-\d{4,12}$/.test(importacionId) || !Array.isArray(vinculaciones) ||
        !vinculaciones.length || vinculaciones.length > 50 ||
        new Set(vinculaciones.map((v) => texto(v?.programacionId))).size !== vinculaciones.length) {
      return res.status(400).json({ ok: false, msg: 'Lote inválido o más de 50 programaciones diferentes.' });
    }
    const uid = texto(req.user?.uid);
    const nombreUsuario = texto(req.user?.nombreUsuario);
    if (!uid) return res.status(401).json({ ok: false, msg: 'Usuario no identificado.' });
    const operador = { uid, nombreUsuario };
    const nombreCompletoUsuario = await obtenerOperador(req.user);
    const resultados = new Array(vinculaciones.length);
    let indice = 0;
    await Promise.all(Array.from({ length: Math.min(5, vinculaciones.length) }, async () => {
      while (indice < vinculaciones.length) {
        const pos = indice++;
        try {
          resultados[pos] = await vincularUna(importacionId, vinculaciones[pos], operador, nombreCompletoUsuario);
        } catch (err) {
          console.error('Error al vincular HC de importación:', err);
          resultados[pos] = errorFila(texto(vinculaciones[pos]?.programacionId),
            err.status === 422 ? err.message : 'No se pudo vincular esta fila. Actualiza y revisa.');
        }
      }
    }));
    const resumen = {
      vinculadas: resultados.filter((r) => r.estado === 'VINCULADA').length,
      reconocidas: resultados.filter((r) => r.estado === 'YA_VINCULADA').length,
      errores: resultados.filter((r) => r.estado === 'ERROR').length,
    };
    return res.json({ ok: resumen.errores === 0, resumen, resultados,
      msg: resumen.errores ? 'Algunas filas requieren revisión; las demás se vincularon.'
        : 'Historias clínicas vinculadas y auditadas.' });
  } catch (err) {
    console.error('Error de vinculación masiva de HC:', err);
    return res.status(500).json({ ok: false, msg: 'No se pudo completar la vinculación masiva.' });
  }
};

module.exports = { vincularHCConformesImportacion };
