const CANALES_DESPACHO = [
  "PRESENCIAL",
  "WHATSAPP",
  "CORREO",
  "PORTAL",
  "OTRO",
];

const MODOS_POR_CANAL = {
  PRESENCIAL: ["REGISTRO_PRESENCIAL"],
  WHATSAPP: ["ENLACE_SEGURO"],
  CORREO: ["PDF_ADJUNTO", "ENLACE_SEGURO", "PDF_Y_ENLACE"],
  PORTAL: ["PUBLICACION_PORTAL"],
  OTRO: ["OTRO"],
};

const MODO_DEFAULT_POR_CANAL = {
  PRESENCIAL: "REGISTRO_PRESENCIAL",
  WHATSAPP: "ENLACE_SEGURO",
  CORREO: "PDF_Y_ENLACE",
  PORTAL: "PUBLICACION_PORTAL",
  OTRO: "OTRO",
};

const TRANSICIONES_DESPACHO = {
  PENDIENTE: ["PROCESANDO", "CANCELADO"],
  PROCESANDO: ["ENVIADO", "ERROR"],
  ERROR: ["PROCESANDO", "CANCELADO"],
  ENVIADO: ["ENTREGADO", "LEIDO"],
  ENTREGADO: ["LEIDO"],
  LEIDO: [],
  CANCELADO: [],
};

const normalizarCanalDespacho = (valor) =>
  String(valor ?? "")
    .trim()
    .toUpperCase();

const normalizarModoContenido = (canal, valor) => {
  const canalNormalizado = normalizarCanalDespacho(canal);
  const modo = String(valor ?? "")
    .trim()
    .toUpperCase();

  return modo || MODO_DEFAULT_POR_CANAL[canalNormalizado] || null;
};

const normalizarCorreo = (valor) =>
  String(valor ?? "")
    .trim()
    .toLowerCase();

const normalizarTelefono = (valor) => {
  const texto = String(valor ?? "").trim();
  if (!texto) return "";

  const conservaMas = texto.startsWith("+");
  const digitos = texto.replace(/\D/g, "");
  return `${conservaMas ? "+" : ""}${digitos}`;
};

const correoValido = (valor) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarCorreo(valor));

const telefonoValido = (valor) => /^\+?[1-9]\d{7,19}$/.test(normalizarTelefono(valor));

// ====== Validar configuración común ======
const validarConfiguracionDespacho = ({
  canal,
  modoContenido,
  destinatario = {},
  detalleCanal,
}) => {
  const canalNormalizado = normalizarCanalDespacho(canal);

  if (!CANALES_DESPACHO.includes(canalNormalizado)) {
    return { ok: false, msg: "El canal de despacho no es válido" };
  }

  const modoNormalizado = normalizarModoContenido(
    canalNormalizado,
    modoContenido,
  );

  if (!MODOS_POR_CANAL[canalNormalizado].includes(modoNormalizado)) {
    return {
      ok: false,
      msg: `El modo de contenido ${modoNormalizado || ""} no es válido para ${canalNormalizado}`,
    };
  }

  const nombre = String(destinatario?.nombre ?? "").trim();
  const tipo = String(destinatario?.tipo ?? "PACIENTE")
    .trim()
    .toUpperCase();
  const correo = normalizarCorreo(destinatario?.correo);
  const telefono = normalizarTelefono(destinatario?.telefono);
  const cargo = String(destinatario?.cargo ?? "").trim();
  const referencia = String(destinatario?.referencia ?? "").trim();
  const detalle = String(detalleCanal ?? "").trim();

  if (!["PACIENTE", "CONTACTO_EMPRESA", "OTRO"].includes(tipo)) {
    return { ok: false, msg: "El tipo de destinatario no es válido" };
  }

  if (!nombre || nombre.length > 180) {
    return { ok: false, msg: "Debe indicar un destinatario válido" };
  }

  if (canalNormalizado === "CORREO" && !correoValido(correo)) {
    return { ok: false, msg: "Debe indicar un correo electrónico válido" };
  }

  if (canalNormalizado === "WHATSAPP" && !telefonoValido(telefono)) {
    return { ok: false, msg: "Debe indicar un teléfono válido para WhatsApp" };
  }

  if (canalNormalizado === "OTRO" && !detalle) {
    return { ok: false, msg: "Debe describir el canal de despacho alternativo" };
  }

  return {
    ok: true,
    datos: {
      canal: canalNormalizado,
      modoContenido: modoNormalizado,
      destinatario: {
        tipo,
        nombre,
        correo: correo || null,
        telefono: telefono || null,
        cargo: cargo || null,
        referencia: referencia || null,
      },
      detalleCanal: detalle || null,
    },
  };
};

// ====== Validar transición ======
const puedeTransicionarDespacho = (estadoActual, estadoNuevo) => {
  const actual = String(estadoActual ?? "").trim().toUpperCase();
  const nuevo = String(estadoNuevo ?? "").trim().toUpperCase();
  return (TRANSICIONES_DESPACHO[actual] ?? []).includes(nuevo);
};

module.exports = {
  CANALES_DESPACHO,
  MODOS_POR_CANAL,
  MODO_DEFAULT_POR_CANAL,
  TRANSICIONES_DESPACHO,
  normalizarCanalDespacho,
  normalizarModoContenido,
  normalizarCorreo,
  normalizarTelefono,
  validarConfiguracionDespacho,
  puedeTransicionarDespacho,
};
