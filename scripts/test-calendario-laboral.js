const assert = require("node:assert/strict");

const {
  obtenerClaveFechaPeru,
  sumarDiasCompromiso,
  calcularCompromisoDetallado,
} = require("../utils/Gestion/calendarioLaboral");

const base = new Date("2026-10-14T10:00:00-05:00");

const comprobar = ({ nombre, dias, tipoDias, noLaborables = [], esperado }) => {
  const fecha = sumarDiasCompromiso(base, dias, tipoDias, noLaborables);
  const obtenido = obtenerClaveFechaPeru(fecha);

  assert.equal(obtenido, esperado, `${nombre}: ${obtenido} !== ${esperado}`);
  console.log(`OK  ${nombre}: ${obtenido}`);
};

comprobar({
  nombre: "0 días - mismo día",
  dias: 0,
  tipoDias: "LABORABLES_LS",
  esperado: "2026-10-14",
});

comprobar({
  nombre: "4 días hábiles L-V",
  dias: 4,
  tipoDias: "HABILES",
  esperado: "2026-10-20",
});

comprobar({
  nombre: "4 días laborables L-S",
  dias: 4,
  tipoDias: "LABORABLES_LS",
  esperado: "2026-10-19",
});

comprobar({
  nombre: "4 días calendario",
  dias: 4,
  tipoDias: "CALENDARIO",
  esperado: "2026-10-18",
});

comprobar({
  nombre: "L-V excluye 16 y 17",
  dias: 4,
  tipoDias: "HABILES",
  noLaborables: ["2026-10-16", "2026-10-17"],
  esperado: "2026-10-21",
});

comprobar({
  nombre: "L-S excluye 16 y 17",
  dias: 4,
  tipoDias: "LABORABLES_LS",
  noLaborables: ["2026-10-16", "2026-10-17"],
  esperado: "2026-10-21",
});

comprobar({
  nombre: "Calendario excluye 16 y 17",
  dias: 4,
  tipoDias: "CALENDARIO",
  noLaborables: ["2026-10-16", "2026-10-17"],
  esperado: "2026-10-20",
});

// ====== Snapshot de días aplicados ======

const detallado = calcularCompromisoDetallado(base, 4, "CALENDARIO", [
  {
    fecha: "2026-10-16",
    descripcion: "PRE-aniversario",
    tipo: "CIERRE_INSTITUCIONAL",
  },
  {
    fecha: "2026-10-17",
    descripcion: "Por aniversario",
    tipo: "OTRO",
  },
]);

assert.equal(
  obtenerClaveFechaPeru(detallado.fechaEntregaComprometida),
  "2026-10-20",
);
assert.deepEqual(
  detallado.diasNoLaborablesAplicados.map((dia) => dia.fecha),
  ["2026-10-16", "2026-10-17"],
);

console.log("OK  snapshot de días no laborables aplicados");

// ====== Reintento después de anulación ======

const {
  obtenerFechaBaseTomaUnidad,
} = require("../utils/Gestion/compromisoEntregaLaboratorio");

const unidad = {
  claveUnidad: "UNIDAD-1",
  snapshotClinico: { requiereMuestra: true },
};

const cobertura = [{ claveUnidad: "UNIDAD-1" }];

const fechaOriginal = obtenerFechaBaseTomaUnidad(unidad, [
  {
    _id: "A1",
    claveMuestraPlan: "PLAN-1",
    numeroIntento: 1,
    estadoMuestra: "RECOLECTADA",
    fechaRecoleccion: new Date("2026-10-14T10:00:00-05:00"),
    coberturas: cobertura,
  },
]);

assert.equal(obtenerClaveFechaPeru(fechaOriginal), "2026-10-14");

const trasAnulacion = obtenerFechaBaseTomaUnidad(unidad, [
  {
    _id: "A1",
    claveMuestraPlan: "PLAN-1",
    numeroIntento: 1,
    estadoMuestra: "ANULADA",
    fechaRecoleccion: new Date("2026-10-14T10:00:00-05:00"),
    coberturas: cobertura,
  },
]);

assert.equal(trasAnulacion, null);

const conReintentoPendiente = obtenerFechaBaseTomaUnidad(unidad, [
  {
    _id: "A1",
    claveMuestraPlan: "PLAN-1",
    numeroIntento: 1,
    estadoMuestra: "ANULADA",
    fechaRecoleccion: new Date("2026-10-14T10:00:00-05:00"),
    coberturas: cobertura,
  },
  {
    _id: "A2",
    claveMuestraPlan: "PLAN-1",
    numeroIntento: 2,
    estadoMuestra: "PENDIENTE",
    fechaRecoleccion: null,
    coberturas: cobertura,
  },
]);

assert.equal(conReintentoPendiente, null);

const fechaReintento = obtenerFechaBaseTomaUnidad(unidad, [
  {
    _id: "A1",
    claveMuestraPlan: "PLAN-1",
    numeroIntento: 1,
    estadoMuestra: "ANULADA",
    fechaRecoleccion: new Date("2026-10-14T10:00:00-05:00"),
    coberturas: cobertura,
  },
  {
    _id: "A2",
    claveMuestraPlan: "PLAN-1",
    numeroIntento: 2,
    estadoMuestra: "RECOLECTADA",
    fechaRecoleccion: new Date("2026-10-20T09:30:00-05:00"),
    coberturas: cobertura,
  },
]);

assert.equal(obtenerClaveFechaPeru(fechaReintento), "2026-10-20");
console.log("OK  anulación y reintento usan la nueva toma como fecha base");

console.log("\nCalendario laboral: todas las pruebas pasaron.");
