const mongoose = require('mongoose');
const Empresa = require('../../models/Mantenimiento/Empresa');
const Paciente = require('../../models/Mantenimiento/Paciente');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');

// ====== Normalizar datos de identificación ======
const texto = (v) => String(v ?? '').trim();
const clave = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();
const regexExacta = (v) => new RegExp(`^\\s*${texto(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\s*$`, 'i');
const coincidenNombres = (a, b) => ['apePatCliente', 'apeMatCliente', 'nombreCliente'].every((campo) => clave(a[campo]) === clave(b[campo]));
const fechaISO = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(v))) return null;
  const fecha = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === v ? fecha : null;
};
const fechaCalendario = (fecha) => fecha ? new Date(fecha).toISOString().slice(0, 10) : null;
const rucValido = (ruc) => {
  if (!/^\d{11}$/.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(ruc[i]), 0);
  return (11 - (suma % 11)) % 10 === Number(ruc[10]);
};
const documentoValido = (tipo, numero) => ({
  DNI: /^\d{8}$/, CE: /^[A-Z0-9]{1,13}$/, PASAPORTE: /^[A-Z0-9]{1,16}$/,
}[tipo]?.test(numero) ?? false);
const particiones = (lista, n = 180) => {
  const salida = [];
  for (let i = 0; i < lista.length; i += n) salida.push(lista.slice(i, i + n));
  return salida;
};
const consultarPorBloques = async (Modelo, filtros, campos, session = null) => {
  if (!filtros.length) return [];
  const resultados = [];
  // ====== No ejecutar consultas paralelas dentro de una transacción ======
  for (const trozo of particiones(filtros)) {
    resultados.push(await Modelo.find({ $or: trozo }).select(campos).session(session).lean());
  }
  return [...new Map(resultados.flat().map((d) => [String(d._id), d])).values()];
};
const identidadFila = (fila) => fila.nroDoc
  ? `${clave(fila.tipoDoc)}:${clave(fila.nroDoc)}`
  : ['apePatCliente', 'apeMatCliente', 'nombreCliente'].map((c) => clave(fila[c])).join(':');

// ====== Validar lote sin realizar escrituras ======
const analizarFilasImportacion = async (entradas, session = null) => {
    if (!Array.isArray(entradas) || entradas.length < 1 || entradas.length > 1000) {
      throw Object.assign(new Error('Envía entre 1 y 1,000 filas para validar.'), { status: 400 });
    }
    const numeros = entradas.map((f) => f?.filaExcel);
    if (numeros.some((n) => !Number.isInteger(n) || n < 2) || new Set(numeros).size !== numeros.length) {
      throw Object.assign(new Error('Las filas de Excel deben tener números únicos y válidos.'), { status: 400 });
    }

    const filas = entradas.map((f) => {
      const d = f?.datos ?? {};
      return {
        filaExcel: f.filaExcel,
        empresaId: texto(f.empresaId), protocoloId: texto(f.protocoloId),
        rucEmpresa: texto(d.rucEmpresa), razonSocialEmpresa: texto(d.razonSocialEmpresa),
        codProtocolo: texto(d.codProtocolo), nombreProtocolo: texto(d.nombreProtocolo),
        fechaProgramada: texto(d.fechaProgramada), sede: texto(d.sede),
        tipoEvaluacion: texto(d.tipoEvaluacion), tipoAtencion: texto(d.tipoAtencion || 'Regular'),
        prioridad: texto(d.prioridad || 'Normal'),
        apePatCliente: texto(d.apePatCliente), apeMatCliente: texto(d.apeMatCliente),
        nombreCliente: texto(d.nombreCliente), tipoDoc: clave(d.tipoDoc), nroDoc: clave(d.nroDoc),
        sexoCliente: texto(d.sexoCliente), fechaNacimiento: texto(d.fechaNacimiento),
        observaciones: texto(d.observaciones),
      };
    });

    const empresaIds = [...new Set(filas.map((f) => f.empresaId).filter((id) => mongoose.isValidObjectId(id)))];
    const rucs = [...new Set(filas.map((f) => f.rucEmpresa).filter((v) => /^\d{11}$/.test(v)))];
    const filtrosEmpresa = [
      ...(empresaIds.length ? [{ _id: { $in: empresaIds } }] : []),
      ...(rucs.length ? [{ ruc: { $in: rucs } }] : []),
    ];
    const empresas = filtrosEmpresa.length ? await Empresa.find({ $or: filtrosEmpresa })
      .select('_id ruc razonSocial estado protocolos').session(session).lean() : [];
    const empresaPorId = new Map(empresas.map((e) => [String(e._id), e]));
    const empresaPorRuc = new Map(empresas.map((e) => [e.ruc, e]));

    const docs = [...new Map(filas.filter((f) => f.nroDoc && documentoValido(f.tipoDoc, f.nroDoc))
      .map((f) => [`${f.tipoDoc}:${f.nroDoc}`, { tipoDoc: f.tipoDoc, nroDoc: f.nroDoc }])).values()];
    const sinDocumento = filas.filter((f) => !f.nroDoc && f.nombreCliente && f.apePatCliente);
    const filtrosNombre = [...new Map(sinDocumento.map((f) => [
      `${clave(f.apePatCliente)}|${clave(f.nombreCliente)}`,
      { apePatCliente: regexExacta(f.apePatCliente), nombreCliente: regexExacta(f.nombreCliente) },
    ])).values()];
    const pacientesPorDoc = await consultarPorBloques(Paciente, docs,
      '_id hc estadoIdentificacion tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento', session);
    const pacientesPorNombre = await consultarPorBloques(Paciente, filtrosNombre,
      '_id hc estadoIdentificacion tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoCliente fechaNacimiento', session);
    const mapaDocumento = new Map();
    pacientesPorDoc.forEach((p) => {
      const key = `${clave(p.tipoDoc)}:${clave(p.nroDoc)}`;
      if (!mapaDocumento.has(key)) mapaDocumento.set(key, []);
      mapaDocumento.get(key).push(p);
    });

    const fechaPorFila = new Map(filas.map((f) => [f.filaExcel, fechaISO(f.fechaProgramada)]));
    const contextos = [...new Map(filas.filter((f) =>
      mongoose.isValidObjectId(f.empresaId) && mongoose.isValidObjectId(f.protocoloId) && fechaPorFila.get(f.filaExcel),
    ).map((f) => [
      `${f.empresaId}:${f.protocoloId}:${f.fechaProgramada}`,
      { empresaId: f.empresaId, protocoloId: f.protocoloId, fechaProgramada: {
        $gte: fechaPorFila.get(f.filaExcel),
        $lt: new Date(fechaPorFila.get(f.filaExcel).getTime() + 86400000),
      } },
    ])).values()];
    const existentes = await consultarPorBloques(Programacion, contextos,
      '_id codProgramacion empresaId protocoloId fechaProgramada pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente estadoProgramacion', session);
    const programacionesPorContexto = new Map();
    existentes.forEach((p) => {
      const key = `${p.empresaId}:${p.protocoloId}:${fechaCalendario(p.fechaProgramada)}`;
      if (!programacionesPorContexto.has(key)) programacionesPorContexto.set(key, []);
      programacionesPorContexto.get(key).push(p);
    });

    const clavesArchivo = new Map();
    const resultados = filas.map((f) => {
      const errores = [];
      const advertencias = [];
      const fecha = fechaPorFila.get(f.filaExcel);
      let paciente = { estado: 'NUEVO', hc: null, pacienteId: null, nombreCompleto: null };
      let empresa = null;
      let protocolo = null;
      if (!fecha) errores.push('Fecha de programación inválida; usa dd/MM/yyyy.');
      if (f.fechaNacimiento && !fechaISO(f.fechaNacimiento)) errores.push('Fecha de nacimiento inválida.');
      if (f.sexoCliente && !['Masculino', 'Femenino'].includes(f.sexoCliente)) errores.push('Sexo inválido.');
      if (f.observaciones.length > 200) errores.push('Observaciones: máximo 200 caracteres.');
      if (!f.nombreCliente || !f.apePatCliente) errores.push('Faltan nombres o apellido paterno.');
      if (!['Callao', 'Comas', 'NoIndica'].includes(f.sede)) errores.push('Selecciona una sede válida.');
      if (!['ETAs', 'Ocupacional', 'PreOcupacional', 'Retiro', 'Toxicológico', 'Otro'].includes(f.tipoEvaluacion)) errores.push('Tipo de evaluación inválido.');
      if (!['Regular', 'Preferencial', 'VIP'].includes(f.tipoAtencion)) errores.push('Tipo de atención inválido.');
      if (!['Normal', 'Alta'].includes(f.prioridad)) errores.push('Prioridad inválida.');
      if (!rucValido(f.rucEmpresa)) errores.push('RUC inválido: verifica sus 11 dígitos y dígito verificador.');
      if (!!f.nroDoc !== !!f.tipoDoc || (f.nroDoc && !documentoValido(f.tipoDoc, f.nroDoc))) {
        errores.push('Tipo y número de documento no coinciden con un formato válido.');
      }
      if (!mongoose.isValidObjectId(f.empresaId)) {
        errores.push('Selecciona una empresa registrada en el catálogo.');
        const encontrada = empresaPorRuc.get(f.rucEmpresa);
        if (encontrada) advertencias.push(`RUC encontrado: ${encontrada.razonSocial}. Selecciona esa empresa.`);
      } else {
        const e = empresaPorId.get(f.empresaId);
        if (!e || e.estado === false) errores.push('La empresa seleccionada no existe o está inactiva.');
        else {
          empresa = { _id: String(e._id), ruc: e.ruc, razonSocial: e.razonSocial };
          if (e.ruc !== f.rucEmpresa) errores.push('El RUC no corresponde a la empresa seleccionada.');
          if (f.razonSocialEmpresa && clave(e.razonSocial) !== clave(f.razonSocialEmpresa)) {
            advertencias.push(`Razón social distinta del maestro: ${e.razonSocial}. Verifica el origen.`);
          }
          const p = (e.protocolos || []).find((p) => String(p._id) === f.protocoloId);
          if (!p || !f.protocoloId) errores.push('Selecciona un protocolo perteneciente a esta empresa.');
          else if (p.estado === false) errores.push('El protocolo se encuentra inactivo.');
          else {
            protocolo = { _id: String(p._id), codigoProtocolo: p.codigoProtocolo, nombreProtocolo: p.nombreProtocolo };
            if (!p.servicios?.length) errores.push('El protocolo no contiene servicios.');
            if (!Number.isInteger(Number(p.plazoResultados?.cantidadDias)) || Number(p.plazoResultados?.cantidadDias) < 1 ||
                !['HABILES', 'CALENDARIO'].includes(p.plazoResultados?.tipoDias)) {
              errores.push('El protocolo no tiene un plazo de resultados válido.');
            }
            if (f.codProtocolo && clave(p.codigoProtocolo) !== clave(f.codProtocolo)) errores.push('El código no corresponde al protocolo seleccionado.');
            if (f.nombreProtocolo && clave(p.nombreProtocolo) !== clave(f.nombreProtocolo)) advertencias.push('El nombre de protocolo difiere del maestro; revisar.');
            if (fecha && p.fechaInicioVigencia && fechaCalendario(fecha) < fechaCalendario(p.fechaInicioVigencia)) errores.push('El protocolo todavía no está vigente en esa fecha.');
            if (fecha && p.fechaFinVigencia && fechaCalendario(fecha) > fechaCalendario(p.fechaFinVigencia)) errores.push('El protocolo está fuera de vigencia en esa fecha.');
          }
        }
      }
      if (f.nroDoc && documentoValido(f.tipoDoc, f.nroDoc)) {
        const encontrados = mapaDocumento.get(`${f.tipoDoc}:${f.nroDoc}`) ?? [];
        if (encontrados.length > 1) {
          paciente = { estado: 'DUPLICADO_DOCUMENTO', hc: null, pacienteId: null, nombreCompleto: null };
          errores.push('Más de una HC usa ese documento. Requiere revisión de pacientes.');
        } else if (encontrados.length === 1) {
          const p = encontrados[0];
          paciente = { estado: coincidenNombres(f, p) ? 'HC_COINCIDE' : 'IDENTIDAD_DIFERENTE',
            hc: p.hc ?? null, pacienteId: String(p._id),
            nombreCompleto: [p.apePatCliente, p.apeMatCliente, p.nombreCliente].filter(Boolean).join(' '),
            // ====== Datos maestros para cotejo asistido, solo con HC y documento único ======
            datosMaestros: p.hc ? {
              tipoDoc: p.tipoDoc ?? '', nroDoc: p.nroDoc ?? '',
              apePatCliente: p.apePatCliente ?? '', apeMatCliente: p.apeMatCliente ?? '',
              nombreCliente: p.nombreCliente ?? '',
              sexoCliente: p.sexoCliente ?? '',
              fechaNacimiento: fechaCalendario(p.fechaNacimiento) ?? '',
            } : null };
          if (!p.hc) errores.push('El paciente encontrado no tiene historia clínica.');
          if (p.hc && f.sexoCliente && p.sexoCliente && clave(f.sexoCliente) !== clave(p.sexoCliente)) {
            advertencias.push('El sexo informado difiere del registrado en la HC; verificar.');
          }
          if (p.hc && f.fechaNacimiento && p.fechaNacimiento &&
              f.fechaNacimiento !== fechaCalendario(p.fechaNacimiento)) {
            advertencias.push('La fecha de nacimiento difiere de la HC; verificar.');
          }
          if (paciente.estado === 'IDENTIDAD_DIFERENTE') errores.push(`El DNI corresponde a HC ${p.hc || '(sin HC)'}, pero los nombres no coinciden.`);
        }
      } else if (!f.nroDoc && f.nombreCliente && f.apePatCliente) {
        const candidatos = pacientesPorNombre.filter((p) => coincidenNombres(f, p));
        paciente = { estado: candidatos.length ? 'COINCIDENCIA_NOMBRE' : 'SIN_DOCUMENTO', hc: null, pacienteId: null, nombreCompleto: null };
        if (candidatos.length) advertencias.push(`Hay ${candidatos.length} posible(s) HC con los mismos nombres. Revisar antes de asociar.`);
        else advertencias.push('Documento pendiente: confirmar identidad antes del registro.');
      }
      if (fecha && empresa && protocolo && f.nombreCliente && f.apePatCliente) {
        const key = `${f.empresaId}:${f.protocoloId}:${f.fechaProgramada}`;
        const candidatas = programacionesPorContexto.get(key) ?? [];
        const duplicada = candidatas.find((p) => {
          if (paciente.pacienteId && String(p.pacienteId ?? '') === paciente.pacienteId) return true;
          if (f.nroDoc && clave(p.tipoDoc) === f.tipoDoc && clave(p.nroDoc) === f.nroDoc) return true;
          return !f.nroDoc && !p.nroDoc && coincidenNombres(f, p);
        });
        if (duplicada) errores.push(`Ya existe la programación ${duplicada.codProgramacion} (${duplicada.estadoProgramacion}).`);
        const claveArchivo = `${key}:${identidadFila(f)}`;
        if (clavesArchivo.has(claveArchivo)) errores.push(`Duplicado de la fila ${clavesArchivo.get(claveArchivo)} en el Excel.`);
        else clavesArchivo.set(claveArchivo, f.filaExcel);
      }
      return { filaExcel: f.filaExcel, estado: errores.length ? 'BLOQUEADO' : advertencias.length ? 'REVISAR' : 'CORRECTO',
        errores, advertencias, empresa, protocolo, paciente };
    });
    return { ok: true, soloValidacion: true, fechaValidacion: new Date().toISOString(), resultados,
      resumen: { total: resultados.length, correctos: resultados.filter((x) => x.estado === 'CORRECTO').length,
        revisar: resultados.filter((x) => x.estado === 'REVISAR').length,
        bloqueados: resultados.filter((x) => x.estado === 'BLOQUEADO').length } };
};

const validarImportacionProgramaciones = async (req, res) => {
  try {
    return res.json(await analizarFilasImportacion(req.body?.filas));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ ok: false, msg: error.message });
    console.error('Error al validar importación de programaciones:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo completar la validación masiva. No se guardó ningún registro.' });
  }
};

module.exports = { validarImportacionProgramaciones, analizarFilasImportacion };
