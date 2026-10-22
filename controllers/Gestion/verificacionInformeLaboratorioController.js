const crypto = require('crypto');
const mongoose = require('mongoose');
const { response } = require('express');
const SolicitudAtencion = require('../../models/Gestion/SolicitudAtencion');
const ResultadoLaboratorio = require('../../models/Gestion/ResultadoLaboratorio');
const InformeVerificacionLaboratorio = require('../../models/Gestion/InformeVerificacionLaboratorio');
const { validarIdentidadesParaLiberar } = require('../../utils/Gestion/validarIdentidadLiberacion');

const {
  normalizarSeleccionInforme,
  hashContenidoResultado,
  hashTokenVerificacion,
  hashConjunto,
} = require('../../utils/Gestion/verificacionInformeLaboratorio');

// ====== Campos clínicos necesarios para verificar una emisión ======
const CAMPOS_RESULTADO = [
  '_id', 'solicitudAtencionId', 'estadoResultado', 'codPruebaLab',
  'nombrePruebaLab', 'versionResultado', 'fechaLiberacion',
  'observacionGeneral', 'resultadosItems', 'responsableInforme',
].join(' ');

// ====== Registrar informe verificable (uso autenticado) ======
const registrarInformeVerificable = async (req, res = response) => {
  try {
    const solicitudAtencionId = String(req.params.solicitudAtencionId ?? '').trim();
    const seleccion = normalizarSeleccionInforme(req.body?.resultados, mongoose.isValidObjectId);
    if (!mongoose.isValidObjectId(solicitudAtencionId) || !seleccion) {
      return res.status(400).json({ ok: false, msg: 'Selección de pruebas inválida' });
    }

    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .select('tipo estado codSolicitud codigoLaboratorio unidadesLaboratorio.estado hc clienteId tipoDoc nroDoc').lean();
    if (!solicitud || solicitud.tipo !== 'Laboratorio' || solicitud.estado === 'ANULADO') {
      return res.status(409).json({ ok: false, msg: 'Solicitud de laboratorio no disponible' });
    }

    // ====== No emitir verificaciones de identidad pendiente ======
    await validarIdentidadesParaLiberar([solicitud]);

    const ids = seleccion.map((item) => item.id);
    const actuales = await ResultadoLaboratorio.find({
      _id: { $in: ids }, solicitudAtencionId, estadoResultado: 'LIBERADO',
    }).select(CAMPOS_RESULTADO).lean();
    if (actuales.length !== ids.length) {
      return res.status(409).json({ ok: false,
        msg: 'Alguna prueba ya no está liberada; actualice el informe' });
    }

    const versiones = new Map(seleccion.map((item) => [item.id, item.version]));
    if (actuales.some((resultado) =>
      Number(resultado.versionResultado) !== versiones.get(String(resultado._id)))) {
      return res.status(409).json({ ok: false,
        msg: 'Los resultados cambiaron; actualice el informe antes de registrarlo' });
    }

    const resultados = actuales.map((resultado) => ({
      resultadoLaboratorioId: resultado._id,
      versionResultado: resultado.versionResultado,
      codPruebaLab: resultado.codPruebaLab,
      hashContenido: hashContenidoResultado(resultado),
    }));
    const totalActivas = (solicitud.unidadesLaboratorio ?? [])
      .filter((unidad) => unidad.estado !== 'ANULADO').length;
    const tipoInforme = totalActivas > 0 && resultados.length === totalActivas
      ? 'FINAL' : 'PARCIAL';

    // ====== Token aleatorio: solo su hash se almacena ======
    const token = crypto.randomBytes(32).toString('hex');
    const codigoInforme = `INF-${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
    const documento = await InformeVerificacionLaboratorio.create({
      codigoInforme,
      tokenHash: hashTokenVerificacion(token),
      solicitudAtencionId: solicitud._id,
      codSolicitud: solicitud.codSolicitud,
      codigoLaboratorio: solicitud.codigoLaboratorio ?? '',
      tipoInforme,
      resultados,
      hashContenidoConjunto: hashConjunto(resultados),
      registradoPor: String(req.user?.uid ?? ''),
      usuarioRegistro: req.user?.nombreUsuario ?? null,
    });

    return res.set('Cache-Control', 'private, no-store').status(201).json({
      ok: true,
      codigoInforme: documento.codigoInforme,
      tokenVerificacion: token,
      tipoInforme,
      cantidadPruebas: resultados.length,
      fechaRegistro: documento.fechaRegistro,
      aviso: 'Registro verificable creado. La integridad del PDF se implementará en 12.2D.',
    });
  } catch (error) {
    console.error('Error registrando informe verificable:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo registrar el informe verificable' });
  }
};

// ====== Consultar autenticidad sin datos clínicos ======
const verificarInformePublico = async (req, res = response) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  try {
    const token = String(req.params.token ?? '').trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(404).json({ ok: false, msg: 'Informe no encontrado' });
    }

    const registro = await InformeVerificacionLaboratorio.findOne({
      tokenHash: hashTokenVerificacion(token.toLowerCase()),
    }).select('+tokenHash').lean();
    if (!registro) {
      return res.status(404).json({ ok: false, msg: 'Informe no encontrado' });
    }

    let estado = 'VIGENTE';
    if (registro.estadoRegistro === 'REVOCADO') {
      estado = 'REVOCADO';
    } else {
      const solicitud = await SolicitudAtencion.findById(registro.solicitudAtencionId)
        .select('tipo estado').lean();
      if (!solicitud || solicitud.tipo !== 'Laboratorio' || solicitud.estado === 'ANULADO') {
        estado = 'ANULADO';
      } else {
        const ids = registro.resultados.map((item) => item.resultadoLaboratorioId);
        const actuales = await ResultadoLaboratorio.find({
          _id: { $in: ids }, solicitudAtencionId: registro.solicitudAtencionId,
        }).select(CAMPOS_RESULTADO).lean();
        const porId = new Map(actuales.map((item) => [String(item._id), item]));
        const anulados = registro.resultados.some((original) =>
          porId.get(String(original.resultadoLaboratorioId))?.estadoResultado === 'ANULADO');
        const cambiados = registro.resultados.some((original) => {
          const actual = porId.get(String(original.resultadoLaboratorioId));
          return !actual || actual.estadoResultado !== 'LIBERADO' ||
            Number(actual.versionResultado) !== original.versionResultado ||
            hashContenidoResultado(actual) !== original.hashContenido;
        });
        if (anulados) estado = 'ANULADO';
        else if (cambiados) estado = 'REEMPLAZADO';
      }
    }

    return res.json({
      ok: true,
      codigoInforme: registro.codigoInforme,
      estado,
      vigente: estado === 'VIGENTE',
      codSolicitud: registro.codSolicitud,
      codigoLaboratorio: registro.codigoLaboratorio,
      tipoInforme: registro.tipoInforme,
      cantidadPruebas: registro.resultados.length,
      fechaRegistro: registro.fechaRegistro,
      integridadPdfVerificada: false,
    });
  } catch (error) {
    console.error('Error verificando informe:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo verificar el informe' });
  }
};

module.exports = { registrarInformeVerificable, verificarInformePublico };
