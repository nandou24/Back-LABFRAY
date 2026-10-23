const mongoose = require('mongoose');
const SolicitudAtencion = require('../../models/Gestion/SolicitudAtencion');
const ResultadoLaboratorio = require('../../models/Gestion/ResultadoLaboratorio');
const MuestraLaboratorio = require('../../models/Gestion/MuestraLaboratorio');

// ====== Normalizar identidad de un item ======
const normalizarId = (valor) => String(valor?._id ?? valor ?? '').trim();
const normalizarTexto = (valor) => String(valor ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

// ====== Resolver método clínico histórico ======
const obtenerContextoItem = (solicitud, resultado, itemLabId) => {
  const unidad = (solicitud?.unidadesLaboratorio ?? []).find(
    (registro) => registro.claveUnidad === resultado.claveUnidad,
  );
  const grupos = unidad?.snapshotClinico?.gruposResultado ?? [];
  for (const grupo of grupos) {
    for (const item of grupo.items ?? []) {
      if (normalizarId(item.itemLabId) === normalizarId(itemLabId)) {
        return {
          metodo: normalizarTexto(item.snapshotItem?.metodoItemLab),
          contexto: normalizarTexto(item.snapshotItem?.contextoAnalitico),
        };
      }
    }
  }
  return { metodo: '', contexto: '' };
};

// ====== Comparar unidades sin alterar equivalencias clínicas ======
const mismoTipoYUnidad = (actual, anterior) =>
  actual.tipoResultado === anterior.tipoResultado &&
  normalizarTexto(actual.unidadesRef) === normalizarTexto(anterior.unidadesRef);

// ====== Obtener forma clínica de la medición ======
const obtenerFormatoComparable = (valor, tipoResultado) => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (tipoResultado === 'TEXTO' || tipoResultado === 'CATEGORICO') {
    return typeof valor === 'string' ? tipoResultado : null;
  }
  if (tipoResultado === 'NUMERICO') {
    if (typeof valor === 'number') return 'VALOR';
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? String(valor.tipo ?? '').toUpperCase() : null;
  }
  if (tipoResultado === 'ESTRUCTURADO') {
    return valor && typeof valor === 'object' && !Array.isArray(valor) &&
      valor.tipo === 'HALLAZGOS' ? 'HALLAZGOS' : null;
  }
  return null;
};

// ====== Formatear resultados numéricos, cualitativos y estructurados ======
const formatearCuantificacion = (valor) => {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const tipo = String(valor.tipo ?? '').toUpperCase();
  if (tipo === 'RANGO') {
    if (valor.desde === null || valor.desde === undefined || valor.desde === '' ||
        valor.hasta === null || valor.hasta === undefined || valor.hasta === '') return null;
    const desde = Number(valor.desde);
    const hasta = Number(valor.hasta);
    return Number.isFinite(desde) && Number.isFinite(hasta) && desde <= hasta
      ? `${desde} - ${hasta}` : null;
  }
  const operadores = {
    MAYOR_QUE: '>', MAYOR_IGUAL_QUE: '>=',
    MENOR_QUE: '<', MENOR_IGUAL_QUE: '<=',
  };
  if (Object.prototype.hasOwnProperty.call(operadores, tipo)) {
    const numero = Number(valor.valor);
    return Number.isFinite(numero) && valor.valor !== '' && valor.valor != null
      ? `${operadores[tipo]} ${numero}` : null;
  }
  if (['CUALITATIVO', 'CATEGORICO'].includes(tipo)) {
    return typeof valor.valor === 'string' && valor.valor.trim()
      ? valor.valor.trim() : null;
  }
  return null;
};

const obtenerValorComparable = (item) => {
  if (item?.estado !== 'VALIDADO' || item.valor == null) return null;
  const { valor, tipoResultado } = item;
  if (tipoResultado === 'NUMERICO') return formatearCuantificacion(valor);
  if (tipoResultado === 'TEXTO' || tipoResultado === 'CATEGORICO') {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
  }
  if (tipoResultado !== 'ESTRUCTURADO' || typeof valor !== 'object' ||
      Array.isArray(valor) || valor.tipo !== 'HALLAZGOS') return null;
  if (valor.modo === 'AUSENCIA') {
    return typeof valor.valorAusencia === 'string' && valor.valorAusencia.trim()
      ? valor.valorAusencia.trim() : 'NO SE OBSERVAN';
  }
  if (valor.modo !== 'DETALLE' || !Array.isArray(valor.hallazgos) ||
      valor.hallazgos.length === 0 || valor.hallazgos.length > 24) return null;
  const lineas = valor.hallazgos.map((hallazgo) => {
    const nombre = String(hallazgo?.hallazgo ?? '').trim();
    const cantidad = formatearCuantificacion(hallazgo?.valor);
    return nombre && cantidad ? `${nombre}: ${cantidad}` : null;
  });
  return lineas.every(Boolean) ? lineas.join(' / ') : null;
};

// ====== Seleccionar únicamente los intentos vigentes por recipiente ======
const obtenerMuestrasVigentes = (muestras) => {
  const porPlan = new Map();
  for (const muestra of muestras) {
    const clave = `${normalizarId(muestra.solicitudAtencionId)}:${String(muestra.claveMuestraPlan ?? muestra._id)}`;
    const anterior = porPlan.get(clave);
    const intento = Number(muestra.numeroIntento ?? 1);
    const intentoAnterior = Number(anterior?.numeroIntento ?? 0);
    const fecha = new Date(muestra.fechaRegistro ?? muestra.createdAt ?? 0).getTime();
    const fechaAnterior = new Date(anterior?.fechaRegistro ?? anterior?.createdAt ?? 0).getTime();
    if (!anterior || intento > intentoAnterior ||
        (intento === intentoAnterior && fecha > fechaAnterior)) {
      porPlan.set(clave, muestra);
    }
  }
  return [...porPlan.values()].filter((muestra) => muestra.estadoMuestra === 'ACEPTADA');
};

// ====== Fecha operativa de la muestra asociada al item ======
const obtenerFechaMuestraItem = (resultado, itemLabId, muestrasVigentes) => {
  const fechas = new Set();
  for (const muestra of muestrasVigentes) {
    if (normalizarId(muestra.solicitudAtencionId) !== normalizarId(resultado.solicitudAtencionId)) continue;
    const cubreItem = (muestra.coberturas ?? []).some((cobertura) => {
      if (String(cobertura.claveUnidad ?? '') !== String(resultado.claveUnidad ?? '')) return false;
      if (cobertura.alcance !== 'ITEMS_ESPECIFICOS') return true;
      return (cobertura.itemsAsociados ?? []).some((id) => normalizarId(id) === normalizarId(itemLabId));
    });
    if (!cubreItem) continue;
    const fecha = muestra.fechaRecepcion ?? muestra.fechaRegistroRecoleccion ?? muestra.fechaRecoleccion;
    if (fecha && Number.isFinite(new Date(fecha).getTime())) fechas.add(new Date(fecha).toISOString());
  }
  // ====== No atribuir una fecha única a una determinación con varias tomas distintas ======
  return fechas.size === 1 ? [...fechas][0] : null;
};

// ====== Construir histórico clínicamente comparable ======
const construirComparacionHistorica = ({ actual, solicitudActual, solicitudesHistoricas, resultadosHistoricos, muestrasHistoricas = [] }) => {
  const muestrasVigentes = obtenerMuestrasVigentes(muestrasHistoricas);
  const solicitudesPorId = new Map(
    solicitudesHistoricas.map((s) => [normalizarId(s._id), s]),
  );
  const historicosOrdenados = resultadosHistoricos
    .filter((r) => r.estadoResultado === 'LIBERADO' && r.fechaLiberacion)
    .sort((a, b) => new Date(b.fechaLiberacion).getTime() - new Date(a.fechaLiberacion).getTime());

  const items = (actual.resultadosItems ?? []).map((itemActual) => {
    const contextoActual = obtenerContextoItem(solicitudActual, actual, itemActual.itemLabId);
    const anteriores = [];
    if (contextoActual.metodo && ['NUMERICO', 'TEXTO', 'CATEGORICO', 'ESTRUCTURADO'].includes(itemActual.tipoResultado)) {
      for (const resultado of historicosOrdenados) {
        if (anteriores.length >= 3) break;
        const solicitud = solicitudesPorId.get(normalizarId(resultado.solicitudAtencionId));
        if (!solicitud || solicitud.estado === 'ANULADO') continue;
        if (resultado.numeroInstancia !== actual.numeroInstancia) continue;
        if (normalizarTexto(resultado.etiquetaInstancia) !== normalizarTexto(actual.etiquetaInstancia)) continue;
        const item = (resultado.resultadosItems ?? []).find(
          (candidato) => normalizarId(candidato.itemLabId) === normalizarId(itemActual.itemLabId),
        );
        if (!item || !mismoTipoYUnidad(itemActual, item)) continue;
        const formatoActual = obtenerFormatoComparable(itemActual.valor, itemActual.tipoResultado);
        const formatoAnterior = obtenerFormatoComparable(item.valor, item.tipoResultado);
        if (!formatoActual || !formatoAnterior || formatoActual !== formatoAnterior) continue;
        const contextoAnterior = obtenerContextoItem(solicitud, resultado, item.itemLabId);
        if (!contextoAnterior.metodo || contextoAnterior.metodo !== contextoActual.metodo ||
            contextoAnterior.contexto !== contextoActual.contexto) continue;
        const valor = obtenerValorComparable(item);
        if (valor === null) continue;
        anteriores.push({
          fechaLiberacion: resultado.fechaLiberacion,
          fechaMuestra: obtenerFechaMuestraItem(resultado, item.itemLabId, muestrasVigentes),
          codSolicitud: solicitud.codSolicitud,
          valor,
          unidadesRef: item.unidadesRef ?? '',
        });
      }
    }
    return {
      itemLabId: normalizarId(itemActual.itemLabId),
      nombreInforme: itemActual.nombreInforme,
      tipoResultado: itemActual.tipoResultado,
      unidadesRef: itemActual.unidadesRef ?? '',
      valorActual: itemActual.valor ?? null,
      anteriores,
    };
  });
  return {
    ok: true,
    resultadoLaboratorioId: normalizarId(actual._id),
    codPruebaLab: actual.codPruebaLab,
    nombrePruebaLab: actual.nombrePruebaLab,
    totalItemsConHistorial: items.filter((i) => i.anteriores.length > 0).length,
    items,
  };
};

// ====== Consultar histórico por resultado ======
const obtenerComparacionHistoricaResultado = async (req, res) => {
  try {
    const { resultadoLaboratorioId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      return res.status(400).json({ ok: false, msg: 'El identificador del resultado no es válido' });
    }
    const actual = await ResultadoLaboratorio.findById(resultadoLaboratorioId)
      .select('_id solicitudAtencionId claveUnidad pruebaLabId codPruebaLab nombrePruebaLab numeroInstancia etiquetaInstancia resultadosItems estadoResultado')
      .lean();
    if (!actual || actual.estadoResultado === 'ANULADO') {
      return res.status(404).json({ ok: false, msg: 'El resultado no existe o está anulado' });
    }
    const solicitudActual = await SolicitudAtencion.findById(actual.solicitudAtencionId)
      .select('_id tipo estado clienteId fechaEmision unidadesLaboratorio')
      .lean();
    if (!solicitudActual || solicitudActual.tipo !== 'Laboratorio' || solicitudActual.estado === 'ANULADO') {
      return res.status(404).json({ ok: false, msg: 'La solicitud de laboratorio no está disponible' });
    }
    if (!solicitudActual.clienteId) {
      return res.status(200).json(construirComparacionHistorica({
        actual, solicitudActual, solicitudesHistoricas: [], resultadosHistoricos: [],
      }));
    }

    // ====== Usar identidad maestra, nunca nombre ni documento ======
    const solicitudesHistoricas = await SolicitudAtencion.find({
      _id: { $ne: solicitudActual._id },
      clienteId: solicitudActual.clienteId,
      tipo: 'Laboratorio',
      estado: { $ne: 'ANULADO' },
      fechaEmision: { $lt: solicitudActual.fechaEmision },
    })
      .select('_id codSolicitud estado fechaEmision unidadesLaboratorio')
      .sort({ fechaEmision: -1 })
      .limit(100)
      .lean();

    const resultadosHistoricos = solicitudesHistoricas.length
      ? await ResultadoLaboratorio.find({
        solicitudAtencionId: { $in: solicitudesHistoricas.map((s) => s._id) },
        pruebaLabId: actual.pruebaLabId,
        numeroInstancia: actual.numeroInstancia,
        estadoResultado: 'LIBERADO',
        fechaLiberacion: { $ne: null },
      })
        .select('solicitudAtencionId claveUnidad pruebaLabId numeroInstancia etiquetaInstancia estadoResultado fechaLiberacion resultadosItems')
        .sort({ fechaLiberacion: -1 })
        .limit(100)
        .lean()
      : [];

    // ====== Consultar los intentos físicos de las solicitudes históricas ======
    const muestrasHistoricas = resultadosHistoricos.length
      ? await MuestraLaboratorio.find({
        solicitudAtencionId: { $in: [...new Set(resultadosHistoricos.map((r) => normalizarId(r.solicitudAtencionId)))] },
      })
        .select('solicitudAtencionId claveMuestraPlan numeroIntento estadoMuestra fechaRegistro createdAt fechaRecoleccion fechaRegistroRecoleccion fechaRecepcion coberturas.claveUnidad coberturas.alcance coberturas.itemsAsociados')
        .lean()
      : [];

    return res.status(200).json(construirComparacionHistorica({
      actual, solicitudActual, solicitudesHistoricas, resultadosHistoricos, muestrasHistoricas,
    }));
  } catch (error) {
    console.error('Error al consultar comparación histórica de resultados:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo consultar el histórico de resultados' });
  }
};

module.exports = {
  obtenerComparacionHistoricaResultado,
  construirComparacionHistorica,
};
