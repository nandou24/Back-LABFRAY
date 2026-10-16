const https = require("https");

// ====== Configuración WhatsApp Cloud API ======
const obtenerConfiguracionWhatsapp = () => {
  const graphVersion = String(process.env.WHATSAPP_GRAPH_VERSION ?? "").trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
  const templateName = String(
    process.env.WHATSAPP_TEMPLATE_RESULTADOS ?? "resultados_laboratorio_disponibles",
  ).trim();
  const templateLanguage = String(
    process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "es_PE",
  ).trim();

  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error(
      "Falta configurar WHATSAPP_GRAPH_VERSION con una versión válida, por ejemplo v26.0",
    );
  }

  if (!/^\d+$/.test(phoneNumberId)) {
    throw new Error("Falta configurar WHATSAPP_PHONE_NUMBER_ID");
  }

  if (!accessToken) {
    throw new Error("Falta configurar WHATSAPP_ACCESS_TOKEN");
  }

  if (!/^[a-z0-9_]+$/.test(templateName)) {
    throw new Error("WHATSAPP_TEMPLATE_RESULTADOS no es válido");
  }

  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)) {
    throw new Error("WHATSAPP_TEMPLATE_LANGUAGE no es válido");
  }

  return {
    graphVersion,
    phoneNumberId,
    accessToken,
    templateName,
    templateLanguage,
  };
};

// ====== Normalizar teléfono para Meta ======
const normalizarTelefonoWhatsapp = (valor) =>
  String(valor ?? "")
    .trim()
    .replace(/\D/g, "");

const validarTelefonoWhatsapp = (valor) => {
  const telefono = normalizarTelefonoWhatsapp(valor);
  return /^\d{8,20}$/.test(telefono) ? telefono : null;
};

// ====== Construir plantilla aprobada ======
const construirPayloadWhatsappResultados = ({
  para,
  nombreDestinatario,
  codigoSolicitud,
  enlaceSeguro,
  templateName,
  templateLanguage,
}) => {
  const telefono = validarTelefonoWhatsapp(para);
  if (!telefono) {
    throw new Error(
      "El teléfono de WhatsApp no es válido. Indique el código de país, por ejemplo +51.",
    );
  }

  const nombre = String(nombreDestinatario ?? "").trim() || "Paciente";
  const solicitud = String(codigoSolicitud ?? "").trim() || "-";
  const enlace = String(enlaceSeguro ?? "").trim();

  if (!/^https?:\/\//i.test(enlace)) {
    throw new Error("No se pudo generar un enlace seguro válido para WhatsApp");
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: telefono,
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLanguage },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: nombre.slice(0, 180) },
            { type: "text", text: solicitud.slice(0, 80) },
            { type: "text", text: enlace },
          ],
        },
      ],
    },
  };
};

// ====== Ejecutar POST JSON ======
const postJson = ({ url, accessToken, body, timeoutMs = 15000 }) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const destino = new URL(url);

    const req = https.request(
      {
        protocol: destino.protocol,
        hostname: destino.hostname,
        port: destino.port || 443,
        path: `${destino.pathname}${destino.search}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const partes = [];
        res.on("data", (chunk) => partes.push(chunk));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          let data = {};

          if (texto) {
            try {
              data = JSON.parse(texto);
            } catch {
              data = { raw: texto };
            }
          }

          resolve({ statusCode: Number(res.statusCode ?? 0), data });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Tiempo de espera agotado al conectar con WhatsApp"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

// ====== Enviar enlace de resultados ======
const enviarWhatsappResultados = async ({
  para,
  nombreDestinatario,
  codigoSolicitud,
  enlaceSeguro,
}) => {
  const config = obtenerConfiguracionWhatsapp();
  const payload = construirPayloadWhatsappResultados({
    para,
    nombreDestinatario,
    codigoSolicitud,
    enlaceSeguro,
    templateName: config.templateName,
    templateLanguage: config.templateLanguage,
  });

  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
  const respuesta = await postJson({
    url,
    accessToken: config.accessToken,
    body: payload,
  });

  const mensajeMeta = respuesta?.data?.error?.message;
  if (respuesta.statusCode < 200 || respuesta.statusCode >= 300) {
    const error = new Error(
      mensajeMeta || `WhatsApp respondió HTTP ${respuesta.statusCode || "desconocido"}`,
    );
    error.code = String(
      respuesta?.data?.error?.code ?? "WHATSAPP_CLOUD_API_ERROR",
    );
    error.statusCode = 502;
    throw error;
  }

  const mensajeId = respuesta?.data?.messages?.[0]?.id
    ? String(respuesta.data.messages[0].id)
    : null;

  if (!mensajeId) {
    const error = new Error(
      "WhatsApp aceptó la solicitud pero no devolvió un identificador de mensaje",
    );
    error.code = "WHATSAPP_SIN_WAMID";
    error.statusCode = 502;
    throw error;
  }

  return {
    proveedor: "WHATSAPP_CLOUD_API",
    mensajeId,
    respuesta: `HTTP_${respuesta.statusCode}`,
  };
};

module.exports = {
  obtenerConfiguracionWhatsapp,
  normalizarTelefonoWhatsapp,
  validarTelefonoWhatsapp,
  construirPayloadWhatsappResultados,
  enviarWhatsappResultados,
};
