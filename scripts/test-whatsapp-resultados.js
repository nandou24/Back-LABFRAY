try {
  require("dotenv").config();
} catch {
  // ====== El backend puede cargar variables por otro mecanismo ======
}
const assert = require("node:assert/strict");
const {
  obtenerConfiguracionWhatsapp,
  normalizarTelefonoWhatsapp,
  construirPayloadWhatsappResultados,
} = require("../utils/notificaciones/whatsappResultados");

const soloPayload = process.argv.includes("--solo-payload");

const ejecutar = async () => {
  assert.equal(normalizarTelefonoWhatsapp("+51 999 888 777"), "51999888777");
  console.log("OK  Teléfono normalizado para WhatsApp");

  const payload = construirPayloadWhatsappResultados({
    para: "+51 999 888 777",
    nombreDestinatario: "Paciente de prueba",
    codigoSolicitud: "SOL-TEST-0001",
    enlaceSeguro: "https://resultados.ejemplo.pe/resultados/consulta#t=abc123",
    templateName: "resultados_laboratorio_disponibles",
    templateLanguage: "es_PE",
  });

  assert.equal(payload.messaging_product, "whatsapp");
  assert.equal(payload.type, "template");
  assert.equal(payload.to, "51999888777");
  assert.equal(payload.template.components[0].parameters.length, 3);
  console.log("OK  Payload de plantilla de resultados construido");

  if (soloPayload) {
    console.log("Prueba local de WhatsApp: payload validado sin conexión a Meta.");
    return;
  }

  const config = obtenerConfiguracionWhatsapp();
  console.log(`OK  Graph API configurada: ${config.graphVersion}`);
  console.log(`OK  Phone Number ID configurado: ${config.phoneNumberId}`);
  console.log(`OK  Plantilla configurada: ${config.templateName} (${config.templateLanguage})`);
  console.log("Configuración de WhatsApp lista. El envío real se valida desde LAB FRAY.");
};

ejecutar().catch((error) => {
  console.error("ERROR", error.message || error);
  process.exitCode = 1;
});
