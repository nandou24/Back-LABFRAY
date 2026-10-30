const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const Paciente = require('../../models/Mantenimiento/Paciente');

// ====== Coincidencias de identidad: consulta de solo lectura ======
const texto = (v) => String(v ?? '').trim();
const clave = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();
const primero = (v) => clave(v).split(' ')[0] || '';
const escapar = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const acentos = { A: '[AÁÀÄÂ]', E: '[EÉÈËÊ]', I: '[IÍÌÏÎ]', O: '[OÓÒÖÔ]', U: '[UÚÙÜÛ]', N: '[NÑ]' };
const patronFlexible = (v) => [...clave(v)].map((ch) => ch === ' ' ? '\\s+' : (acentos[ch] || escapar(ch))).join('');
const fechaSimple = (v) => v ? new Date(v).toISOString().slice(0, 10) : null;

const convertirCandidato = (paciente, origen, programacion) => {
  const coincideDocumento = !!(programacion.nroDoc &&
    clave(programacion.tipoDoc) === clave(paciente.tipoDoc) && clave(programacion.nroDoc) === clave(paciente.nroDoc));
  const nombreExacto = clave(programacion.nombreCliente) === clave(paciente.nombreCliente);
  const paternoExacto = clave(programacion.apePatCliente) === clave(paciente.apePatCliente);
  // ====== Materno opcional: no participa en la búsqueda nominal ======
  const maternoComparable = !!(texto(programacion.apeMatCliente) && texto(paciente.apeMatCliente));
  const maternoExacto = !maternoComparable || clave(programacion.apeMatCliente) === clave(paciente.apeMatCliente);
  return {
    pacienteId: String(paciente._id), hc: paciente.hc ?? null,
    tipoDoc: paciente.tipoDoc ?? null, nroDoc: paciente.nroDoc ?? null,
    apePatCliente: paciente.apePatCliente ?? '', apeMatCliente: paciente.apeMatCliente ?? '',
    nombreCliente: paciente.nombreCliente ?? '', sexoCliente: paciente.sexoCliente ?? null,
    fechaNacimiento: fechaSimple(paciente.fechaNacimiento), origen,
    coincideDocumento, coincideNombreCompleto: nombreExacto && paternoExacto && maternoExacto,
    coincidePrimerNombrePaterno: primero(programacion.nombreCliente) === primero(paciente.nombreCliente) && paternoExacto,
  };
};

const verificarIdentidadesImportacion = async (req, res) => {
  try {
    const importacionId = texto(req.body?.importacionId);
    const pagina = Number(req.body?.pagina ?? 1);
    const tamanoPagina = Number(req.body?.tamanoPagina ?? 50);
    if (!/^[a-zA-Z0-9-]{18,80}$/.test(importacionId) || !Number.isInteger(pagina) || pagina < 1 ||
        !Number.isInteger(tamanoPagina) || tamanoPagina < 1 || tamanoPagina > 100 || pagina > 1000) {
      return res.status(400).json({ ok: false, msg: 'Identificador o paginación inválidos.' });
    }
    const filtro = { importacionId, origenRegistro: 'IMPORTACION_EXCEL' };
    const total = await Programacion.countDocuments(filtro);
    if (!total) return res.status(404).json({ ok: false, msg: 'No se encontraron programaciones para esta importación.' });
    const paginas = Math.ceil(total / tamanoPagina);
    if (pagina > paginas) return res.status(400).json({ ok: false, msg: 'La página solicitada no existe.' });
    const programaciones = await Programacion.find(filtro)
      .sort({ filaExcelImportacion: 1, _id: 1 }).skip((pagina - 1) * tamanoPagina).limit(tamanoPagina)
      .select('_id codProgramacion filaExcelImportacion nombreCliente apePatCliente apeMatCliente tipoDoc nroDoc sexoCliente fechaNacimiento hc pacienteId estadoProgramacion')
      .lean();

    const documentos = new Map();
    const nombres = new Map();
    for (const p of programaciones) {
      if (p.pacienteId) continue;
      if (p.nroDoc && p.tipoDoc) {
        const key = `${clave(p.tipoDoc)}:${clave(p.nroDoc)}`;
        documentos.set(key, { tipoDoc: clave(p.tipoDoc), nroDoc: clave(p.nroDoc) });
      }
      const nombre = primero(p.nombreCliente);
      const paterno = clave(p.apePatCliente);
      if (nombre && paterno) {
        nombres.set(`${paterno}:${nombre}`, {
          apePatCliente: new RegExp(`^\\s*${patronFlexible(paterno)}\\s*$`, 'i'),
          nombreCliente: new RegExp(`^\\s*${patronFlexible(nombre)}(?:\\s|$)`, 'i'),
        });
      }
    }
    const seleccion = '_id hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento';
    const porDocumento = documentos.size
      ? await Paciente.find({ $or: [...documentos.values()] }).select(seleccion).lean() : [];
    // ====== No consultar historial documental ======
    // ====== Limitar la búsqueda nominal sin clasificar resultados truncados ======
    const nominal = nombres.size
      ? await Paciente.find({ $or: [...nombres.values()] }).select(seleccion).limit(2001).lean() : [];
    if (nominal.length > 2000) {
      return res.status(422).json({ ok: false, msg: 'La búsqueda nominal contiene demasiados candidatos. Reduce el tamaño de página e intenta nuevamente.' });
    }
    const documentosPorClave = new Map();
    porDocumento.forEach((p) => {
      const key = `${clave(p.tipoDoc)}:${clave(p.nroDoc)}`;
      if (!documentosPorClave.has(key)) documentosPorClave.set(key, []);
      documentosPorClave.get(key).push(p);
    });
    const nominalPorClave = new Map();
    nominal.forEach((p) => {
      const key = `${clave(p.apePatCliente)}:${primero(p.nombreCliente)}`;
      if (!nominalPorClave.has(key)) nominalPorClave.set(key, []);
      nominalPorClave.get(key).push(p);
    });

    const resultados = programaciones.map((p) => {
      const documento = p.nroDoc && p.tipoDoc ? `${clave(p.tipoDoc)}:${clave(p.nroDoc)}` : '';
      const exactas = documento ? (documentosPorClave.get(documento) ?? []) : [];
      const nominales = nominalPorClave.get(`${clave(p.apePatCliente)}:${primero(p.nombreCliente)}`) ?? [];
      let candidatos = [];
      let categoria = 'SIN_COINCIDENCIA';
      if (p.pacienteId) categoria = 'YA_VINCULADA';
      else if (exactas.length > 1) {
        categoria = 'DOCUMENTO_MULTIPLE';
        candidatos = exactas.map((c) => convertirCandidato(c, 'DOCUMENTO_VIGENTE', p));
      } else if (exactas.length === 1) {
        candidatos = [convertirCandidato(exactas[0], 'DOCUMENTO_VIGENTE', p)];
        categoria = candidatos[0].coincideNombreCompleto && !!candidatos[0].hc ? 'DOCUMENTO_CONFORME' : 'DOCUMENTO_REVISAR';
      } else {
        candidatos = nominales.map((c) => convertirCandidato(c, 'NOMBRES', p));
        categoria = !documento ? 'SIN_DOCUMENTO' : candidatos.length ? 'NOMINAL' : 'SIN_COINCIDENCIA';
      }
      return {
        programacionId: String(p._id), codProgramacion: p.codProgramacion,
        filaExcel: p.filaExcelImportacion, estadoProgramacion: p.estadoProgramacion,
        identidad: {
          tipoDoc: p.tipoDoc ?? null, nroDoc: p.nroDoc ?? null,
          nombreCliente: p.nombreCliente, apePatCliente: p.apePatCliente, apeMatCliente: p.apeMatCliente ?? '',
          sexoCliente: p.sexoCliente ?? null, fechaNacimiento: fechaSimple(p.fechaNacimiento),
        },
        categoria, candidatos: candidatos.slice(0, 20), masCandidatos: candidatos.length > 20,
        hcActual: p.hc ?? null,
      };
    });
    const resumen = {
      totalPagina: resultados.length,
      documentoConforme: resultados.filter((r) => r.categoria === 'DOCUMENTO_CONFORME').length,
      porRevisar: resultados.filter((r) => ['DOCUMENTO_REVISAR', 'DOCUMENTO_MULTIPLE', 'NOMINAL'].includes(r.categoria)).length,
      sinCoincidencias: resultados.filter((r) => r.categoria === 'SIN_COINCIDENCIA').length,
      sinDocumento: resultados.filter((r) => r.categoria === 'SIN_DOCUMENTO').length,
      yaVinculadas: resultados.filter((r) => r.categoria === 'YA_VINCULADA').length,
    };
    return res.json({ ok: true, soloConsulta: true, importacionId, total, pagina, paginas, tamanoPagina, resumen, resultados });
  } catch (error) {
    console.error('Error en consulta masiva de identidad:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo consultar el maestro para esta importación.' });
  }
};

module.exports = { verificarIdentidadesImportacion };
