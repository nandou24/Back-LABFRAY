let transporteCorreo = null;

// ====== Configuración SMTP ======
const obtenerConfiguracionSmtp = () => {
  const host = String(process.env.SMTP_HOST ?? "").trim();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const usuario = String(process.env.SMTP_USER ?? "").trim();
  const password = String(process.env.SMTP_PASS ?? "");
  const fromEmail = String(process.env.SMTP_FROM_EMAIL ?? usuario).trim();
  const fromName = String(process.env.SMTP_FROM_NAME ?? "LAB FRAY").trim();
  const replyTo = String(process.env.SMTP_REPLY_TO ?? "").trim() || null;
  const secureTexto = String(process.env.SMTP_SECURE ?? "").trim().toLowerCase();
  const secure = secureTexto
    ? ["1", "true", "si", "sí"].includes(secureTexto)
    : port === 465;

  if (!host) {
    throw new Error("Falta configurar SMTP_HOST");
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT no es válido");
  }

  if (!usuario || !password) {
    throw new Error("Falta configurar SMTP_USER o SMTP_PASS");
  }

  if (!fromEmail) {
    throw new Error("Falta configurar SMTP_FROM_EMAIL");
  }

  return {
    host,
    port,
    secure,
    usuario,
    password,
    fromEmail,
    fromName: fromName || "LAB FRAY",
    replyTo,
  };
};

// ====== Cargar Nodemailer sin bloquear el arranque ======
const obtenerNodemailer = () => {
  try {
    return require("nodemailer");
  } catch (error) {
    const faltaModulo = error?.code === "MODULE_NOT_FOUND";
    const mensaje = faltaModulo
      ? "Nodemailer no está instalado. Ejecute: npm install nodemailer"
      : "No se pudo cargar Nodemailer";

    const nuevoError = new Error(mensaje);
    nuevoError.code = "NODEMAILER_NO_DISPONIBLE";
    throw nuevoError;
  }
};

const obtenerTransporteCorreo = () => {
  if (transporteCorreo) {
    return transporteCorreo;
  }

  const nodemailer = obtenerNodemailer();
  const config = obtenerConfiguracionSmtp();

  transporteCorreo = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.usuario,
      pass: config.password,
    },
  });

  return transporteCorreo;
};

const escaparHtml = (valor) =>
  String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// ====== Construir mensaje de resultados ======
const construirContenidoCorreoResultados = ({
  nombreDestinatario,
  codigoLaboratorio,
  cantidadResultados,
  enlaceSeguro,
  incluyePdf,
}) => {
  const nombre = String(nombreDestinatario ?? "").trim() || "paciente";
  const codigo = String(codigoLaboratorio ?? "").trim();
  const cantidad = Number(cantidadResultados ?? 0);
  const asunto = codigo
    ? `Resultados de laboratorio ${codigo} · LAB FRAY`
    : "Resultados de laboratorio · LAB FRAY";

  const lineasTexto = [
    `Estimado(a) ${nombre}:`,
    "",
    "Sus resultados de laboratorio se encuentran disponibles.",
    cantidad > 0 ? `Resultados incluidos: ${cantidad}.` : null,
    codigo ? `Código de laboratorio: ${codigo}.` : null,
    incluyePdf ? "Se adjunta el informe en formato PDF." : null,
    enlaceSeguro ? `Enlace seguro: ${enlaceSeguro}` : null,
    enlaceSeguro ? "Este enlace es personal y permite consultar sus resultados cuando lo necesite." : null,
    "",
    "LAB FRAY",
  ].filter(Boolean);

  const boton = enlaceSeguro
    ? `<p style="margin:24px 0"><a href="${escaparHtml(enlaceSeguro)}" style="background:#0f62ce;color:#fff;text-decoration:none;padding:11px 18px;border-radius:6px;display:inline-block">Ver resultados</a></p>`
    : "";

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5;max-width:640px">
      <p>Estimado(a) <strong>${escaparHtml(nombre)}</strong>:</p>
      <p>Sus resultados de laboratorio se encuentran disponibles.</p>
      ${cantidad > 0 ? `<p><strong>Resultados incluidos:</strong> ${cantidad}</p>` : ""}
      ${codigo ? `<p><strong>Código de laboratorio:</strong> ${escaparHtml(codigo)}</p>` : ""}
      ${incluyePdf ? "<p>Se adjunta el informe en formato PDF.</p>" : ""}
      ${boton}
      ${enlaceSeguro ? "<p style=\"font-size:12px;color:#64748b\">Este enlace es personal. Consérvelo para consultar sus resultados y no lo comparta con terceros.</p>" : ""}
      <p>Atentamente,<br><strong>LAB FRAY</strong></p>
    </div>
  `;

  return {
    asunto,
    texto: lineasTexto.join("\n"),
    html,
  };
};

// ====== Enviar correo ======
const enviarCorreoResultados = async ({
  para,
  nombreDestinatario,
  codigoLaboratorio,
  cantidadResultados,
  enlaceSeguro = null,
  pdf = null,
}) => {
  const config = obtenerConfiguracionSmtp();
  const transporte = obtenerTransporteCorreo();
  const incluyePdf = Boolean(pdf?.buffer && pdf?.nombreArchivo);
  const contenido = construirContenidoCorreoResultados({
    nombreDestinatario,
    codigoLaboratorio,
    cantidadResultados,
    enlaceSeguro,
    incluyePdf,
  });

  const respuesta = await transporte.sendMail({
    from: {
      name: config.fromName,
      address: config.fromEmail,
    },
    to: para,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    subject: contenido.asunto,
    text: contenido.texto,
    html: contenido.html,
    attachments: incluyePdf
      ? [
          {
            filename: pdf.nombreArchivo,
            content: pdf.buffer,
            contentType: "application/pdf",
          },
        ]
      : [],
  });

  const rechazados = Array.isArray(respuesta?.rejected) ? respuesta.rejected : [];
  if (rechazados.length > 0) {
    const error = new Error(`El servidor SMTP rechazó el destinatario: ${rechazados.join(", ")}`);
    error.code = "SMTP_DESTINATARIO_RECHAZADO";
    throw error;
  }

  return {
    proveedor: "SMTP",
    mensajeId: respuesta?.messageId ? String(respuesta.messageId) : null,
    respuesta: respuesta?.response ? String(respuesta.response) : null,
    aceptados: Array.isArray(respuesta?.accepted)
      ? respuesta.accepted.map(String)
      : [],
  };
};

// ====== Verificar conexión SMTP ======
const verificarCorreoSmtp = async () => {
  const transporte = obtenerTransporteCorreo();
  await transporte.verify();
  return true;
};

module.exports = {
  obtenerConfiguracionSmtp,
  construirContenidoCorreoResultados,
  enviarCorreoResultados,
  verificarCorreoSmtp,
};
