const { response } = require("express");
const mongoose = require("mongoose");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");
const EntregaResultado = require("../../models/Gestion/EntregaResultadoLaboratorio");

// ====== Preparar datos del paciente ======
const construirPaciente = (solicitud) => {
  const origen = solicitud.programacionEmpresaId &&
    typeof solicitud.programacionEmpresaId === "object"
    ? solicitud.programacionEmpresaId
    : solicitud;
  const nombre = [
    origen.nombreCliente || solicitud.nombreCliente,
    origen.apePatCliente || solicitud.apePatCliente,
    origen.apeMatCliente || solicitud.apeMatCliente,
  ].filter(Boolean).join(" ");

  return {
    pacienteId: String(origen.pacienteId || solicitud.clienteId || "") || null,
    nombreCompleto: nombre.trim(),
    hc: origen.hc || solicitud.hc || "",
    documento: [origen.tipoDoc || solicitud.tipoDoc, origen.nroDoc || solicitud.nroDoc]
      .filter(Boolean).join(" "),
    sexo: solicitud.sexoPaciente || null,
    fechaNacimiento: solicitud.fechaNacimientoPaciente || null,
  };
};


// ====== Obtener configuración clínica de una unidad ======
const obtenerUnidadInforme = (solicitud, claveUnidad) =>
  (solicitud.unidadesLaboratorio || []).find(
    (unidad) => String(unidad?.claveUnidad || "") === String(claveUnidad || ""),
  ) || null;

// ====== Serializar referencia configurada ======
const serializarReferenciaInforme = (referencia) => ({
  descripcion: referencia?.descripcion || "",
  sexo: referencia?.sexo || "TODOS",
  edadMin: referencia?.edadMin ?? null,
  edadMax: referencia?.edadMax ?? null,
  unidadEdad: referencia?.unidadEdad || "ANIOS",
  tipoReferencia: referencia?.tipoReferencia || null,
  valorMin: referencia?.valorMin ?? null,
  valorMax: referencia?.valorMax ?? null,
  valorLimite: referencia?.valorLimite ?? null,
  valoresPermitidos: Array.isArray(referencia?.valoresPermitidos)
    ? referencia.valoresPermitidos
    : [],
  textoReferencia: referencia?.textoReferencia || "",
});

// ====== Resolver snapshot histórico del Item ======
const obtenerSnapshotItemInforme = (unidad, itemResultado) => {
  const grupos = Array.isArray(unidad?.snapshotClinico?.gruposResultado)
    ? unidad.snapshotClinico.gruposResultado
    : [];

  const grupo = grupos[itemResultado?.indiceGrupo];
  const itemPorIndice = Array.isArray(grupo?.items)
    ? grupo.items[itemResultado?.indiceItem]
    : null;

  if (itemPorIndice?.snapshotItem) {
    return itemPorIndice.snapshotItem;
  }

  const itemLabId = String(itemResultado?.itemLabId || "");
  if (!itemLabId) {
    return null;
  }

  for (const grupoActual of grupos) {
    for (const itemActual of grupoActual?.items || []) {
      if (String(itemActual?.itemLabId || "") === itemLabId) {
        return itemActual?.snapshotItem || null;
      }
    }
  }

  return null;
};

// ====== Preparar configuración clínica del informe ======
const construirConfiguracionInforme = (solicitud, resultado) => {
  const unidad = obtenerUnidadInforme(solicitud, resultado.claveUnidad);

  const items = (resultado.resultadosItems || []).map((item) => {
    const snapshotItem = obtenerSnapshotItemInforme(unidad, item);
    const referenciasConfiguradas = Array.isArray(snapshotItem?.referenciasResultado)
      ? snapshotItem.referenciasResultado
          .filter((referencia) => referencia?.activo !== false)
          .map(serializarReferenciaInforme)
      : [];

    return {
      nombreInforme: item.nombreInforme,
      codItemLab: item.codItemLab,
      metodo: String(snapshotItem?.metodoItemLab || "").trim() || null,
      valor: item.valor,
      unidadesRef: item.unidadesRef,
      observacion: item.observacion,
      evaluacionReferencia: item.evaluacionReferencia,
      alertasDetectadas: item.alertasDetectadas,
      ordenGrupo: item.ordenGrupo,
      ordenItem: item.ordenItem,
      referenciasConfiguradas,
    };
  });

  return { items };
};

// ====== Calcular disponibilidad, sin confundirla con entrega ======
const calcularResumen = (solicitud, resultados) => {
  const activos = resultados.filter((r) => r.estadoResultado !== "ANULADO");
  const liberados = activos.filter((r) => r.estadoResultado === "LIBERADO");
  const unidadesActivas = (solicitud.unidadesLaboratorio || []).filter(
    (u) => u.estado !== "ANULADO",
  ).length;
  const total = Math.max(unidadesActivas, activos.length);

  return {
    totalPruebas: total,
    liberados: liberados.length,
    pendientes: Math.max(0, total - liberados.length),
    tipoDisponibilidad: liberados.length === 0
      ? "SIN_VIGENTES"
      : liberados.length === total ? "COMPLETA" : "PARCIAL",
  };
};

// ====== Consulta de solicitudes con resultados entregables ======
const obtenerBandejaEntregaResultados = async (req, res = response) => {
  try {
    const { fechaInicio, fechaFin, terminoBusqueda = "" } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ ok: false, msg: "Debe indicar ambas fechas" });
    }
    const desde = new Date(`${fechaInicio}T00:00:00.000Z`);
    const hasta = new Date(`${fechaFin}T23:59:59.999Z`);
    if (!Number.isFinite(desde.getTime()) || !Number.isFinite(hasta.getTime()) ||
        desde > hasta || (hasta - desde) > 1000 * 60 * 60 * 24 * 93) {
      return res.status(400).json({ ok: false, msg: "Rango de fechas inválido (máximo 93 días)" });
    }

    const solicitudes = await SolicitudAtencion.find({
      tipo: "Laboratorio",
      fechaEmision: { $gte: desde, $lte: hasta },
    })
      .select("_id codSolicitud codigoLaboratorio origenAtencion estado fechaEmision unidadesLaboratorio hc clienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoPaciente fechaNacimientoPaciente programacionEmpresaId")
      .populate("programacionEmpresaId", "hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente")
      .sort({ fechaEmision: -1 })
      .limit(500)
      .lean();

    if (!solicitudes.length) {
      return res.json({ ok: true, bandeja: [], total: 0 });
    }

    const idsSolicitudes = solicitudes.map((s) => s._id);
    const [entregasPrevias, resultados] = await Promise.all([
      EntregaResultado.distinct("solicitudAtencionId", {
        solicitudAtencionId: { $in: idsSolicitudes },
      }),
      ResultadoLaboratorio.find({
        solicitudAtencionId: { $in: idsSolicitudes },
      })
        .select("solicitudAtencionId estadoResultado")
        .lean(),
    ]);
    const conEntregasPrevias = new Set(entregasPrevias.map(String));



    const porSolicitud = new Map();
    for (const resultado of resultados) {
      const clave = String(resultado.solicitudAtencionId);
      if (!porSolicitud.has(clave)) porSolicitud.set(clave, []);
      porSolicitud.get(clave).push(resultado);
    }

    const filtro = String(terminoBusqueda).trim().toLocaleLowerCase("es");
    const bandeja = solicitudes.flatMap((solicitud) => {
      const resumen = calcularResumen(
        solicitud,
        porSolicitud.get(String(solicitud._id)) || [],
      );
      const tieneHistorial = conEntregasPrevias.has(String(solicitud._id));
      if (!resumen.liberados && !tieneHistorial) return [];
      const paciente = construirPaciente(solicitud);
      const fila = {
        solicitudAtencionId: String(solicitud._id),
        codSolicitud: solicitud.codSolicitud,
        codigoLaboratorio: solicitud.codigoLaboratorio || "",
        fechaEmision: solicitud.fechaEmision,
        origenAtencion: solicitud.origenAtencion,
        paciente,
        resumen,
        tieneHistorial,
      };
      if (filtro && ![
        fila.codSolicitud,
        fila.codigoLaboratorio,
        paciente.nombreCompleto,
        paciente.documento,
        paciente.hc,
      ].some((dato) => String(dato || "").toLocaleLowerCase("es").includes(filtro))) {
        return [];
      }
      return [fila];
    });

    return res.json({ ok: true, bandeja, total: bandeja.length });
  } catch (error) {
    console.error("Error de bandeja de entrega:", error);
    return res.status(500).json({ ok: false, msg: "No se pudo consultar la bandeja de entregas" });
  }
};

// ====== Informe vigente con solo pruebas LIBERADAS ======
const obtenerInformeEntregable = async (req, res = response) => {
  try {
    const { solicitudAtencionId } = req.params;
    if (!mongoose.isValidObjectId(solicitudAtencionId)) {
      return res.status(400).json({ ok: false, msg: "Id de solicitud inválido" });
    }
    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .select("codSolicitud codigoLaboratorio origenAtencion fechaEmision unidadesLaboratorio hc clienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sexoPaciente fechaNacimientoPaciente programacionEmpresaId tipo")
      .populate("programacionEmpresaId", "hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente")
      .lean();
    if (!solicitud || solicitud.tipo !== "Laboratorio") {
      return res.status(404).json({ ok: false, msg: "Solicitud no encontrada" });
    }
    const todos = await ResultadoLaboratorio.find({ solicitudAtencionId })
      .select("estadoResultado")
      .lean();
    const resumen = calcularResumen(solicitud, todos);
    const liberados = await ResultadoLaboratorio.find({
      solicitudAtencionId,
      estadoResultado: "LIBERADO",
    })
      .select("_id claveUnidad codPruebaLab nombrePruebaLab numeroInstancia etiquetaInstancia versionResultado fechaValidacion fechaLiberacion usuarioLiberacion observacionGeneral resultadosItems")
      .sort({ numeroInstancia: 1, createdAt: 1 })
      .lean();

    // ====== Preparar informe con snapshot clínico histórico ======
    const resultados = liberados.map((resultado) => {
      const configuracion = construirConfiguracionInforme(solicitud, resultado);

      return {
        _id: String(resultado._id),
        codPruebaLab: resultado.codPruebaLab,
        nombrePruebaLab: resultado.nombrePruebaLab,
        numeroInstancia: resultado.numeroInstancia,
        etiquetaInstancia: resultado.etiquetaInstancia,
        versionResultado: resultado.versionResultado || 1,
        fechaValidacion: resultado.fechaValidacion,
        fechaLiberacion: resultado.fechaLiberacion,
        usuarioLiberacion: resultado.usuarioLiberacion,
        observacionGeneral: resultado.observacionGeneral,
        items: configuracion.items,
      };
    });
    const entregas = await EntregaResultado.find({ solicitudAtencionId })
      .select("tipoEntrega medio receptorNombre fechaEntrega usuarioEntrega resultados")
      .sort({ fechaEntrega: -1 })
      .limit(50)
      .lean();

    return res.json({
      ok: true,
      solicitud: {
        solicitudAtencionId: String(solicitud._id),
        codSolicitud: solicitud.codSolicitud,
        codigoLaboratorio: solicitud.codigoLaboratorio,
        fechaEmision: solicitud.fechaEmision,
        fechaAtencion: solicitud.fechaEmision,
        origenAtencion: solicitud.origenAtencion,
        paciente: construirPaciente(solicitud),
      },
      resumen,
      resultados,
      entregas: entregas.map((entrega) => ({
        _id: String(entrega._id),
        tipoEntrega: entrega.tipoEntrega,
        medio: entrega.medio,
        receptorNombre: entrega.receptorNombre,
        fechaEntrega: entrega.fechaEntrega,
        usuarioEntrega: entrega.usuarioEntrega,
        pruebasEntregadas: entrega.resultados.length,
      })),
    });
  } catch (error) {
    console.error("Error de informe entregable:", error);
    return res.status(500).json({ ok: false, msg: "No se pudo obtener el informe" });
  }
};

// ====== Registrar entrega sin alterar estados clínicos ======
const registrarEntregaResultados = async (req, res = response) => {
  try {
    const { solicitudAtencionId } = req.params;
    const {
      resultadosIds,
      receptorNombre = "",
      medio = "PRESENCIAL",
      observacion = "",
    } = req.body || {};

    if (!mongoose.isValidObjectId(solicitudAtencionId)) {
      return res.status(400).json({ ok: false, msg: "Solicitud inválida" });
    }

    if (
      !Array.isArray(resultadosIds) ||
      !resultadosIds.length ||
      resultadosIds.length > 100 ||
      !resultadosIds.every((id) => mongoose.isValidObjectId(id)) ||
      String(receptorNombre || "").length > 180 ||
      !["PRESENCIAL", "WHATSAPP", "CORREO", "OTRO"].includes(medio) ||
      String(observacion || "").length > 1000
    ) {
      return res.status(400).json({
        ok: false,
        msg: "Datos de entrega incompletos o inválidos",
      });
    }
    const ids = [...new Set(resultadosIds.map(String))];
    if (ids.length !== resultadosIds.length) {
      return res.status(400).json({ ok: false, msg: "No se permiten pruebas duplicadas" });
    }

    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .populate(
        "programacionEmpresaId",
        "hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente",
      )
      .lean();

    if (!solicitud || solicitud.tipo !== "Laboratorio") {
      return res.status(404).json({ ok: false, msg: "Solicitud no encontrada" });
    }
    if (solicitud.estado === "ANULADO") {
      return res.status(409).json({
        ok: false,
        codigo: "SOLICITUD_ANULADA",
        msg: "No se pueden registrar nuevas entregas de una solicitud anulada",
      });
    }
    const [todos, liberados] = await Promise.all([
      ResultadoLaboratorio.find({ solicitudAtencionId })
        .select("estadoResultado")
        .lean(),
      ResultadoLaboratorio.find({
        solicitudAtencionId,
        _id: { $in: ids },
        estadoResultado: "LIBERADO",
      }).lean(),
    ]);
    if (liberados.length !== ids.length) {
      return res.status(409).json({
        ok: false,
        codigo: "RESULTADO_NO_LIBERADO",
        msg: "Algún resultado seleccionado ya no está liberado. Actualice el informe.",
      });
    }
    const resumen = calcularResumen(solicitud, todos);
    const tipoEntrega = ids.length === resumen.totalPruebas &&
      resumen.totalPruebas > 0 ? "FINAL" : "PARCIAL";

    // ====== Congelar versión de los resultados entregados ======
    const snapshots = liberados.map((resultado) => ({
      resultadoLaboratorioId: String(resultado._id),
      codPruebaLab: resultado.codPruebaLab,
      nombrePruebaLab: resultado.nombrePruebaLab,
      versionResultado: resultado.versionResultado || 1,
      fechaLiberacion: resultado.fechaLiberacion,
      resultadosItems: (resultado.resultadosItems || []).map((item) => ({
        nombreInforme: item.nombreInforme,
        valor: item.valor,
        unidadesRef: item.unidadesRef,
        evaluacionReferencia: item.evaluacionReferencia,
        alertasDetectadas: item.alertasDetectadas,
      })),
    }));

    const receptorFinal =
      String(receptorNombre || "").trim() ||
      construirPaciente(solicitud).nombreCompleto ||
      "PACIENTE";

    const entrega = await EntregaResultado.create({
      solicitudAtencionId,
      codSolicitud: solicitud.codSolicitud,
      codigoLaboratorio: solicitud.codigoLaboratorio || "",
      tipoEntrega,
      medio,
      receptorNombre: receptorFinal,
      observacion: String(observacion || "").trim(),
      resultados: snapshots,
      totalPruebasActivas: resumen.totalPruebas,
      entregadoPor: req.user.uid,
      usuarioEntrega: req.user.nombreUsuario,
    });
    return res.status(201).json({
      ok: true,
      msg: `Entrega ${tipoEntrega.toLowerCase()} registrada correctamente`,
      entregaId: entrega._id,
      tipoEntrega,
      pruebasEntregadas: snapshots.length,
      fechaEntrega: entrega.fechaEntrega,
    });
  } catch (error) {
    console.error("Error al registrar entrega:", error);
    return res.status(500).json({ ok: false, msg: "No se pudo registrar la entrega" });
  }
};

module.exports = {
  obtenerBandejaEntregaResultados,
  obtenerInformeEntregable,
  registrarEntregaResultados,
};
