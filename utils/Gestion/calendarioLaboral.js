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

const normalizarDiasNoLaborables = (diasNoLaborables) => {
  if (diasNoLaborables instanceof Set) {
    return diasNoLaborables;
  }

  return new Set(
    (Array.isArray(diasNoLaborables) ? diasNoLaborables : [])
      .map((valor) => String(valor ?? "").trim())
      .filter(Boolean),
  );
};

// ====== Sumar plazo comprometido ======

const sumarDiasCompromiso = (
  fecha,
  dias,
  tipoDias,
  diasNoLaborables = new Set(),
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
  const noLaborables = normalizarDiasNoLaborables(diasNoLaborables);
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

  return construirFinDiaPeru(claveVencimiento);
};

module.exports = {
  obtenerClaveFechaPeru,
  sumarDiasCompromiso,
};
