const crypto = require("crypto");
const { response } = require("express");
const mongoose = require("mongoose");

const DespachoResultado = require("../../models/Gestion/DespachoResultadoLaboratorio");
const EntregaResultado = require("../../models/Gestion/EntregaResultadoLaboratorio");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");
const { validarIdentidadesParaLiberar } = require('../../utils/Gestion/validarIdentidadLiberacion');

const {
  validarConfiguracionDespacho,
  puedeTransicionarDespacho,
} = require("../../utils/Gestion/despachoResultadoLaboratorio");
const {
  enviarCorreoResultados,
} = require("../../utils/notificaciones/correoResultados");
const {
  enviarWhatsappResultados,
} = require("../../utils/notificaciones/whatsappResultados");
const {
  construirInformeEntregableSeleccionado,
} = require("./entregaResultadoLaboratorioController");

const MAX_RESULTADOS_DESPACHO = 100;
const ESTADOS_ACCESO_DIGITAL = ["ENVIADO", "ENTREGADO", "LEIDO"];

// ====== Hash estable ======
const construirPayloadHash = (datos) =>
  crypto.createHash("sha256").update(JSON.stringify(datos)).digest("hex");

const construirHashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const construirNombrePaciente = (solicitud) =>
  [
    solicitud?.nombreCliente,
    solicitud?.apePatCliente,
    solicitud?.apeMatCliente,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const construirDocumentoPaciente = (solicitud) =>
  [solicitud?.tipoDoc, solicitud?.nroDoc].filter(Boolean).join(" ").trim();

const obtenerClaveIdempotencia = (req) =>
  String(
    req.body?.idempotencyKey ??
      req.get("Idempotency-Key") ??
      req.get("X-Idempotency-Key") ??
      "",
  ).trim();

const construirUrlVisorPublico = (req, token) => {
  const configurada = String(process.env.RESULTADOS_VISOR_PUBLIC_URL ?? "")
    .trim()
    .replace(/#+.*$/g, "")
    .replace(/\/+$/g, "");

  const origen = String(req.get("origin") ?? "")
    .trim()
    .replace(/\/+$/g, "");

  const base = configurada || (origen ? `${origen}/resultados/consulta` : "");

  if (!base) {
    const error = new Error(
      "Falta configurar RESULTADOS_VISOR_PUBLIC_URL para generar el enlace seguro",
    );
    error.code = "VISOR_PUBLICO_NO_CONFIGURADO";
    throw error;
  }

  return `${base}#t=${encodeURIComponent(token)}`;
};

// ====== Retirar identificadores internos del visor público ======
const sanitizarInformePublico = (informe) => {
  const paciente = { ...(informe?.solicitud?.paciente ?? {}) };
  delete paciente.pacienteId;

  const empresa = informe?.solicitud?.empresa
    ? { ...informe.solicitud.empresa }
    : null;

  if (empresa) {
    delete empresa.programacionEmpresaId;
    delete empresa.empresaId;
    delete empresa.protocoloId;
  }

  return {
    ...informe,
    solicitud: {
      ...informe.solicitud,
      solicitudAtencionId: "",
      paciente,
      empresa,
    },
    resultados: (informe?.resultados ?? []).map((resultado, indice) => ({
      ...resultado,
      _id: `PUBLIC-${indice + 1}`,
    })),
    entregas: [],
  };
};

const normalizarNombrePdf = (valor) => {
  const nombre = String(valor ?? "informe-laboratorio.pdf")
    .trim()
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .slice(0, 210);

  return nombre.toLowerCase().endsWith(".pdf") ? nombre : `${nombre}.pdf`;
};

const validarResultadosIds = (valor) => {
  if (!Array.isArray(valor) || valor.length === 0) {
    return { ok: false, msg: "Debe seleccionar al menos un resultado" };
  }

  if (valor.length > MAX_RESULTADOS_DESPACHO) {
    return {
      ok: false,
      msg: `No se pueden incluir más de ${MAX_RESULTADOS_DESPACHO} resultados en un despacho individual`,
    };
  }

  const ids = valor.map((id) => String(id ?? "").trim());

  if (!ids.every((id) => mongoose.isValidObjectId(id))) {
    return { ok: false, msg: "Uno o más resultados seleccionados no son válidos" };
  }

  const unicos = [...new Set(ids)];

  if (unicos.length !== ids.length) {
    return { ok: false, msg: "No se permiten resultados duplicados" };
  }

  return { ok: true, ids: unicos.sort() };
};

const serializarRecursoDigital = (recurso) => {
  if (!recurso) {
    return null;
  }

  return {
    vigencia: recurso.vigencia ?? "PERMANENTE",
    estadoAcceso: recurso.estadoAcceso ?? "ACTIVO",
    fechaExpiracionAcceso: recurso.fechaExpiracionAcceso ?? null,
    fechaPrimerAcceso: recurso.fechaPrimerAcceso ?? null,
    fechaUltimoAcceso: recurso.fechaUltimoAcceso ?? null,
    cantidadAccesos: Number(recurso.cantidadAccesos ?? 0),
    fechaRevocacion: recurso.fechaRevocacion ?? null,
    motivoRevocacion: recurso.motivoRevocacion ?? null,
  };
};

const serializarDespacho = (despacho) => ({
  _id: String(despacho._id),
  tipoDespacho: despacho.tipoDespacho,
  origenAtencion: despacho.origenAtencion,
  canal: despacho.canal,
  modoContenido: despacho.modoContenido,
  destinatario: despacho.destinatario,
  detalleCanal: despacho.detalleCanal ?? null,
  observacion: despacho.observacion ?? "",
  estadoDespacho: despacho.estadoDespacho,
  fechaSolicitud: despacho.fechaSolicitud,
  fechaInicioProcesamiento: despacho.fechaInicioProcesamiento ?? null,
  fechaEnvio: despacho.fechaEnvio ?? null,
  fechaEntregaConfirmada: despacho.fechaEntregaConfirmada ?? null,
  fechaLectura: despacho.fechaLectura ?? null,
  fechaError: despacho.fechaError ?? null,
  ultimoError: despacho.ultimoError ?? null,
  fechaCancelacion: despacho.fechaCancelacion ?? null,
  motivoCancelacion: despacho.motivoCancelacion ?? null,
  usuarioSolicitud: despacho.usuarioSolicitud,
  usuarioActualizacion: despacho.usuarioActualizacion ?? null,
  solicitudes: despacho.solicitudes,
  intentos: despacho.intentos ?? [],
  recursoDigital: serializarRecursoDigital(despacho.recursoDigital),
  entregaResultadoIds: despacho.entregaResultadoIds ?? [],
});

// ====== Crear despacho pendiente ======
const crearDespachoSolicitud = async (req, res = response) => {
  let idempotencyKeyCapturada = "";
  let payloadHashCalculado = null;

  try {
    const { solicitudAtencionId } = req.params;
    const { resultadosIds, canal, modoContenido, destinatario, detalleCanal } =
      req.body ?? {};
    const observacion = String(req.body?.observacion ?? "").trim();
    const idempotencyKey = obtenerClaveIdempotencia(req);
    idempotencyKeyCapturada = idempotencyKey;

    if (!mongoose.isValidObjectId(solicitudAtencionId)) {
      return res.status(400).json({ ok: false, msg: "Solicitud inválida" });
    }

    if (!idempotencyKey || idempotencyKey.length > 160) {
      return res.status(400).json({
        ok: false,
        msg: "Debe indicar una clave de idempotencia válida",
      });
    }

    if (observacion.length > 1000) {
      return res.status(400).json({
        ok: false,
        msg: "La observación no puede superar 1000 caracteres",
      });
    }

    const validacionResultados = validarResultadosIds(resultadosIds);
    if (!validacionResultados.ok) {
      return res.status(400).json({ ok: false, msg: validacionResultados.msg });
    }

    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .select(
        [
          "_id",
          "codSolicitud",
          "codigoLaboratorio",
          "origenAtencion",
          "tipo",
          "estado",
          "clienteId",
          "hc",
          "tipoDoc",
          "nroDoc",
          "nombreCliente",
          "apePatCliente",
          "apeMatCliente",
          "empresaId",
          "razonSocialEmpresa",
          "programacionEmpresaId",
          "codProgramacion",
          "codProtocolo",
        ].join(" "),
      )
      .lean();

    if (!solicitud || solicitud.tipo !== "Laboratorio") {
      return res.status(404).json({ ok: false, msg: "Solicitud no encontrada" });
    }

    if (solicitud.estado === "ANULADO") {
      return res.status(409).json({
        ok: false,
        msg: "No se puede preparar un despacho para una solicitud anulada",
      });
    }

    // ====== No preparar despachos sin identidad definitiva ======
    await validarIdentidadesParaLiberar([solicitud]);

    const nombrePaciente = construirNombrePaciente(solicitud) || "PACIENTE";
    const destinatarioEntrada = {
      ...(destinatario ?? {}),
      nombre: String(destinatario?.nombre ?? "").trim() || nombrePaciente,
    };

    const validacionConfiguracion = validarConfiguracionDespacho({
      canal,
      modoContenido,
      destinatario: destinatarioEntrada,
      detalleCanal,
    });

    if (!validacionConfiguracion.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacionConfiguracion.msg,
      });
    }

    const payloadNormalizado = {
      solicitudAtencionId: String(solicitudAtencionId),
      resultadosIds: validacionResultados.ids,
      canal: validacionConfiguracion.datos.canal,
      modoContenido: validacionConfiguracion.datos.modoContenido,
      destinatario: validacionConfiguracion.datos.destinatario,
      detalleCanal: validacionConfiguracion.datos.detalleCanal,
      observacion,
    };
    const payloadHash = construirPayloadHash(payloadNormalizado);
    payloadHashCalculado = payloadHash;

    const existente = await DespachoResultado.findOne({ idempotencyKey }).lean();

    if (existente) {
      if (existente.payloadHash !== payloadHash) {
        return res.status(409).json({
          ok: false,
          codigo: "IDEMPOTENCY_KEY_REUTILIZADA",
          msg: "La clave de idempotencia ya fue utilizada con otro despacho",
        });
      }

      return res.status(200).json({
        ok: true,
        reutilizado: true,
        msg: "El despacho ya había sido preparado",
        despacho: serializarDespacho(existente),
      });
    }

    const resultados = await ResultadoLaboratorio.find({
      solicitudAtencionId,
      _id: { $in: validacionResultados.ids },
      estadoResultado: "LIBERADO",
    })
      .select(
        "_id claveUnidad codPruebaLab nombrePruebaLab numeroInstancia etiquetaInstancia versionResultado fechaLiberacion",
      )
      .lean();

    if (resultados.length !== validacionResultados.ids.length) {
      return res.status(409).json({
        ok: false,
        codigo: "RESULTADO_NO_LIBERADO",
        msg: "Algún resultado seleccionado ya no se encuentra liberado",
      });
    }

    const resultadosOrdenados = resultados
      .slice()
      .sort((a, b) => String(a._id).localeCompare(String(b._id)))
      .map((resultado) => ({
        resultadoLaboratorioId: resultado._id,
        claveUnidad: resultado.claveUnidad,
        codPruebaLab: resultado.codPruebaLab,
        nombrePruebaLab: resultado.nombrePruebaLab,
        numeroInstancia: Number(resultado.numeroInstancia ?? 1),
        etiquetaInstancia: resultado.etiquetaInstancia ?? null,
        versionResultado: Number(resultado.versionResultado ?? 1),
        fechaLiberacion: resultado.fechaLiberacion,
      }));

    const solicitudSnapshot = {
      solicitudAtencionId: solicitud._id,
      codSolicitud: solicitud.codSolicitud,
      codigoLaboratorio: solicitud.codigoLaboratorio ?? "",
      paciente: {
        pacienteId: solicitud.clienteId ?? null,
        nombreCompleto: nombrePaciente,
        hc: solicitud.hc ?? "",
        documento: construirDocumentoPaciente(solicitud),
      },
      empresa: {
        empresaId: solicitud.empresaId ?? null,
        razonSocialEmpresa: solicitud.razonSocialEmpresa ?? null,
        programacionEmpresaId: solicitud.programacionEmpresaId ?? null,
        codProgramacion: solicitud.codProgramacion ?? null,
        codProtocolo: solicitud.codProtocolo ?? null,
      },
      resultados: resultadosOrdenados,
    };

    const despacho = await DespachoResultado.create({
      tipoDespacho: "INDIVIDUAL",
      origenAtencion: solicitud.origenAtencion,
      canal: validacionConfiguracion.datos.canal,
      modoContenido: validacionConfiguracion.datos.modoContenido,
      destinatario: validacionConfiguracion.datos.destinatario,
      detalleCanal: validacionConfiguracion.datos.detalleCanal,
      observacion,
      solicitudes: [solicitudSnapshot],
      estadoDespacho: "PENDIENTE",
      idempotencyKey,
      payloadHash,
      solicitadoPor: req.user.uid,
      usuarioSolicitud: req.user.nombreUsuario,
    });

    return res.status(201).json({
      ok: true,
      reutilizado: false,
      msg: "Despacho preparado correctamente",
      despacho: serializarDespacho(despacho.toObject()),
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKeyCapturada) {
      const existente = await DespachoResultado.findOne({
        idempotencyKey: idempotencyKeyCapturada,
      }).lean();

      if (existente && existente.payloadHash === payloadHashCalculado) {
        return res.status(200).json({
          ok: true,
          reutilizado: true,
          msg: "El despacho ya había sido preparado",
          despacho: serializarDespacho(existente),
        });
      }

      if (existente) {
        return res.status(409).json({
          ok: false,
          codigo: "IDEMPOTENCY_KEY_REUTILIZADA",
          msg: "La clave de idempotencia ya fue utilizada con otro despacho",
        });
      }
    }

    console.error("Error al preparar despacho de resultados:", error);
    return res.status(500).json({
      ok: false,
      msg: "No se pudo preparar el despacho de resultados",
    });
  }
};

// ====== Validar versiones antes de enviar ======
const obtenerResultadosVigentesDespacho = async (despacho) => {
  const solicitud = despacho.solicitudes?.[0];
  // ====== Revalidar identidad antes de enviar un despacho existente ======
  const solicitudVigente = solicitud?.solicitudAtencionId
    ? await SolicitudAtencion.findById(solicitud.solicitudAtencionId)
        .select('_id codSolicitud hc clienteId tipoDoc nroDoc').lean()
    : null;
  if (!solicitudVigente) {
    const error = new Error('La solicitud del despacho ya no está disponible');
    error.statusCode = 409;
    error.codigo = 'SOLICITUD_NO_DISPONIBLE';
    throw error;
  }
  await validarIdentidadesParaLiberar([solicitudVigente]);
  const esperados = Array.isArray(solicitud?.resultados)
    ? solicitud.resultados
    : [];
  const ids = esperados.map((item) => item.resultadoLaboratorioId);

  const resultados = await ResultadoLaboratorio.find({
    solicitudAtencionId: solicitud?.solicitudAtencionId,
    _id: { $in: ids },
    estadoResultado: "LIBERADO",
  }).lean();

  if (resultados.length !== esperados.length) {
    const error = new Error(
      "Algún resultado cambió de estado y ya no puede enviarse. Actualice el informe.",
    );
    error.statusCode = 409;
    error.codigo = "RESULTADO_NO_LIBERADO";
    throw error;
  }

  const porId = new Map(resultados.map((item) => [String(item._id), item]));

  for (const esperado of esperados) {
    const actual = porId.get(String(esperado.resultadoLaboratorioId));
    if (Number(actual?.versionResultado ?? 1) !== Number(esperado.versionResultado)) {
      const error = new Error(
        "Algún resultado cambió de versión. Vuelva a preparar el despacho.",
      );
      error.statusCode = 409;
      error.codigo = "VERSION_RESULTADO_CAMBIO";
      throw error;
    }
  }

  return resultados;
};

const esValorResultadoVacio = (valor) =>
  valor === null ||
  valor === undefined ||
  (typeof valor === "string" && valor.trim() === "");

const obtenerItemsEntregables = (items = []) =>
  (Array.isArray(items) ? items : []).filter(
    (item) => !(item?.esOpcional === true && esValorResultadoVacio(item?.valor)),
  );

// ====== Registrar entrega desde despacho enviado ======
const registrarEntregaDesdeDespacho = async (despacho, resultadosVigentes) => {
  const solicitudSnapshot = despacho.solicitudes?.[0];
  if (!solicitudSnapshot) {
    throw new Error("El despacho no contiene una solicitud válida");
  }

  const existente = await EntregaResultado.findOne({
    despachoResultadoId: despacho._id,
    solicitudAtencionId: solicitudSnapshot.solicitudAtencionId,
  });

  if (existente) {
    await DespachoResultado.updateOne(
      { _id: despacho._id },
      { $addToSet: { entregaResultadoIds: existente._id } },
    );
    return existente;
  }

  const solicitud = await SolicitudAtencion.findById(
    solicitudSnapshot.solicitudAtencionId,
  )
    .select("unidadesLaboratorio")
    .lean();
  const todos = await ResultadoLaboratorio.find({
    solicitudAtencionId: solicitudSnapshot.solicitudAtencionId,
  })
    .select("estadoResultado")
    .lean();

  const resultadosActivos = todos.filter(
    (resultado) => resultado.estadoResultado !== "ANULADO",
  ).length;
  const unidadesActivas = (solicitud?.unidadesLaboratorio ?? []).filter(
    (unidad) => unidad.estado !== "ANULADO",
  ).length;
  const totalPruebasActivas = Math.max(resultadosActivos, unidadesActivas);
  const tipoEntrega =
    resultadosVigentes.length === totalPruebasActivas && totalPruebasActivas > 0
      ? "FINAL"
      : "PARCIAL";

  const snapshots = resultadosVigentes.map((resultado) => ({
    resultadoLaboratorioId: String(resultado._id),
    codPruebaLab: resultado.codPruebaLab,
    nombrePruebaLab: resultado.nombrePruebaLab,
    versionResultado: resultado.versionResultado || 1,
    fechaLiberacion: resultado.fechaLiberacion,
    resultadosItems: obtenerItemsEntregables(resultado.resultadosItems).map(
      (item) => ({
        nombreInforme: item.nombreInforme,
        valor: item.valor,
        unidadesRef: item.unidadesRef,
        evaluacionReferencia: item.evaluacionReferencia,
        alertasDetectadas: item.alertasDetectadas,
      }),
    ),
  }));

  let entrega;
  try {
    entrega = await EntregaResultado.create({
      solicitudAtencionId: solicitudSnapshot.solicitudAtencionId,
      despachoResultadoId: despacho._id,
      codSolicitud: solicitudSnapshot.codSolicitud,
      codigoLaboratorio: solicitudSnapshot.codigoLaboratorio ?? "",
      tipoEntrega,
      medio: despacho.canal,
      receptorNombre: despacho.destinatario?.nombre ?? "",
      receptorCorreo:
        despacho.canal === "CORREO" ? despacho.destinatario?.correo ?? null : null,
      receptorTelefono:
        despacho.canal === "WHATSAPP" ? despacho.destinatario?.telefono ?? null : null,
      observacion: despacho.observacion ?? "",
      resultados: snapshots,
      totalPruebasActivas,
      entregadoPor: despacho.solicitadoPor,
      usuarioEntrega: despacho.usuarioSolicitud,
      fechaEntrega: despacho.fechaEnvio ?? new Date(),
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    entrega = await EntregaResultado.findOne({
      despachoResultadoId: despacho._id,
      solicitudAtencionId: solicitudSnapshot.solicitudAtencionId,
    });

    if (!entrega) {
      throw error;
    }
  }

  await DespachoResultado.updateOne(
    { _id: despacho._id },
    { $addToSet: { entregaResultadoIds: entrega._id } },
  );

  return entrega;
};

// ====== Preparar enlace permanente al visor público ======
const prepararEnlaceSeguro = async ({ despacho, req }) => {
  const token = crypto.randomBytes(32).toString("hex");

  despacho.recursoDigital = {
    tokenAccesoHash: construirHashToken(token),
    vigencia: "PERMANENTE",
    estadoAcceso: "ACTIVO",
    fechaExpiracionAcceso: null,
    fechaPrimerAcceso: null,
    fechaUltimoAcceso: null,
    cantidadAccesos: 0,
    fechaRevocacion: null,
    motivoRevocacion: null,
  };

  await despacho.save();

  return {
    url: construirUrlVisorPublico(req, token),
  };
};

// ====== Enviar correo automático ======
const enviarCorreoDespacho = async (req, res = response) => {
  let despachoProcesando = null;
  let numeroIntento = null;

  try {
    const { despachoId } = req.params;

    if (!mongoose.isValidObjectId(despachoId)) {
      return res.status(400).json({ ok: false, msg: "Despacho inválido" });
    }

    const despachoInicial = await DespachoResultado.findById(despachoId);
    if (!despachoInicial) {
      return res.status(404).json({ ok: false, msg: "Despacho no encontrado" });
    }

    if (despachoInicial.canal !== "CORREO") {
      return res.status(409).json({
        ok: false,
        msg: "El despacho indicado no corresponde al canal CORREO",
      });
    }

    const requierePdf = ["PDF_ADJUNTO", "PDF_Y_ENLACE"].includes(
      despachoInicial.modoContenido,
    );

    if (requierePdf && !req.file?.buffer?.length) {
      return res.status(400).json({
        ok: false,
        codigo: "PDF_REQUERIDO",
        msg: "Debe adjuntar el informe PDF para este tipo de envío",
      });
    }

    // ====== Recuperar finalización sin reenviar ======
    if (["ENVIADO", "ENTREGADO", "LEIDO"].includes(despachoInicial.estadoDespacho)) {
      const resultados = await obtenerResultadosVigentesDespacho(despachoInicial);
      const entrega = await registrarEntregaDesdeDespacho(
        despachoInicial,
        resultados,
      );
      const actualizado = await DespachoResultado.findById(despachoId).lean();

      return res.status(200).json({
        ok: true,
        reutilizado: true,
        msg: "El correo ya había sido enviado; no se realizó un segundo envío",
        entregaId: String(entrega._id),
        despacho: serializarDespacho(actualizado),
      });
    }

    if (!["PENDIENTE", "ERROR"].includes(despachoInicial.estadoDespacho)) {
      return res.status(409).json({
        ok: false,
        codigo: "ESTADO_DESPACHO_INVALIDO",
        msg: `No se puede enviar un despacho en estado ${despachoInicial.estadoDespacho}`,
      });
    }

    const resultadosVigentes = await obtenerResultadosVigentesDespacho(
      despachoInicial,
    );
    const ahora = new Date();
    numeroIntento = Number(despachoInicial.intentos?.length ?? 0) + 1;

    despachoProcesando = await DespachoResultado.findOneAndUpdate(
      {
        _id: despachoId,
        estadoDespacho: { $in: ["PENDIENTE", "ERROR"] },
        canal: "CORREO",
      },
      {
        $set: {
          estadoDespacho: "PROCESANDO",
          fechaInicioProcesamiento: ahora,
          fechaError: null,
          ultimoError: null,
          actualizadoPor: req.user.uid,
          usuarioActualizacion: req.user.nombreUsuario,
        },
        $push: {
          intentos: {
            numeroIntento,
            estado: "PROCESANDO",
            proveedor: "SMTP",
            fechaInicio: ahora,
          },
        },
      },
      { new: true },
    );

    if (!despachoProcesando) {
      const actual = await DespachoResultado.findById(despachoId).lean();
      return res.status(409).json({
        ok: false,
        codigo: "DESPACHO_EN_PROCESO",
        msg: `El despacho ya cambió a estado ${actual?.estadoDespacho ?? "desconocido"}`,
        despacho: actual ? serializarDespacho(actual) : null,
      });
    }

    const incluyeEnlace = ["ENLACE_SEGURO", "PDF_Y_ENLACE"].includes(
      despachoProcesando.modoContenido,
    );
    const incluyePdf = ["PDF_ADJUNTO", "PDF_Y_ENLACE"].includes(
      despachoProcesando.modoContenido,
    );

    let enlaceSeguro = null;
    if (incluyeEnlace) {
      const preparado = await prepararEnlaceSeguro({
        despacho: despachoProcesando,
        req,
      });
      enlaceSeguro = preparado.url;
    }

    const solicitudSnapshot = despachoProcesando.solicitudes?.[0];
    const respuestaCorreo = await enviarCorreoResultados({
      para: despachoProcesando.destinatario.correo,
      nombreDestinatario: despachoProcesando.destinatario.nombre,
      codigoLaboratorio: solicitudSnapshot?.codigoLaboratorio ?? "",
      cantidadResultados: resultadosVigentes.length,
      enlaceSeguro,
      pdf: incluyePdf
        ? {
            nombreArchivo: normalizarNombrePdf(req.file.originalname),
            buffer: req.file.buffer,
          }
        : null,
    });

    const fechaEnvio = new Date();
    const intentoActual = despachoProcesando.intentos.find(
      (intento) => Number(intento.numeroIntento) === numeroIntento,
    );

    if (intentoActual) {
      intentoActual.estado = "ENVIADO";
      intentoActual.proveedor = respuestaCorreo.proveedor;
      intentoActual.proveedorMensajeId = respuestaCorreo.mensajeId;
      intentoActual.codigoRespuesta = respuestaCorreo.respuesta;
      intentoActual.fechaFin = fechaEnvio;
    }

    despachoProcesando.estadoDespacho = "ENVIADO";
    despachoProcesando.fechaEnvio = fechaEnvio;
    despachoProcesando.fechaError = null;
    despachoProcesando.ultimoError = null;
    despachoProcesando.actualizadoPor = req.user.uid;
    despachoProcesando.usuarioActualizacion = req.user.nombreUsuario;
    await despachoProcesando.save();

    const entrega = await registrarEntregaDesdeDespacho(
      despachoProcesando,
      resultadosVigentes,
    );
    const despachoFinal = await DespachoResultado.findById(despachoId).lean();

    return res.status(200).json({
      ok: true,
      reutilizado: false,
      msg: "Resultados enviados por correo correctamente",
      entregaId: String(entrega._id),
      mensajeId: respuestaCorreo.mensajeId,
      despacho: serializarDespacho(despachoFinal),
    });
  } catch (error) {
    if (despachoProcesando && numeroIntento !== null) {
      try {
        const fechaError = new Date();
        const mensajeError = String(error?.message ?? "Error al enviar correo").slice(
          0,
          1000,
        );
        const intentoActual = despachoProcesando.intentos.find(
          (intento) => Number(intento.numeroIntento) === numeroIntento,
        );

        // Si SMTP ya confirmó el envío, no degradar a ERROR por una falla posterior.
        if (despachoProcesando.estadoDespacho !== "ENVIADO") {
          if (intentoActual) {
            intentoActual.estado = "ERROR";
            intentoActual.errorCodigo = String(error?.code ?? "ERROR_ENVIO");
            intentoActual.errorMensaje = mensajeError;
            intentoActual.fechaFin = fechaError;
          }

          despachoProcesando.estadoDespacho = "ERROR";
          despachoProcesando.fechaError = fechaError;
          despachoProcesando.ultimoError = mensajeError;
          await despachoProcesando.save();
        }
      } catch (errorRegistro) {
        console.error("No se pudo registrar el error del despacho:", errorRegistro);
      }
    }

    console.error("Error al enviar resultados por correo:", error);
    return res.status(error?.statusCode ?? 500).json({
      ok: false,
      codigo: error?.codigo ?? error?.code ?? "ERROR_ENVIO_CORREO",
      msg: error?.message || "No se pudieron enviar los resultados por correo",
    });
  }
};

// ====== Enviar WhatsApp automático ======
const enviarWhatsappDespacho = async (req, res = response) => {
  let despachoProcesando = null;
  let numeroIntento = null;

  try {
    const { despachoId } = req.params;

    if (!mongoose.isValidObjectId(despachoId)) {
      return res.status(400).json({ ok: false, msg: "Despacho inválido" });
    }

    const despachoInicial = await DespachoResultado.findById(despachoId);
    if (!despachoInicial) {
      return res.status(404).json({ ok: false, msg: "Despacho no encontrado" });
    }

    if (despachoInicial.canal !== "WHATSAPP") {
      return res.status(409).json({
        ok: false,
        msg: "El despacho indicado no corresponde al canal WHATSAPP",
      });
    }

    if (despachoInicial.modoContenido !== "ENLACE_SEGURO") {
      return res.status(409).json({
        ok: false,
        msg: "WhatsApp solo admite el enlace seguro al visor de resultados",
      });
    }

    // ====== Recuperar finalización sin reenviar ======
    if (["ENVIADO", "ENTREGADO", "LEIDO"].includes(despachoInicial.estadoDespacho)) {
      const resultados = await obtenerResultadosVigentesDespacho(despachoInicial);
      const entrega = await registrarEntregaDesdeDespacho(
        despachoInicial,
        resultados,
      );
      const actualizado = await DespachoResultado.findById(despachoId).lean();

      return res.status(200).json({
        ok: true,
        reutilizado: true,
        msg: "El WhatsApp ya había sido enviado; no se realizó un segundo envío",
        entregaId: String(entrega._id),
        despacho: serializarDespacho(actualizado),
      });
    }

    if (!["PENDIENTE", "ERROR"].includes(despachoInicial.estadoDespacho)) {
      return res.status(409).json({
        ok: false,
        codigo: "ESTADO_DESPACHO_INVALIDO",
        msg: `No se puede enviar un despacho en estado ${despachoInicial.estadoDespacho}`,
      });
    }

    const resultadosVigentes = await obtenerResultadosVigentesDespacho(
      despachoInicial,
    );
    const ahora = new Date();
    numeroIntento = Number(despachoInicial.intentos?.length ?? 0) + 1;

    despachoProcesando = await DespachoResultado.findOneAndUpdate(
      {
        _id: despachoId,
        estadoDespacho: { $in: ["PENDIENTE", "ERROR"] },
        canal: "WHATSAPP",
      },
      {
        $set: {
          estadoDespacho: "PROCESANDO",
          fechaInicioProcesamiento: ahora,
          fechaError: null,
          ultimoError: null,
          actualizadoPor: req.user.uid,
          usuarioActualizacion: req.user.nombreUsuario,
        },
        $push: {
          intentos: {
            numeroIntento,
            estado: "PROCESANDO",
            proveedor: "WHATSAPP_CLOUD_API",
            fechaInicio: ahora,
          },
        },
      },
      { new: true },
    );

    if (!despachoProcesando) {
      const actual = await DespachoResultado.findById(despachoId).lean();
      return res.status(409).json({
        ok: false,
        codigo: "DESPACHO_EN_PROCESO",
        msg: `El despacho ya cambió a estado ${actual?.estadoDespacho ?? "desconocido"}`,
        despacho: actual ? serializarDespacho(actual) : null,
      });
    }

    const preparado = await prepararEnlaceSeguro({
      despacho: despachoProcesando,
      req,
    });
    const solicitudSnapshot = despachoProcesando.solicitudes?.[0];

    const respuestaWhatsapp = await enviarWhatsappResultados({
      para: despachoProcesando.destinatario.telefono,
      nombreDestinatario: despachoProcesando.destinatario.nombre,
      codigoSolicitud: solicitudSnapshot?.codSolicitud ?? "",
      enlaceSeguro: preparado.url,
    });

    const fechaEnvio = new Date();
    const intentoActual = despachoProcesando.intentos.find(
      (intento) => Number(intento.numeroIntento) === numeroIntento,
    );

    if (intentoActual) {
      intentoActual.estado = "ENVIADO";
      intentoActual.proveedor = respuestaWhatsapp.proveedor;
      intentoActual.proveedorMensajeId = respuestaWhatsapp.mensajeId;
      intentoActual.codigoRespuesta = respuestaWhatsapp.respuesta;
      intentoActual.fechaFin = fechaEnvio;
    }

    despachoProcesando.estadoDespacho = "ENVIADO";
    despachoProcesando.fechaEnvio = fechaEnvio;
    despachoProcesando.fechaError = null;
    despachoProcesando.ultimoError = null;
    despachoProcesando.actualizadoPor = req.user.uid;
    despachoProcesando.usuarioActualizacion = req.user.nombreUsuario;
    await despachoProcesando.save();

    const entrega = await registrarEntregaDesdeDespacho(
      despachoProcesando,
      resultadosVigentes,
    );
    const despachoFinal = await DespachoResultado.findById(despachoId).lean();

    return res.status(200).json({
      ok: true,
      reutilizado: false,
      msg: "Enlace de resultados enviado por WhatsApp correctamente",
      entregaId: String(entrega._id),
      mensajeId: respuestaWhatsapp.mensajeId,
      despacho: serializarDespacho(despachoFinal),
    });
  } catch (error) {
    if (despachoProcesando && numeroIntento !== null) {
      try {
        const fechaError = new Date();
        const mensajeError = String(
          error?.message ?? "Error al enviar WhatsApp",
        ).slice(0, 1000);
        const intentoActual = despachoProcesando.intentos.find(
          (intento) => Number(intento.numeroIntento) === numeroIntento,
        );

        if (despachoProcesando.estadoDespacho !== "ENVIADO") {
          if (intentoActual) {
            intentoActual.estado = "ERROR";
            intentoActual.errorCodigo = String(error?.code ?? "ERROR_ENVIO");
            intentoActual.errorMensaje = mensajeError;
            intentoActual.fechaFin = fechaError;
          }

          despachoProcesando.estadoDespacho = "ERROR";
          despachoProcesando.fechaError = fechaError;
          despachoProcesando.ultimoError = mensajeError;
          await despachoProcesando.save();
        }
      } catch (errorRegistro) {
        console.error("No se pudo registrar el error de WhatsApp:", errorRegistro);
      }
    }

    console.error("Error al enviar resultados por WhatsApp:", error);
    return res.status(error?.statusCode ?? 500).json({
      ok: false,
      codigo: error?.codigo ?? error?.code ?? "ERROR_ENVIO_WHATSAPP",
      msg: error?.message || "No se pudieron enviar los resultados por WhatsApp",
    });
  }
};

// ====== Acceso público al visor por token ======
const accederInformeDespacho = async (req, res = response) => {
  let despachoAcceso = null;

  try {
    const token = String(req.body?.token ?? "").trim();

    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(404).json({ ok: false, msg: "Enlace no válido" });
    }

    const despacho = await DespachoResultado.findOne({
      "recursoDigital.tokenAccesoHash": construirHashToken(token),
      "recursoDigital.estadoAcceso": { $ne: "REVOCADO" },
      estadoDespacho: { $in: ESTADOS_ACCESO_DIGITAL },
    });
    despachoAcceso = despacho;

    if (!despacho?.recursoDigital?.tokenAccesoHash) {
      return res.status(404).json({ ok: false, msg: "Enlace no disponible" });
    }

    if (
      despacho.recursoDigital.vigencia === "TEMPORAL" &&
      despacho.recursoDigital.fechaExpiracionAcceso &&
      despacho.recursoDigital.fechaExpiracionAcceso.getTime() <= Date.now()
    ) {
      return res.status(410).json({
        ok: false,
        codigo: "ENLACE_VENCIDO",
        msg: "Este enlace seguro ha vencido",
      });
    }

    const solicitudSnapshot = despacho.solicitudes?.[0];
    const informe = await construirInformeEntregableSeleccionado({
      solicitudAtencionId: solicitudSnapshot?.solicitudAtencionId,
      resultadosEsperados: solicitudSnapshot?.resultados ?? [],
    });

    const ahora = new Date();
    const set = {
      "recursoDigital.fechaUltimoAcceso": ahora,
      actualizadoPor: "ACCESO_ENLACE",
      usuarioActualizacion: "ACCESO_ENLACE",
    };

    if (!despacho.recursoDigital.fechaPrimerAcceso) {
      set["recursoDigital.fechaPrimerAcceso"] = ahora;
    }

    if (!despacho.fechaLectura) {
      set.fechaLectura = ahora;
    }

    if (["ENVIADO", "ENTREGADO"].includes(despacho.estadoDespacho)) {
      set.estadoDespacho = "LEIDO";
    }

    await DespachoResultado.updateOne(
      { _id: despacho._id },
      {
        $set: set,
        $inc: { "recursoDigital.cantidadAccesos": 1 },
      },
    );

    return res.json({
      ok: true,
      informe: sanitizarInformePublico(informe),
      acceso: {
        fechaEnvio: despacho.fechaEnvio ?? null,
        canal: despacho.canal,
        modoContenido: despacho.modoContenido,
      },
    });
  } catch (error) {
    if (error?.codigo === "INFORME_REEMPLAZADO") {
      if (despachoAcceso?._id) {
        await DespachoResultado.updateOne(
          { _id: despachoAcceso._id },
          {
            $set: {
              "recursoDigital.estadoAcceso": "REVOCADO",
              "recursoDigital.fechaRevocacion": new Date(),
              "recursoDigital.motivoRevocacion": "El resultado fue reemplazado por una versión posterior",
              actualizadoPor: "ACCESO_ENLACE",
              usuarioActualizacion: "ACCESO_ENLACE",
            },
          },
        ).catch((errorRevocacion) =>
          console.error("No se pudo revocar enlace reemplazado:", errorRevocacion),
        );
      }

      return res.status(410).json({
        ok: false,
        codigo: error.codigo,
        msg: error.message,
      });
    }

    console.error("Error al abrir visor seguro de resultados:", error);
    return res.status(500).json({
      ok: false,
      msg: "No se pudo consultar el informe",
    });
  }
};

// ====== Revocar enlace público ======
const revocarAccesoDespacho = async (req, res = response) => {
  try {
    const { despachoId } = req.params;
    const motivo = String(req.body?.motivo ?? "").trim();

    if (!mongoose.isValidObjectId(despachoId)) {
      return res.status(400).json({ ok: false, msg: "Despacho inválido" });
    }

    if (!motivo || motivo.length > 500) {
      return res.status(400).json({
        ok: false,
        msg: "Debe indicar un motivo de revocación válido",
      });
    }

    const despacho = await DespachoResultado.findById(despachoId);
    if (!despacho) {
      return res.status(404).json({ ok: false, msg: "Despacho no encontrado" });
    }

    if (!despacho.recursoDigital?.tokenAccesoHash) {
      return res.status(409).json({
        ok: false,
        msg: "El despacho no tiene un enlace público activo",
      });
    }

    despacho.recursoDigital.estadoAcceso = "REVOCADO";
    despacho.recursoDigital.fechaRevocacion = new Date();
    despacho.recursoDigital.motivoRevocacion = motivo;
    despacho.actualizadoPor = req.user.uid;
    despacho.usuarioActualizacion = req.user.nombreUsuario;
    await despacho.save();

    return res.json({
      ok: true,
      msg: "Enlace revocado correctamente",
      despacho: serializarDespacho(despacho.toObject()),
    });
  } catch (error) {
    console.error("Error al revocar enlace de resultados:", error);
    return res.status(500).json({
      ok: false,
      msg: "No se pudo revocar el enlace",
    });
  }
};

// ====== Listar despachos de solicitud ======
const obtenerDespachosSolicitud = async (req, res = response) => {
  try {
    const { solicitudAtencionId } = req.params;

    if (!mongoose.isValidObjectId(solicitudAtencionId)) {
      return res.status(400).json({ ok: false, msg: "Solicitud inválida" });
    }

    const despachos = await DespachoResultado.find({
      "solicitudes.solicitudAtencionId": solicitudAtencionId,
    })
      .sort({ fechaSolicitud: -1 })
      .limit(100)
      .lean();

    return res.json({
      ok: true,
      total: despachos.length,
      despachos: despachos.map(serializarDespacho),
    });
  } catch (error) {
    console.error("Error al consultar despachos de resultados:", error);
    return res.status(500).json({
      ok: false,
      msg: "No se pudieron consultar los despachos de resultados",
    });
  }
};

// ====== Obtener despacho ======
const obtenerDespachoPorId = async (req, res = response) => {
  try {
    const { despachoId } = req.params;

    if (!mongoose.isValidObjectId(despachoId)) {
      return res.status(400).json({ ok: false, msg: "Despacho inválido" });
    }

    const despacho = await DespachoResultado.findById(despachoId).lean();

    if (!despacho) {
      return res.status(404).json({ ok: false, msg: "Despacho no encontrado" });
    }

    return res.json({ ok: true, despacho: serializarDespacho(despacho) });
  } catch (error) {
    console.error("Error al consultar despacho de resultados:", error);
    return res.status(500).json({
      ok: false,
      msg: "No se pudo consultar el despacho de resultados",
    });
  }
};

// ====== Cancelar despacho pendiente / con error ======
const cancelarDespacho = async (req, res = response) => {
  try {
    const { despachoId } = req.params;
    const motivo = String(req.body?.motivo ?? "").trim();

    if (!mongoose.isValidObjectId(despachoId)) {
      return res.status(400).json({ ok: false, msg: "Despacho inválido" });
    }

    if (!motivo || motivo.length > 500) {
      return res.status(400).json({
        ok: false,
        msg: "Debe indicar un motivo de cancelación válido",
      });
    }

    const despacho = await DespachoResultado.findById(despachoId);

    if (!despacho) {
      return res.status(404).json({ ok: false, msg: "Despacho no encontrado" });
    }

    if (!puedeTransicionarDespacho(despacho.estadoDespacho, "CANCELADO")) {
      return res.status(409).json({
        ok: false,
        codigo: "ESTADO_DESPACHO_INVALIDO",
        msg: `No se puede cancelar un despacho en estado ${despacho.estadoDespacho}`,
      });
    }

    despacho.estadoDespacho = "CANCELADO";
    despacho.fechaCancelacion = new Date();
    despacho.motivoCancelacion = motivo;
    despacho.actualizadoPor = req.user.uid;
    despacho.usuarioActualizacion = req.user.nombreUsuario;

    await despacho.save();

    return res.json({
      ok: true,
      msg: "Despacho cancelado correctamente",
      despacho: serializarDespacho(despacho.toObject()),
    });
  } catch (error) {
    console.error("Error al cancelar despacho de resultados:", error);
    return res.status(500).json({
      ok: false,
      msg: "No se pudo cancelar el despacho de resultados",
    });
  }
};

module.exports = {
  crearDespachoSolicitud,
  enviarCorreoDespacho,
  enviarWhatsappDespacho,
  accederInformeDespacho,
  revocarAccesoDespacho,
  obtenerDespachosSolicitud,
  obtenerDespachoPorId,
  cancelarDespacho,
};
