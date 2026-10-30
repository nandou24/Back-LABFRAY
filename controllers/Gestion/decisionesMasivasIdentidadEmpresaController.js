const mongoose = require('mongoose');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const Solicitud = require('../../models/Gestion/SolicitudAtencion');
const RecursoHumano = require('../../models/Mantenimiento/RecHumano');
const { consultarIdentidadUna } = require('./verificacionMasivaIdentidadEmpresaController');

// ====== Decisiones auditables sin crear pacientes ni vincular HC ======
const DECISIONES = new Set([
  'CONFORME', 'CONFIRMAR_MAESTRO', 'DESCARTAR_CANDIDATO',
  'PENDIENTE', 'SIN_COINCIDENCIA_REVISADA', 'DOCUMENTO_PENDIENTE',
]);
const texto = (v) => String(v ?? '').trim();
const normalizar = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const documentoIgual = (a, b) => !!(a?.nroDoc && b?.nroDoc &&
  normalizar(a.tipoDoc) === normalizar(b.tipoDoc) && normalizar(a.nroDoc) === normalizar(b.nroDoc));

const nombreOperador = async (user) => {
  const uid = texto(user?.uid);
  const login = texto(user?.nombreUsuario);
  const filtros = [];
  if (uid) filtros.push({ codRecHumano: uid });
  if (login) filtros.push({ 'datosLogueo.nombreUsuario': login });
  if (!filtros.length) return null;
  const recursos = await RecursoHumano.find({ $or: filtros })
    .select('codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano datosLogueo.nombreUsuario').lean();
  const recurso = recursos.find((r) => texto(r.codRecHumano) === uid)
    ?? recursos.find((r) => texto(r.datosLogueo?.nombreUsuario).toLowerCase() === login.toLowerCase());
  return recurso ? [recurso.apePatRecHumano, recurso.apeMatRecHumano, recurso.nombreRecHumano]
    .map(texto).filter(Boolean).join(' ') : null;
};

const validarDecision = (decision, consulta) => {
  const { categoria, candidatos, masCandidatos, identidad } = consulta;
  const codigo = decision.decision;
  const id = decision.pacienteIdCandidato;
  const elegido = id ? candidatos.find((c) => c.pacienteId === id) : null;
  if (id && !elegido) return 'El candidato seleccionado ya no está en la consulta. Vuelve a consultar.';
  if (codigo === 'CONFORME') {
    if (categoria !== 'DOCUMENTO_CONFORME' || !elegido || !elegido.hc || !elegido.coincideDocumento || !elegido.coincideNombreCompleto)
      return 'La confirmación masiva solo admite documento vigente y nombres conformes.';
  } else if (codigo === 'CONFIRMAR_MAESTRO') {
    if (!['DOCUMENTO_REVISAR', 'DOCUMENTO_MULTIPLE'].includes(categoria) ||
        !elegido?.hc || !documentoIgual(identidad, elegido) || masCandidatos || !decision.confirmacionDiferencias)
      return 'Para confirmar esta identidad, selecciona un paciente con el mismo documento vigente y verifica las diferencias.';
  } else if (codigo === 'DESCARTAR_CANDIDATO') {
    if (categoria !== 'NOMINAL' || !elegido || elegido.coincideDocumento)
      return 'Solo se pueden descartar candidatos nominales con documento distinto.';
  } else if (codigo === 'SIN_COINCIDENCIA_REVISADA') {
    if (categoria !== 'SIN_COINCIDENCIA' || id)
      return 'La categoría actual ya no permite marcar sin coincidencias.';
  } else if (codigo === 'DOCUMENTO_PENDIENTE') {
    if (categoria !== 'SIN_DOCUMENTO' || id)
      return 'Solo se permite confirmar documento pendiente si no se proporcionó documento.';
  } else if (codigo === 'PENDIENTE') {
    if (categoria === 'YA_VINCULADA') return 'Esta programación ya tiene HC vinculada.';
  }
  return null;
};

const guardarUna = async (importacionId, entrada, usuario, nombreCompletoUsuario) => {
  const programacionId = texto(entrada?.programacionId);
  const decision = texto(entrada?.decision).toUpperCase();
  const candidatoId = texto(entrada?.pacienteIdCandidato) || null;
  const huella = texto(entrada?.huellaConsulta);
  const motivo = texto(entrada?.motivo);
  const confirmacionDiferencias = entrada?.confirmacionDiferencias === true;
  const error = (msg) => ({ programacionId, estado: 'ERROR', msg });
  if (!mongoose.isValidObjectId(programacionId) || !DECISIONES.has(decision) ||
      !/^[a-f0-9]{64}$/.test(huella) || motivo.length > 300 ||
      (candidatoId && !mongoose.isValidObjectId(candidatoId))) {
    return error('Datos de decisión inválidos. Actualiza la consulta e intenta nuevamente.');
  }
  const p = await Programacion.findOne({ _id: programacionId, importacionId,
    origenRegistro: 'IMPORTACION_EXCEL' }).lean();
  if (!p) return error('No existe esta programación dentro del lote indicado.');
  if (p.pacienteId || p.hc || p.estadoProgramacion !== 'PROGRAMADO')
    return error('Esta programación ya está vinculada o inició su atención. No admite revisión previa.');
  if (await Solicitud.exists({ programacionEmpresaId: p._id }))
    return error('La programación tiene solicitudes; no se permite revisar la identidad mediante este flujo.');

  const consulta = await consultarIdentidadUna(p);
  if (consulta.huellaConsulta !== huella) return error('Los datos o candidatos cambiaron. Vuelve a consultar antes de confirmar.');
  const detalle = { decision, pacienteIdCandidato: candidatoId, confirmacionDiferencias };
  const errorDecision = validarDecision(detalle, consulta);
  if (errorDecision) return error(errorDecision);

  const anterior = p.revisionIdentidadImportacion;
  if (anterior?.decision === decision &&
      String(anterior?.pacienteIdCandidato ?? '') === (candidatoId ?? '') &&
      anterior?.huellaConsulta === huella && texto(anterior?.motivo) === motivo) {
    return { programacionId, estado: 'YA_REGISTRADA', msg: 'La decisión ya estaba registrada.' };
  }
  const candidato = candidatoId ? consulta.candidatos.find((c) => c.pacienteId === candidatoId) : null;
  const fecha = new Date();
  const evento = {
    decision, categoriaConsulta: consulta.categoria,
    pacienteIdCandidato: candidatoId, hcCandidata: candidato?.hc ?? null,
    documentoCoincidente: !!candidato?.coincideDocumento,
    huellaConsulta: huella, motivo: motivo || null, confirmacionDiferencias,
    identidadProgramacion: {
      tipoDoc: p.tipoDoc ?? null, nroDoc: p.nroDoc ?? null,
      apePatCliente: p.apePatCliente, apeMatCliente: p.apeMatCliente ?? '', nombreCliente: p.nombreCliente,
    },
    identidadCandidato: candidato ? {
      tipoDoc: candidato.tipoDoc ?? null, nroDoc: candidato.nroDoc ?? null,
      apePatCliente: candidato.apePatCliente, apeMatCliente: candidato.apeMatCliente ?? '',
      nombreCliente: candidato.nombreCliente,
    } : {},
    fecha, ejecutadoPor: usuario.uid, usuario: usuario.nombreUsuario,
    nombreCompletoUsuario,
  };
  const actualizado = await Programacion.findOneAndUpdate({
    _id: p._id, importacionId, origenRegistro: 'IMPORTACION_EXCEL',
    __v: p.__v, pacienteId: null, hc: null, estadoProgramacion: 'PROGRAMADO',
    tipoDoc: p.tipoDoc ?? null, nroDoc: p.nroDoc ?? null,
    apePatCliente: p.apePatCliente, apeMatCliente: p.apeMatCliente ?? null, nombreCliente: p.nombreCliente,
  }, {
    $push: { historialVerificacionIdentidadImportacion: evento },
    $set: {
      revisionIdentidadImportacion: {
        decision, pacienteIdCandidato: candidatoId, hcCandidata: candidato?.hc ?? null,
        categoriaConsulta: consulta.categoria, huellaConsulta: huella, fecha,
        ejecutadoPor: usuario.uid, usuario: usuario.nombreUsuario,
        nombreCompletoUsuario, motivo: motivo || null,
      },
      updatedBy: usuario.uid, usuarioActualizacion: usuario.nombreUsuario,
      fechaActualizacion: fecha,
    },
    $inc: { __v: 1 },
  }, { new: false, runValidators: true });
  if (!actualizado) return error('La programación cambió mientras se guardaba. Actualiza el diálogo.');
  // ====== Confirmar persistencia antes de responder como guardada ======
  const verificacion = await Programacion.findById(p._id)
    .select('revisionIdentidadImportacion historialVerificacionIdentidadImportacion').lean();
  const ultima = verificacion?.historialVerificacionIdentidadImportacion?.at(-1);
  const actual = verificacion?.revisionIdentidadImportacion;
  if (actual?.decision !== decision || actual?.huellaConsulta !== huella ||
      new Date(actual?.fecha).getTime() !== fecha.getTime() ||
      ultima?.decision !== decision || new Date(ultima?.fecha).getTime() !== fecha.getTime()) {
    return error('No se confirmó la persistencia de la decisión. Verifica el modelo y vuelve a consultar.');
  }
  return { programacionId, estado: 'GUARDADA', decision,
    msg: 'Decisión auditada. La programación sigue sin HC vinculada.' };
};

const registrarDecisionesImportacion = async (req, res) => {
  try {
    const importacionId = texto(req.body?.importacionId);
    const decisiones = req.body?.decisiones;
    if (!/^[a-zA-Z0-9-]{18,80}$/.test(importacionId) || !Array.isArray(decisiones) ||
        !decisiones.length || decisiones.length > 50 ||
        new Set(decisiones.map((d) => texto(d?.programacionId))).size !== decisiones.length) {
      return res.status(400).json({ ok: false, msg: 'Lote o lista de decisiones inválidos (máximo 50 filas diferentes).' });
    }
    const uid = texto(req.user?.uid);
    const nombreUsuario = texto(req.user?.nombreUsuario);
    if (!uid) return res.status(401).json({ ok: false, msg: 'No se identificó al usuario responsable.' });
    const operador = { uid, nombreUsuario };
    const nombreCompletoUsuario = await nombreOperador(req.user);
    const resultados = new Array(decisiones.length);
    // ====== Limitar concurrencia para no saturar MongoDB ======
    let indice = 0;
    await Promise.all(Array.from({ length: Math.min(5, decisiones.length) }, async () => {
      while (indice < decisiones.length) {
        const actual = indice++;
        try {
          resultados[actual] = await guardarUna(importacionId, decisiones[actual], operador, nombreCompletoUsuario);
        } catch (e) {
          console.error('Error de decisión individual de importación:', e);
          resultados[actual] = {
            programacionId: texto(decisiones[actual]?.programacionId), estado: 'ERROR',
            msg: e.status === 422 ? e.message : 'No se pudo guardar esta decisión. Reintenta después de consultar.',
          };
        }
      }
    }));
    const resumen = {
      guardadas: resultados.filter((r) => r.estado === 'GUARDADA').length,
      reconocidas: resultados.filter((r) => r.estado === 'YA_REGISTRADA').length,
      errores: resultados.filter((r) => r.estado === 'ERROR').length,
    };
    return res.json({ ok: resumen.errores === 0, resumen, resultados,
      msg: resumen.errores ? 'Algunas decisiones requieren revisión; las restantes se guardaron.'
        : 'Decisiones registradas con auditoría. No se vinculó ninguna HC.' });
  } catch (error) {
    console.error('Error de decisiones masivas de identidad:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo registrar la revisión masiva.' });
  }
};

module.exports = { registrarDecisionesImportacion };
