const assert = require("node:assert/strict");

const {
  obtenerClaveFechaPeru,
  sumarDiasCompromiso,
} = require("../utils/Gestion/calendarioLaboral");

const base = new Date("2026-10-14T10:00:00-05:00");

const comprobar = ({ nombre, dias, tipoDias, noLaborables = [], esperado }) => {
  const fecha = sumarDiasCompromiso(
    base,
    dias,
    tipoDias,
    new Set(noLaborables),
  );

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
  nombre: "L-V excluye feriado viernes 16",
  dias: 4,
  tipoDias: "HABILES",
  noLaborables: ["2026-10-16"],
  esperado: "2026-10-21",
});

comprobar({
  nombre: "L-S excluye feriado sábado 17",
  dias: 4,
  tipoDias: "LABORABLES_LS",
  noLaborables: ["2026-10-17"],
  esperado: "2026-10-20",
});

comprobar({
  nombre: "Calendario excluye feriado sábado 17",
  dias: 4,
  tipoDias: "CALENDARIO",
  noLaborables: ["2026-10-17"],
  esperado: "2026-10-19",
});

comprobar({
  nombre: "Dos no laborables consecutivos",
  dias: 2,
  tipoDias: "CALENDARIO",
  noLaborables: ["2026-10-15", "2026-10-16"],
  esperado: "2026-10-18",
});

console.log("\nCalendario laboral: todas las pruebas pasaron.");
