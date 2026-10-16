try {
  require("dotenv").config();
} catch {
  // El backend puede cargar variables desde el entorno del proceso.
}

const {
  obtenerConfiguracionSmtp,
  construirContenidoCorreoResultados,
  verificarCorreoSmtp,
} = require("../utils/notificaciones/correoResultados");

const soloPlantilla = process.argv.includes("--solo-plantilla");

const ejecutar = async () => {
  const contenido = construirContenidoCorreoResultados({
    nombreDestinatario: "Paciente de prueba",
    codigoLaboratorio: "LTEST-0001",
    cantidadResultados: 2,
    enlaceSeguro: "https://ejemplo.local/resultados/consulta#t=TOKEN_SEGURO",
    incluyePdf: true,
  });

  if (!contenido.asunto || !contenido.html || !contenido.texto) {
    throw new Error("No se pudo construir el contenido del correo");
  }

  console.log("OK Plantilla de correo construida");

  if (soloPlantilla) {
    console.log("Prueba local de correo: plantilla validada sin conexión SMTP.");
    return;
  }

  const config = obtenerConfiguracionSmtp();
  console.log(`OK SMTP configurado: ${config.host}:${config.port}`);
  await verificarCorreoSmtp();
  console.log("OK Conexión SMTP verificada");
};

ejecutar().catch((error) => {
  console.error("ERROR", error.message || error);
  process.exitCode = 1;
});
