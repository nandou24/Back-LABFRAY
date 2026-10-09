const { response } = require("express");
const mongoose = require("mongoose");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");
const EntregaResultado = require("../../models/Gestion/EntregaResultadoLaboratorio");
const MuestraLaboratorio = require("../../models/Gestion/MuestraLaboratorio");

// ====== Rango operativo de fechas en hora Perú ======

const OFFSET_HORARIO_PERU = "-05:00";

const construirLimiteFechaOperativa = (fecha, finDia = false) => {
  const texto = String(fecha ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return null;
  }

  const [anio, mes, dia] = texto.split("-").map(Number);
  const comprobacion = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    comprobacion.getUTCFullYear() !== anio ||
    comprobacion.getUTCMonth() !== mes - 1 ||
    comprobacion.getUTCDate() !== dia
  ) {
    return null;
  }

  const hora = finDia ? "23:59:59.999" : "00:00:00.000";
  const limite = new Date(`${texto}T${hora}${OFFSET_HORARIO_PERU}`);

  return Number.isFinite(limite.getTime()) ? limite : null;
};

// ====== Omitir Items opcionales sin resultado ======
const esValorResultadoVacio = (valor) =>
  valor === null ||
  valor === undefined ||
  (typeof valor === "string" && valor.trim() === "");

const obtenerItemsEntregables = (items = []) =>
  (Array.isArray(items) ? items : []).filter(
    (item) => !(item?.esOpcional === true && esValorResultadoVacio(item?.valor)),
  );

// ====== Resolver configuración histórica para informe ======
const obtenerMetadataItemInforme = ({ solicitud, resultado, item }) => {
  const unidades = Array.isArray(solicitud?.unidadesLaboratorio)
    ? solicitud.unidadesLaboratorio
    : [];

  const unidad = unidades.find(
    (unidadActual) => String(unidadActual?.claveUnidad ?? "") === String(resultado?.claveUnidad ?? ""),
  );

  const grupos = Array.isArray(unidad?.snapshotClinico?.gruposResultado)
    ? unidad.snapshotClinico.gruposResultado
    : [];
  const grupo = grupos[Number(item?.indiceGrupo ?? -1)] ?? null;
  const itemsGrupo = Array.isArray(grupo?.items) ? grupo.items : [];
  const itemSnapshot = itemsGrupo[Number(item?.indiceItem ?? -1)]?.snapshotItem ?? null;

  const mostrarReferenciaInforme =
    typeof item?.mostrarReferenciaInforme === "boolean"
      ? item.mostrarReferenciaInforme
      : itemSnapshot?.mostrarReferenciaInforme !== false;

  return {
    tipoResultado: itemSnapshot?.tipoResultado ?? item?.tipoResultado ?? "TEXTO",
    metodo: String(itemSnapshot?.metodoItemLab ?? "").trim() || null,
    nombreGrupo: String(grupo?.nombreGrupo ?? item?.nombreGrupo ?? "").trim(),
    comentarioReferenciaGrupo:
      String(grupo?.comentarioReferenciaGrupo ?? "").trim() || null,
    mostrarReferenciaInforme,
    hallazgosNormales: Array.isArray(
      itemSnapshot?.configuracionEstructurada?.hallazgosNormales,
    )
      ? [...itemSnapshot.configuracionEstructurada.hallazgosNormales]
      : [],
    referenciasConfiguradas: Array.isArray(itemSnapshot?.referenciasResultado)
      ? itemSnapshot.referenciasResultado
          .filter((referencia) => referencia?.activo !== false)
          .map((referencia) => ({
            descripcion: referencia.descripcion ?? "",
            sexo: referencia.sexo ?? "TODOS",
            edadMin: referencia.edadMin ?? null,
            edadMax: referencia.edadMax ?? null,
            unidadEdad: referencia.unidadEdad ?? "ANIOS",
            tipoReferencia: referencia.tipoReferencia ?? null,
            valorMin: referencia.valorMin ?? null,
            valorMax: referencia.valorMax ?? null,
            valorLimite: referencia.valorLimite ?? null,
            valoresPermitidos: Array.isArray(referencia.valoresPermitidos)
              ? [...referencia.valoresPermitidos]
              : [],
            textoReferencia: referencia.textoReferencia ?? "",
          }))
      : [],
  };
};

// ====== Tipos de muestra realmente utilizados por unidad ======
const construirMuestrasPorUnidad = (muestras = []) => {
  const mapa = new Map();

  for (const muestra of Array.isArray(muestras) ? muestras : []) {
    const nombreMuestra = String(
      muestra?.tipoMuestra?.nombreTipoMuestra ?? "",
    ).trim();

    if (!nombreMuestra) continue;

    for (const cobertura of Array.isArray(muestra?.coberturas)
      ? muestra.coberturas
      : []) {
      const claveUnidad = String(cobertura?.claveUnidad ?? "").trim();
      if (!claveUnidad) continue;

      if (!mapa.has(claveUnidad)) {
        mapa.set(claveUnidad, new Set());
      }

      mapa.get(claveUnidad).add(nombreMuestra);
    }
  }

  return new Map(
    [...mapa.entries()].map(([claveUnidad, valores]) => [
      claveUnidad,
      [...valores].sort((a, b) => a.localeCompare(b, "es")),
    ]),
  );
};

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
  };
};

// ====== Preparar contexto corporativo ======
const construirEmpresa = (solicitud) => {
  if (solicitud.origenAtencion !== "EMPRESA") {
    return null;
  }

  const programacion =
    solicitud.programacionEmpresaId &&
    typeof solicitud.programacionEmpresaId === "object"
      ? solicitud.programacionEmpresaId
      : null;

  return {
    programacionEmpresaId: String(
      programacion?._id ?? solicitud.programacionEmpresaId ?? "",
    ) || null,
    codProgramacion:
      programacion?.codProgramacion ?? solicitud.codProgramacion ?? null,
    empresaId: String(programacion?.empresaId ?? solicitud.empresaId ?? "") || null,
    rucEmpresa: programacion?.rucEmpresa ?? null,
    razonSocialEmpresa:
      programacion?.razonSocialEmpresa ?? solicitud.razonSocialEmpresa ?? "",
    sede: programacion?.sede ?? null,
    prioridad: programacion?.prioridad ?? null,
    protocoloId: String(solicitud.protocoloId ?? "") || null,
    codProtocolo: solicitud.codProtocolo ?? null,
    nombreProtocolo: solicitud.nombreProtocolo ?? null,
  };
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
    const { fechaInicio, fechaFin, terminoBusqueda = "", empresaId = "" } = req.query;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ ok: false, msg: "Debe indicar ambas fechas" });
    }
    // ====== Interpretar el rango como día calendario de Perú ======
    const desde = construirLimiteFechaOperativa(fechaInicio, false);
    const hasta = construirLimiteFechaOperativa(fechaFin, true);

    if (!desde || !hasta ||
        desde > hasta || (hasta - desde) > 1000 * 60 * 60 * 24 * 93) {
      return res.status(400).json({ ok: false, msg: "Rango de fechas inválido (máximo 93 días)" });
    }

    const empresaFiltro = String(empresaId ?? "").trim();

    if (empresaFiltro && !mongoose.isValidObjectId(empresaFiltro)) {
      return res.status(400).json({ ok: false, msg: "Empresa inválida" });
    }

    const filtroSolicitudes = {
      tipo: "Laboratorio",
      fechaEmision: { $gte: desde, $lte: hasta },
      ...(empresaFiltro
        ? {
            origenAtencion: "EMPRESA",
            empresaId: empresaFiltro,
          }
        : {}),
    };

    const solicitudes = await SolicitudAtencion.find(filtroSolicitudes)
      .select([
        "_id",
        "codSolicitud",
        "codigoLaboratorio",
        "origenAtencion",
        "estado",
        "fechaEmision",
        "unidadesLaboratorio",
        "hc",
        "clienteId",
        "tipoDoc",
        "nroDoc",
        "nombreCliente",
        "apePatCliente",
        "apeMatCliente",
        "programacionEmpresaId",
        "codProgramacion",
        "empresaId",
        "razonSocialEmpresa",
        "protocoloId",
        "codProtocolo",
        "nombreProtocolo",
      ].join(" "))
      .populate(
        "programacionEmpresaId",
        "_id codProgramacion empresaId rucEmpresa razonSocialEmpresa hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sede prioridad",
      )
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
      const empresa = construirEmpresa(solicitud);
      const fila = {
        solicitudAtencionId: String(solicitud._id),
        codSolicitud: solicitud.codSolicitud,
        codigoLaboratorio: solicitud.codigoLaboratorio || "",
        fechaEmision: solicitud.fechaEmision,
        origenAtencion: solicitud.origenAtencion,
        paciente,
        empresa,
        resumen,
        tieneHistorial,
      };
      if (filtro && ![
        fila.codSolicitud,
        fila.codigoLaboratorio,
        paciente.nombreCompleto,
        paciente.documento,
        paciente.hc,
        empresa?.codProgramacion,
        empresa?.razonSocialEmpresa,
        empresa?.rucEmpresa,
        empresa?.codProtocolo,
        empresa?.nombreProtocolo,
        empresa?.sede,
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
      .select([
        "codSolicitud",
        "codigoLaboratorio",
        "origenAtencion",
        "fechaEmision",
        "unidadesLaboratorio",
        "hc",
        "clienteId",
        "tipoDoc",
        "nroDoc",
        "nombreCliente",
        "apePatCliente",
        "apeMatCliente",
        "programacionEmpresaId",
        "codProgramacion",
        "empresaId",
        "razonSocialEmpresa",
        "protocoloId",
        "codProtocolo",
        "nombreProtocolo",
        "tipo",
      ].join(" "))
      .populate(
        "programacionEmpresaId",
        "_id codProgramacion empresaId rucEmpresa razonSocialEmpresa hc pacienteId tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente sede prioridad",
      )
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

    const muestrasAceptadas = await MuestraLaboratorio.find({
      solicitudAtencionId,
      estadoMuestra: "ACEPTADA",
    })
      .select("tipoMuestra coberturas.claveUnidad")
      .lean();

    const muestrasPorUnidad = construirMuestrasPorUnidad(muestrasAceptadas);

    // ====== No enviar información interna del laboratorio ======
    const resultados = liberados.map((resultado) => ({
      _id: String(resultado._id),
      codPruebaLab: resultado.codPruebaLab,
      nombrePruebaLab: resultado.nombrePruebaLab,
      numeroInstancia: resultado.numeroInstancia,
      etiquetaInstancia: resultado.etiquetaInstancia,
      versionResultado: resultado.versionResultado || 1,
      fechaValidacion: resultado.fechaValidacion ?? null,
      fechaLiberacion: resultado.fechaLiberacion,
      usuarioLiberacion: resultado.usuarioLiberacion,
      observacionGeneral: resultado.observacionGeneral,
      muestras: muestrasPorUnidad.get(String(resultado.claveUnidad ?? "")) ?? [],
      items: obtenerItemsEntregables(resultado.resultadosItems).map((item) => {
        const metadata = obtenerMetadataItemInforme({
          solicitud,
          resultado,
          item,
        });

        return {
          nombreInforme: item.nombreInforme,
          codItemLab: item.codItemLab,
          tipoResultado: metadata.tipoResultado,
          metodo: metadata.metodo,
          nombreGrupo: metadata.nombreGrupo,
          comentarioReferenciaGrupo: metadata.comentarioReferenciaGrupo,
          mostrarReferenciaInforme: metadata.mostrarReferenciaInforme,
          hallazgosNormales: metadata.hallazgosNormales,
          valor: item.valor,
          unidadesRef: item.unidadesRef,
          observacion: item.observacion,
          evaluacionReferencia: item.evaluacionReferencia,
          referenciasConfiguradas: metadata.referenciasConfiguradas,
          alertasDetectadas: item.alertasDetectadas,
          ordenGrupo: item.ordenGrupo,
          ordenItem: item.ordenItem,
        };
      }),
    }));
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
        origenAtencion: solicitud.origenAtencion,
        paciente: construirPaciente(solicitud),
        empresa: construirEmpresa(solicitud),
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
      resultadosItems: obtenerItemsEntregables(resultado.resultadosItems).map((item) => ({
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
