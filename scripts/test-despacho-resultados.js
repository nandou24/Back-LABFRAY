const assert = require("node:assert/strict");
const {
  validarConfiguracionDespacho,
  puedeTransicionarDespacho,
} = require("../utils/Gestion/despachoResultadoLaboratorio");

const validarOk = (nombre, entrada, esperado) => {
  const salida = validarConfiguracionDespacho(entrada);
  assert.equal(salida.ok, true, `${nombre}: debía ser válido`);
  assert.equal(salida.datos.canal, esperado.canal);
  assert.equal(salida.datos.modoContenido, esperado.modoContenido);
  console.log(`OK  ${nombre}`);
};

const validarError = (nombre, entrada) => {
  const salida = validarConfiguracionDespacho(entrada);
  assert.equal(salida.ok, false, `${nombre}: debía ser inválido`);
  console.log(`OK  ${nombre}: ${salida.msg}`);
};

validarOk(
  "WhatsApp usa enlace seguro",
  {
    canal: "WHATSAPP",
    destinatario: { nombre: "Paciente", telefono: "+51 999 888 777" },
  },
  { canal: "WHATSAPP", modoContenido: "ENLACE_SEGURO" },
);

validarError("WhatsApp no admite PDF adjunto", {
  canal: "WHATSAPP",
  modoContenido: "PDF_ADJUNTO",
  destinatario: { nombre: "Paciente", telefono: "+51999888777" },
});

for (const modoContenido of ["PDF_ADJUNTO", "ENLACE_SEGURO", "PDF_Y_ENLACE"]) {
  validarOk(
    `Correo admite ${modoContenido}`,
    {
      canal: "CORREO",
      modoContenido,
      destinatario: { nombre: "Paciente", correo: "paciente@correo.pe" },
    },
    { canal: "CORREO", modoContenido },
  );
}

validarError("Correo exige dirección válida", {
  canal: "CORREO",
  destinatario: { nombre: "Paciente", correo: "correo-invalido" },
});

validarOk(
  "Presencial usa registro presencial",
  { canal: "PRESENCIAL", destinatario: { nombre: "Paciente" } },
  { canal: "PRESENCIAL", modoContenido: "REGISTRO_PRESENCIAL" },
);

assert.equal(puedeTransicionarDespacho("PENDIENTE", "PROCESANDO"), true);
assert.equal(puedeTransicionarDespacho("PENDIENTE", "CANCELADO"), true);
assert.equal(puedeTransicionarDespacho("PROCESANDO", "ENVIADO"), true);
assert.equal(puedeTransicionarDespacho("PROCESANDO", "ERROR"), true);
assert.equal(puedeTransicionarDespacho("ERROR", "PROCESANDO"), true);
assert.equal(puedeTransicionarDespacho("ENVIADO", "ENTREGADO"), true);
assert.equal(puedeTransicionarDespacho("ENTREGADO", "LEIDO"), true);
assert.equal(puedeTransicionarDespacho("LEIDO", "PROCESANDO"), false);
assert.equal(puedeTransicionarDespacho("CANCELADO", "PROCESANDO"), false);

console.log("\nMotor común de despacho: todas las pruebas pasaron.");
