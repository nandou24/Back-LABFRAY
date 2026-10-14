const {
  calcularCompromisoDetallado,
} = require("./calendarioLaboral");

// ====== Estados con toma válida ======

const ESTADOS_TOMA_VALIDA = new Set([
  "RECOLECTADA",
  "RECEPCIONADA",
  "ACEPTADA",
]);

// ====== Claves de unidad cubiertas ======

const obtenerClavesUnidadMuestra = (muestra) =>
  new Set(
    (Array.isArray(muestra?.coberturas) ? muestra.coberturas : [])
      .map((cobertura) => String(cobertura?.claveUnidad ?? "").trim())
      .filter(Boolean),
  );

// ====== Orden de intentos ======

const compararIntentos = (a, b) => {
  const intentoA = Number(a?.numeroIntento ?? 1);
  const intentoB = Number(b?.numeroIntento ?? 1);

  if (intentoA !== intentoB) {
    return intentoA - intentoB;
  }

  const fechaA = new Date(a?.createdAt ?? a?.fechaRegistro ?? 0).getTime();
  const fechaB = new Date(b?.createdAt ?? b?.fechaRegistro ?? 0).getTime();

  return fechaA - fechaB;
};

// ====== Último intento por recipiente ======

const obtenerUltimosIntentosPorPlan = (muestras = []) => {
  const porPlan = new Map();

  for (const muestra of Array.isArray(muestras) ? muestras : []) {
    const clavePlan = String(
      muestra?.claveMuestraPlan ?? muestra?._id ?? "",
    ).trim();

    if (!clavePlan) {
      continue;
    }

    const actual = porPlan.get(clavePlan);

    if (!actual || compararIntentos(actual, muestra) < 0) {
      porPlan.set(clavePlan, muestra);
    }
  }

  return porPlan;
};

// ====== Fecha base de una unidad ======

const obtenerFechaBaseTomaUnidad = (unidad, muestras = []) => {
  if (unidad?.snapshotClinico?.requiereMuestra === false) {
    return null;
  }

  const claveUnidad = String(unidad?.claveUnidad ?? "").trim();

  if (!claveUnidad) {
    return null;
  }

  const relacionadas = (Array.isArray(muestras) ? muestras : []).filter(
    (muestra) => obtenerClavesUnidadMuestra(muestra).has(claveUnidad),
  );

  if (relacionadas.length === 0) {
    return null;
  }

  const ultimosPorPlan = obtenerUltimosIntentosPorPlan(relacionadas);

  if (ultimosPorPlan.size === 0) {
    return null;
  }

  const fechas = [];

  for (const intento of ultimosPorPlan.values()) {
    if (!ESTADOS_TOMA_VALIDA.has(intento?.estadoMuestra)) {
      return null;
    }

    const fecha = intento?.fechaRecoleccion
      ? new Date(intento.fechaRecoleccion)
      : null;

    if (!fecha || !Number.isFinite(fecha.getTime())) {
      return null;
    }

    fechas.push(fecha);
  }

  // El plazo inicia cuando se completa el último recipiente requerido.
  return fechas.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
};

// ====== Días no laborables activos ======

const obtenerDiasNoLaborablesActivos = async (session = null) => {
  const DiaNoLaborable = require("../../models/Mantenimiento/DiaNoLaborable");

  let consulta = DiaNoLaborable.find({
    estadoDiaNoLaborable: "ACTIVO",
  })
    .select("fecha descripcion tipo")
    .sort({ fecha: 1 });

  if (session) {
    consulta = consulta.session(session);
  }

  return consulta.lean();
};

// ====== Archivar cálculo vigente ======

const archivarCalculoVigente = ({
  plazo,
  motivo,
  uid,
  nombreUsuario,
  ahora,
}) => {
  if (!plazo?.fechaEntregaComprometida && !plazo?.fechaInicioCompromiso) {
    return false;
  }

  if (!Array.isArray(plazo.historialCalculos)) {
    plazo.historialCalculos = [];
  }

  plazo.historialCalculos.push({
    fechaInicioCompromiso: plazo.fechaInicioCompromiso ?? null,
    fechaEntregaComprometida: plazo.fechaEntregaComprometida ?? null,
    diasNoLaborablesAplicados: Array.isArray(plazo.diasNoLaborablesAplicados)
      ? plazo.diasNoLaborablesAplicados.map((dia) => ({
          fecha: dia?.fecha ?? null,
          descripcion: dia?.descripcion ?? "",
          tipo: dia?.tipo ?? null,
        }))
      : [],
    fechaCalculoCompromiso: plazo.fechaCalculoCompromiso ?? null,
    fechaCierre: ahora,
    motivoCierre: String(motivo ?? "CAMBIO_MUESTRA").trim(),
    cerradoPor: uid ?? null,
    usuarioCierre: nombreUsuario ?? null,
  });

  plazo.fechaInicioCompromiso = null;
  plazo.fechaEntregaComprometida = null;
  plazo.diasNoLaborablesAplicados = [];
  plazo.fechaCalculoCompromiso = null;

  return true;
};

// ====== Congelar cálculo vigente ======

const congelarCalculo = ({ plazo, fechaBase, diasNoLaborables, ahora }) => {
  const calculo = calcularCompromisoDetallado(
    fechaBase,
    plazo.cantidadDias,
    plazo.tipoDias,
    diasNoLaborables,
  );

  if (!calculo?.fechaEntregaComprometida) {
    return false;
  }

  plazo.fechaInicioCompromiso = fechaBase;
  plazo.fechaEntregaComprometida = calculo.fechaEntregaComprometida;
  plazo.diasNoLaborablesAplicados = calculo.diasNoLaborablesAplicados;
  plazo.fechaCalculoCompromiso = ahora;

  return true;
};

// ====== Sincronizar compromisos de una solicitud ======

const sincronizarCompromisosSolicitud = async ({
  solicitudAtencionId,
  session = null,
  uid = null,
  nombreUsuario = null,
  motivoInvalidacion = "CAMBIO_MUESTRA",
}) => {
  const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
  const MuestraLaboratorio = require("../../models/Gestion/MuestraLaboratorio");

  let consultaSolicitud = SolicitudAtencion.findById(solicitudAtencionId);

  if (session) {
    consultaSolicitud = consultaSolicitud.session(session);
  }

  const solicitud = await consultaSolicitud;

  if (!solicitud || solicitud.tipo !== "Laboratorio") {
    return {
      modificada: false,
      congelados: 0,
      invalidados: 0,
      sinCambios: 0,
    };
  }

  let consultaMuestras = MuestraLaboratorio.find({
    solicitudAtencionId: solicitud._id,
  }).select(
    "_id claveMuestraPlan numeroIntento estadoMuestra coberturas.claveUnidad fechaRecoleccion fechaRegistro createdAt",
  );

  if (session) {
    consultaMuestras = consultaMuestras.session(session);
  }

  const [muestras, diasNoLaborables] = await Promise.all([
    consultaMuestras.lean(),
    obtenerDiasNoLaborablesActivos(session),
  ]);

  const ahora = new Date();
  let modificada = false;
  let congelados = 0;
  let invalidados = 0;
  let sinCambios = 0;

  for (const unidad of solicitud.unidadesLaboratorio ?? []) {
    if (unidad?.estado === "ANULADO" || !unidad?.plazoComprometido) {
      continue;
    }

    const plazo = unidad.plazoComprometido;

    const fechaBase =
      unidad?.snapshotClinico?.requiereMuestra === false
        ? solicitud.fechaAtencionArea ?? solicitud.fechaEmision ?? null
        : obtenerFechaBaseTomaUnidad(unidad, muestras);

    const fechaBaseValida = fechaBase ? new Date(fechaBase) : null;

    const tieneBase =
      fechaBaseValida && Number.isFinite(fechaBaseValida.getTime());

    const fechaCongelada = plazo.fechaEntregaComprometida
      ? new Date(plazo.fechaEntregaComprometida)
      : null;

    const tieneCongelado =
      fechaCongelada && Number.isFinite(fechaCongelada.getTime());

    // ====== Ya no existe toma completa válida ======

    if (!tieneBase) {
      if (
        archivarCalculoVigente({
          plazo,
          motivo: motivoInvalidacion,
          uid,
          nombreUsuario,
          ahora,
        })
      ) {
        modificada = true;
        invalidados += 1;
      } else {
        sinCambios += 1;
      }

      continue;
    }

    // ====== El compromiso sigue congelado y la base no cambió ======

    if (tieneCongelado && plazo.fechaInicioCompromiso) {
      const inicioCongelado = new Date(plazo.fechaInicioCompromiso);

      if (
        Number.isFinite(inicioCongelado.getTime()) &&
        inicioCongelado.getTime() === fechaBaseValida.getTime()
      ) {
        sinCambios += 1;
        continue;
      }

      // La fecha base cambió por un nuevo intento; preservar el cálculo anterior.
      if (
        archivarCalculoVigente({
          plazo,
          motivo: motivoInvalidacion || "CAMBIO_FECHA_BASE",
          uid,
          nombreUsuario,
          ahora,
        })
      ) {
        modificada = true;
        invalidados += 1;
      }
    }

    // ====== Congelar nuevo compromiso ======

    if (
      congelarCalculo({
        plazo,
        fechaBase: fechaBaseValida,
        diasNoLaborables,
        ahora,
      })
    ) {
      modificada = true;
      congelados += 1;
    }
  }

  if (modificada) {
    solicitud.updatedBy = uid ?? solicitud.updatedBy;
    solicitud.usuarioActualizacion =
      nombreUsuario ?? solicitud.usuarioActualizacion;
    solicitud.fechaActualizacion = ahora;

    await solicitud.save({
      ...(session ? { session } : {}),
    });
  }

  return {
    modificada,
    congelados,
    invalidados,
    sinCambios,
  };
};

module.exports = {
  obtenerFechaBaseTomaUnidad,
  sincronizarCompromisosSolicitud,
};
