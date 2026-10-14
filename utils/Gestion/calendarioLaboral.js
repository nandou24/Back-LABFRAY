const OFFSET_HORARIO_PERU = "-05:00";

// ====== Obtener fecha calendario Perú ======

const obtenerClaveFechaPeru = (fecha) => {
  const base = fecha instanceof Date ? fecha : new Date(fecha);

  if (!Number.isFinite(base.getTime())) {
    return null;
  }

  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);

  const valores = Object.fromEntries(
    partes
      .filter((parte) => ["year", "month", "day"].includes(parte.type))
      .map((parte) => [parte.type, parte.value]),
  );

  if (!valores.year || !valores.month || !valores.day) {
    return null;
  }

  return `${valores.year}-${valores.month}-${valores.day}`;
};

// ====== Construir fin de día Perú ======

const construirFinDiaPeru = (claveFecha) => {
  const fecha = new Date(`${claveFecha}T23:59:59.999${OFFSET_HORARIO_PERU}`);

  return Number.isFinite(fecha.getTime()) ? fecha : null;
};

// ====== Normalizar días no laborables ======

const construirMapaDiasNoLaborables = (diasNoLaborables) => {
  if (diasNoLaborables instanceof Map) {
    return diasNoLaborables;
  }

  const mapa = new Map();

  if (diasNoLaborables instanceof Set) {
    for (const fecha of diasNoLaborables) {
      const clave = String(fecha ?? "").trim();

      if (clave) {
        mapa.set(clave, {
          fecha: clave,
          descripcion: "",
          tipo: null,
        });
      }
    }

    return mapa;
  }

  for (const dia of Array.isArray(diasNoLaborables) ? diasNoLaborables : []) {
    if (typeof dia === "string") {
      const clave = dia.trim();

      if (clave) {
        mapa.set(clave, {
          fecha: clave,
          descripcion: "",
          tipo: null,
        });
      }

      continue;
    }

    const clave = String(dia?.fecha ?? "").trim();

    if (!clave) {
      continue;
    }

    mapa.set(clave, {
      fecha: clave,
      descripcion: String(dia?.descripcion ?? "").trim(),
      tipo: dia?.tipo ?? null,
    });
  }

  return mapa;
};

// ====== Calcular compromiso con trazabilidad ======

const calcularCompromisoDetallado = (
  fecha,
  dias,
  tipoDias,
  diasNoLaborables = [],
) => {
  const base = fecha ? new Date(fecha) : null;
  const cantidad = Number(dias);

  if (
    !base ||
    !Number.isFinite(base.getTime()) ||
    !Number.isFinite(cantidad) ||
    cantidad < 0
  ) {
    return null;
  }

  const claveBase = obtenerClaveFechaPeru(base);

  if (!claveBase) {
    return null;
  }

  const [anio, mes, dia] = claveBase.split("-").map(Number);
  const cursor = new Date(Date.UTC(anio, mes - 1, dia));
  const noLaborables = construirMapaDiasNoLaborables(diasNoLaborables);
  const aplicados = new Map();
  let restantes = Math.ceil(cantidad);

  while (restantes > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);

    const claveCursor = [
      cursor.getUTCFullYear(),
      String(cursor.getUTCMonth() + 1).padStart(2, "0"),
      String(cursor.getUTCDate()).padStart(2, "0"),
    ].join("-");

    // ====== Feriados / cierres no cuentan en ningún calendario ======

    if (noLaborables.has(claveCursor)) {
      const detalle = noLaborables.get(claveCursor);

      aplicados.set(claveCursor, {
        fecha: claveCursor,
        descripcion: String(detalle?.descripcion ?? "").trim(),
        tipo: detalle?.tipo ?? null,
      });

      continue;
    }

    const diaSemana = cursor.getUTCDay();

    // ====== Lunes a viernes ======

    if (
      tipoDias === "HABILES" &&
      (diaSemana === 0 || diaSemana === 6)
    ) {
      continue;
    }

    // ====== Lunes a sábado ======

    if (tipoDias === "LABORABLES_LS" && diaSemana === 0) {
      continue;
    }

    // CALENDARIO cuenta cualquier día que no sea no laborable.
    restantes -= 1;
  }

  const claveVencimiento = [
    cursor.getUTCFullYear(),
    String(cursor.getUTCMonth() + 1).padStart(2, "0"),
    String(cursor.getUTCDate()).padStart(2, "0"),
  ].join("-");

  const fechaEntregaComprometida = construirFinDiaPeru(claveVencimiento);

  if (!fechaEntregaComprometida) {
    return null;
  }

  return {
    fechaEntregaComprometida,
    claveFechaEntrega: claveVencimiento,
    diasNoLaborablesAplicados: [...aplicados.values()],
  };
};

// ====== Compatibilidad cálculo simple ======

const sumarDiasCompromiso = (
  fecha,
  dias,
  tipoDias,
  diasNoLaborables = [],
) =>
  calcularCompromisoDetallado(
    fecha,
    dias,
    tipoDias,
    diasNoLaborables,
  )?.fechaEntregaComprometida ?? null;

module.exports = {
  obtenerClaveFechaPeru,
  sumarDiasCompromiso,
  calcularCompromisoDetallado,
};
