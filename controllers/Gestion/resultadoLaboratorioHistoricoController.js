const mongoose = require('mongoose');
const SolicitudAtencion = require('../../models/Gestion/SolicitudAtencion');
const ResultadoLaboratorio = require('../../models/Gestion/ResultadoLaboratorio');

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

// ====== Admitir solo valores escalares comparables ======
const obtenerValorComparable = (item) => {
  if (item?.estado !== 'VALIDADO' || item.valor == null) return null;
  if (item.tipoResultado === 'NUMERICO') {
    return typeof item.valor === 'number' && Number.isFinite(item.valor)
      ? item.valor : null;
  }
  if (item.tipoResultado === 'TEXTO' || item.tipoResultado === 'CATEGORICO') {
    return typeof item.valor === 'string' && item.valor.trim()
      ? item.valor.trim() : null;
  }
  return null;
};

// ====== Construir histórico clínicamente comparable ======
const construirComparacionHistorica = ({ actual, solicitudActual, solicitudesHistoricas, resultadosHistoricos }) => {
  const solicitudesPorId = new Map(
    solicitudesHistoricas.map((s) => [normalizarId(s._id), s]),
  );
  const historicosOrdenados = resultadosHistoricos
    .filter((r) => r.estadoResultado === 'LIBERADO' && r.fechaLiberacion)
    .sort((a, b) => new Date(b.fechaLiberacion).getTime() - new Date(a.fechaLiberacion).getTime());

  const items = (actual.resultadosItems ?? []).map((itemActual) => {
    const contextoActual = obtenerContextoItem(solicitudActual, actual, itemActual.itemLabId);
    const anteriores = [];
    if (contextoActual.metodo && ['NUMERICO', 'TEXTO', 'CATEGORICO'].includes(itemActual.tipoResultado)) {
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
        const contextoAnterior = obtenerContextoItem(solicitud, resultado, item.itemLabId);
        if (!contextoAnterior.metodo || contextoAnterior.metodo !== contextoActual.metodo ||
            contextoAnterior.contexto !== contextoActual.contexto) continue;
        const valor = obtenerValorComparable(item);
        if (valor === null) continue;
        anteriores.push({
          fechaLiberacion: resultado.fechaLiberacion,
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

    return res.status(200).json(construirComparacionHistorica({
      actual, solicitudActual, solicitudesHistoricas, resultadosHistoricos,
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
