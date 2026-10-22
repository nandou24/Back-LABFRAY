const crypto = require('crypto');

// ====== Normalizar selección sin duplicados ======
const normalizarSeleccionInforme = (seleccion, validarId) => {
  if (!Array.isArray(seleccion) || seleccion.length < 1 || seleccion.length > 100) return null;
  if (typeof validarId !== 'function') return null;

  const resultados = [];
  const vistos = new Set();
  for (const item of seleccion) {
    const id = String(item?._id ?? '').trim();
    const version = item?.versionResultado;
    if (!validarId(id) || typeof version !== 'number' ||
        !Number.isSafeInteger(version) || version < 1 || vistos.has(id)) {
      return null;
    }
    vistos.add(id);
    resultados.push({ id, version });
  }
  return resultados;
};

// ====== Serialización estable de los campos relevantes ======
const normalizarValorHash = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'number' || typeof valor === 'boolean' || typeof valor === 'string') return valor;
  if (Array.isArray(valor)) return valor.map(normalizarValorHash);
  if (typeof valor?.toHexString === 'function') return valor.toHexString();
  if (typeof valor?.toObject === 'function') return normalizarValorHash(valor.toObject());
  if (typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort()
      .filter((clave) => clave !== '_id' && clave !== '__v')
      .map((clave) => [clave, normalizarValorHash(valor[clave])]));
  }
  return String(valor);
};

const hashJson = (valor) => crypto.createHash('sha256')
  .update(JSON.stringify(normalizarValorHash(valor)), 'utf8').digest('hex');

// ====== Huella clínica independiente del PDF ======
const hashContenidoResultado = (resultado) => hashJson({
  resultadoLaboratorioId: String(resultado._id),
  codPruebaLab: resultado.codPruebaLab,
  nombrePruebaLab: resultado.nombrePruebaLab,
  versionResultado: resultado.versionResultado,
  fechaLiberacion: resultado.fechaLiberacion,
  observacionGeneral: resultado.observacionGeneral,
  resultadosItems: (resultado.resultadosItems ?? []).map((item) => ({
    claveItemResultado: item.claveItemResultado,
    codItemLab: item.codItemLab,
    nombreInforme: item.nombreInforme,
    valor: item.valor,
    unidadesRef: item.unidadesRef,
    observacion: item.observacion,
    evaluacionReferencia: item.evaluacionReferencia,
    mostrarReferenciaInforme: item.mostrarReferenciaInforme,
  })),
  responsableInforme: resultado.responsableInforme ? {
    recursoHumanoId: resultado.responsableInforme.recursoHumanoId,
    firmaArchivoId: resultado.responsableInforme.firmaArchivoId,
    hashFirma: resultado.responsableInforme.hashFirma,
    perfilId: resultado.responsableInforme.perfilId,
    tratamiento: resultado.responsableInforme.tratamiento,
    profesion: resultado.responsableInforme.profesion,
    especialidad: resultado.responsableInforme.especialidad,
    nroColegiatura: resultado.responsableInforme.nroColegiatura,
    rne: resultado.responsableInforme.rne,
  } : null,
});

const hashTokenVerificacion = (token) => crypto.createHash('sha256').update(token).digest('hex');

const hashConjunto = (resultados) => hashJson([...resultados]
  .sort((a, b) => String(a.resultadoLaboratorioId).localeCompare(String(b.resultadoLaboratorioId)))
  .map((item) => ({ id: String(item.resultadoLaboratorioId),
    versionResultado: item.versionResultado, hashContenido: item.hashContenido })));

module.exports = {
  normalizarSeleccionInforme,
  hashContenidoResultado,
  hashTokenVerificacion,
  hashConjunto,
};
