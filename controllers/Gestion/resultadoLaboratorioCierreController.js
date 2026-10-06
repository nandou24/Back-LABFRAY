const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { response } = require("express");

const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const RecurHumano = require("../../models/Mantenimiento/RecHumano");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");
const {
  resolverEstadoOperativoSolicitud,
} = require("../../utils/Gestion/estadoOperativoSolicitud");
const {
  PERMISOS_ACCION,
  normalizarPermisosAcciones,
} = require("../../utils/permisosAccion");
const {
  construirSnapshotResultado,
  registrarEventoHistorialResultado,
} = require("../../utils/Gestion/historialResultadoLaboratorio");

// ====== Validar segundo usuario para anulación liberada ======

const obtenerAutorizadorAnulacionLiberada = async ({
  nombreUsuarioAutorizador,
  passwordAutorizador,
  uidEjecutor,
  nombreUsuarioEjecutor,
  session,
}) => {
  if (
    typeof nombreUsuarioAutorizador !== "string" ||
    !nombreUsuarioAutorizador.trim()
  ) {
    const error = new Error(
      "Debe indicar el usuario que autoriza la anulación del resultado liberado",
    );
    error.statusCode = 400;
    throw error;
  }

  if (typeof passwordAutorizador !== "string" || !passwordAutorizador) {
    const error = new Error(
      "Debe indicar la contraseña del usuario autorizador",
    );
    error.statusCode = 400;
    throw error;
  }

  const usuarioAutorizador = await RecurHumano.findOne({
    "datosLogueo.nombreUsuario": nombreUsuarioAutorizador.trim(),
  })
    .populate({
      path: "datosLogueo.rol",
      populate: {
        path: "rutasPermitidas",
      },
    })
    .session(session);

  if (
    !usuarioAutorizador ||
    !usuarioAutorizador.datosLogueo ||
    usuarioAutorizador.datosLogueo.estado !== true
  ) {
    const error = new Error(
      "El usuario autorizador no existe o no se encuentra habilitado",
    );
    error.statusCode = 403;
    throw error;
  }

  const credencialValida = bcrypt.compareSync(
    passwordAutorizador,
    usuarioAutorizador.datosLogueo.passwordHash ?? "",
  );

  if (!credencialValida) {
    const error = new Error("Credenciales de autorización incorrectas");
    error.statusCode = 403;
    throw error;
  }

  const codAutorizador = String(usuarioAutorizador.codRecHumano ?? "").trim();
  const usuarioAutorizadorNombre = String(
    usuarioAutorizador.datosLogueo.nombreUsuario ?? "",
  ).trim();

  if (
    (uidEjecutor && codAutorizador === String(uidEjecutor).trim()) ||
    (nombreUsuarioEjecutor &&
      usuarioAutorizadorNombre.toLowerCase() ===
        String(nombreUsuarioEjecutor).trim().toLowerCase())
  ) {
    const error = new Error(
      "La anulación de un resultado LIBERADO debe ser autorizada por un segundo usuario distinto al ejecutor",
    );
    error.statusCode = 403;
    throw error;
  }

  const rol = usuarioAutorizador.datosLogueo.rol;
  const permisosAcciones = normalizarPermisosAcciones(
    rol?.permisosAcciones ?? [],
  );

  if (
    !rol ||
    rol.estado === false ||
    !permisosAcciones.includes(PERMISOS_ACCION.RESULTADOS_ANULAR)
  ) {
    const error = new Error(
      "El usuario autorizador no posee permiso para anular resultados de laboratorio",
    );
    error.statusCode = 403;
    throw error;
  }

  return {
    uid: codAutorizador,
    nombreUsuario: usuarioAutorizadorNombre,
    nombreRol: rol.nombreRol ?? null,
  };
};

// ====== Recalcular solicitud después de anulación ======

const sincronizarSolicitudTrasAnulacion = async ({
  solicitud,
  resultadoLaboratorio,
  uid,
  nombreUsuario,
  session,
}) => {
  const unidades = Array.isArray(solicitud.unidadesLaboratorio)
    ? solicitud.unidadesLaboratorio
    : [];

  const unidad = unidades.find(
    (item) =>
      String(item.claveUnidad ?? "") ===
      String(resultadoLaboratorio.claveUnidad ?? ""),
  );

  if (unidad) {
    unidad.estado = "ANULADO";

    if (typeof solicitud.markModified === "function") {
      solicitud.markModified("unidadesLaboratorio");
    }
  }

  const unidadesActivas = unidades.filter((item) => item.estado !== "ANULADO");

  if (unidades.length > 0 && unidadesActivas.length === 0) {
    solicitud.estado = "ANULADO";
  } else if (
    unidadesActivas.length > 0 &&
    unidadesActivas.every((item) => item.estado === "TERMINADO")
  ) {
    solicitud.estado = "ATENDIDO";
  } else {
    solicitud.estado = "EN PROCESO";
  }

  solicitud.updatedBy = uid;
  solicitud.usuarioActualizacion = nombreUsuario ?? null;
  solicitud.fechaActualizacion = new Date();

  await solicitud.save({ session });

  return resolverEstadoOperativoSolicitud({
    solicitud,
    session,
  });
};

// ====== Anular resultado con cierre clínico ======

const anularResultadoLaboratorioSeguro = async (req, res = response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { resultadoLaboratorioId } = req.params;
    const { uid, nombreUsuario } = req.user;
    const {
      motivoAnulacion,
      nombreUsuarioAutorizador,
      passwordAutorizador,
    } = req.body ?? {};

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    if (typeof motivoAnulacion !== "string" || !motivoAnulacion.trim()) {
      throw new Error("El motivo de anulación es obligatorio");
    }

    const resultadoLaboratorio = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).session(session);

    if (!resultadoLaboratorio) {
      throw new Error("El resultado de laboratorio no existe");
    }

    if (resultadoLaboratorio.estadoResultado === "ANULADO") {
      throw new Error("El resultado de laboratorio ya se encuentra ANULADO");
    }

    const estadosPermitidos = [
      "PENDIENTE",
      "EN PROCESO",
      "COMPLETO",
      "VALIDADO",
      "LIBERADO",
    ];

    if (!estadosPermitidos.includes(resultadoLaboratorio.estadoResultado)) {
      throw new Error(
        `No se puede anular un resultado en estado ${resultadoLaboratorio.estadoResultado}`,
      );
    }

    const solicitud = await SolicitudAtencion.findById(
      resultadoLaboratorio.solicitudAtencionId,
    ).session(session);

    if (!solicitud) {
      throw new Error("La solicitud de atención asociada no existe");
    }

    if (solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud asociada no corresponde a Laboratorio");
    }

    if (solicitud.estado === "ANULADO") {
      throw new Error(
        "No se puede anular un resultado de una solicitud anulada",
      );
    }

    const estadoPrevio = resultadoLaboratorio.estadoResultado;
    const snapshotAntesAnulacion = construirSnapshotResultado(
      resultadoLaboratorio,
    );
    const ahora = new Date();
    let autorizador = null;

    if (estadoPrevio === "LIBERADO") {
      autorizador = await obtenerAutorizadorAnulacionLiberada({
        nombreUsuarioAutorizador,
        passwordAutorizador,
        uidEjecutor: uid,
        nombreUsuarioEjecutor: nombreUsuario,
        session,
      });
    }

    resultadoLaboratorio.estadoPrevioAnulacion = estadoPrevio;
    resultadoLaboratorio.estadoResultado = "ANULADO";
    resultadoLaboratorio.anuladoPor = uid;
    resultadoLaboratorio.usuarioAnulacion = nombreUsuario ?? null;
    resultadoLaboratorio.fechaAnulacion = ahora;
    resultadoLaboratorio.motivoAnulacion = motivoAnulacion.trim();

    resultadoLaboratorio.autorizacionAnulacionPor = autorizador?.uid ?? null;
    resultadoLaboratorio.usuarioAutorizacionAnulacion =
      autorizador?.nombreUsuario ?? null;
    resultadoLaboratorio.rolAutorizacionAnulacion =
      autorizador?.nombreRol ?? null;
    resultadoLaboratorio.fechaAutorizacionAnulacion = autorizador ? ahora : null;

    for (const item of resultadoLaboratorio.resultadosItems ?? []) {
      item.estado = "ANULADO";
    }

    resultadoLaboratorio.updatedBy = uid;
    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;
    resultadoLaboratorio.fechaActualizacion = ahora;

    registrarEventoHistorialResultado(resultadoLaboratorio, {
      tipoEvento: "ANULACION",
      estadoAnterior: estadoPrevio,
      estadoNuevo: "ANULADO",
      uid,
      nombreUsuario,
      fecha: ahora,
      detalle: `Resultado anulado. Motivo: ${resultadoLaboratorio.motivoAnulacion}`,
      metadatos: autorizador
        ? {
            segundoUsuario: {
              uid: autorizador.uid,
              nombreUsuario: autorizador.nombreUsuario,
              nombreRol: autorizador.nombreRol,
            },
          }
        : null,
      snapshotResultado: snapshotAntesAnulacion,
    });

    await resultadoLaboratorio.save({ session });

    const estadoOperativo = await sincronizarSolicitudTrasAnulacion({
      solicitud,
      resultadoLaboratorio,
      uid,
      nombreUsuario,
      session,
    });

    await session.commitTransaction();

    const unidad = (solicitud.unidadesLaboratorio ?? []).find(
      (item) =>
        String(item.claveUnidad ?? "") ===
        String(resultadoLaboratorio.claveUnidad ?? ""),
    );

    return res.status(200).json({
      ok: true,
      msg:
        estadoPrevio === "LIBERADO"
          ? "Resultado liberado anulado correctamente con autorización de segundo usuario"
          : "Resultado de laboratorio anulado correctamente",
      estadoPrevioAnulacion: estadoPrevio,
      estadoResultado: resultadoLaboratorio.estadoResultado,
      estadoUnidadLaboratorio: unidad?.estado ?? null,
      estadoSolicitud: solicitud.estado,
      estadoOperativo,
      motivoAnulacion: resultadoLaboratorio.motivoAnulacion,
      autorizacionSegundoUsuario: autorizador
        ? {
            autorizacionAnulacionPor: autorizador.uid,
            usuarioAutorizacionAnulacion: autorizador.nombreUsuario,
            rolAutorizacionAnulacion: autorizador.nombreRol,
            fechaAutorizacionAnulacion: ahora,
          }
        : null,
      resultado: resultadoLaboratorio,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al anular resultado de laboratorio:", error);

    return res.status(error.statusCode ?? 400).json({
      ok: false,
      msg: error.message || "No se pudo anular el resultado de laboratorio",
    });
  } finally {
    await session.endSession();
  }
};


// ====== Reabrir resultado anulado ======

const reabrirResultadoLaboratorio = async (req, res = response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { resultadoLaboratorioId } = req.params;
    const { uid, nombreUsuario } = req.user;

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      throw new Error("El id del resultado de laboratorio no es válido");
    }

    const resultadoLaboratorio = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    ).session(session);

    if (!resultadoLaboratorio) {
      throw new Error("El resultado de laboratorio no existe");
    }

    if (resultadoLaboratorio.estadoResultado !== "ANULADO") {
      throw new Error(
        `Solo se puede reabrir un resultado ANULADO. Estado actual: ${resultadoLaboratorio.estadoResultado}`,
      );
    }

    const solicitud = await SolicitudAtencion.findById(
      resultadoLaboratorio.solicitudAtencionId,
    ).session(session);

    if (!solicitud || solicitud.tipo !== "Laboratorio") {
      throw new Error("La solicitud de laboratorio asociada no existe");
    }

    const unidad = (solicitud.unidadesLaboratorio ?? []).find(
      (item) =>
        String(item.claveUnidad ?? "") ===
        String(resultadoLaboratorio.claveUnidad ?? ""),
    );

    if (!unidad) {
      throw new Error("No se encontró la unidad clínica asociada al resultado");
    }

    const ahora = new Date();
    const snapshotAnulado = construirSnapshotResultado(resultadoLaboratorio);
    const estadoAnterior = resultadoLaboratorio.estadoResultado;
    const versionActual = Number(resultadoLaboratorio.versionResultado ?? 1);
    const historialActual = Array.isArray(resultadoLaboratorio.historialEventos)
      ? resultadoLaboratorio.historialEventos
      : [];
    const existeEventoVersion = (tipoEvento) =>
      historialActual.some(
        (evento) =>
          evento.tipoEvento === tipoEvento &&
          Number(evento.versionResultado ?? 1) === versionActual,
      );

    // ====== Completar historial de documentos creados antes de 10F.1 ======

    if (!existeEventoVersion("REGISTRO")) {
      for (const item of resultadoLaboratorio.resultadosItems ?? []) {
        if (!item.fechaRegistroResultado) {
          continue;
        }

        registrarEventoHistorialResultado(resultadoLaboratorio, {
          tipoEvento: "REGISTRO",
          estadoAnterior: null,
          estadoNuevo: null,
          uid: item.registradoPor,
          nombreUsuario: item.usuarioRegistroResultado,
          fecha: item.fechaRegistroResultado,
          detalle: `Registro histórico del Item ${item.nombreInforme}`,
          metadatos: {
            itemResultadoId: item._id,
            codItemLab: item.codItemLab,
            nombreInforme: item.nombreInforme,
            valor: item.valor,
          },
        });
      }
    }

    if (!existeEventoVersion("MODIFICACION")) {
      for (const item of resultadoLaboratorio.resultadosItems ?? []) {
        if (!item.fechaActualizacionResultado) {
          continue;
        }

        registrarEventoHistorialResultado(resultadoLaboratorio, {
          tipoEvento: "MODIFICACION",
          estadoAnterior: null,
          estadoNuevo: null,
          uid: item.actualizadoPor,
          nombreUsuario: item.usuarioActualizacionResultado,
          fecha: item.fechaActualizacionResultado,
          detalle: `Modificación histórica del Item ${item.nombreInforme}`,
          metadatos: {
            itemResultadoId: item._id,
            codItemLab: item.codItemLab,
            nombreInforme: item.nombreInforme,
            valor: item.valor,
          },
        });
      }
    }

    if (resultadoLaboratorio.fechaValidacion && !existeEventoVersion("VALIDACION")) {
      registrarEventoHistorialResultado(resultadoLaboratorio, {
        tipoEvento: "VALIDACION",
        estadoAnterior: "COMPLETO",
        estadoNuevo: "VALIDADO",
        uid: resultadoLaboratorio.validadoPor,
        nombreUsuario: resultadoLaboratorio.usuarioValidacion,
        fecha: resultadoLaboratorio.fechaValidacion,
        detalle: resultadoLaboratorio.observacionValidacion
          ? `Resultado validado. Observación: ${resultadoLaboratorio.observacionValidacion}`
          : "Resultado validado",
      });
    }

    if (resultadoLaboratorio.fechaLiberacion && !existeEventoVersion("LIBERACION")) {
      registrarEventoHistorialResultado(resultadoLaboratorio, {
        tipoEvento: "LIBERACION",
        estadoAnterior: "VALIDADO",
        estadoNuevo: "LIBERADO",
        uid: resultadoLaboratorio.liberadoPor,
        nombreUsuario: resultadoLaboratorio.usuarioLiberacion,
        fecha: resultadoLaboratorio.fechaLiberacion,
        detalle: "Resultado liberado para visualización o entrega",
      });
    }

    if (resultadoLaboratorio.fechaAnulacion && !existeEventoVersion("ANULACION")) {
      registrarEventoHistorialResultado(resultadoLaboratorio, {
        tipoEvento: "ANULACION",
        estadoAnterior: resultadoLaboratorio.estadoPrevioAnulacion,
        estadoNuevo: "ANULADO",
        uid: resultadoLaboratorio.anuladoPor,
        nombreUsuario: resultadoLaboratorio.usuarioAnulacion,
        fecha: resultadoLaboratorio.fechaAnulacion,
        detalle: resultadoLaboratorio.motivoAnulacion
          ? `Resultado anulado. Motivo: ${resultadoLaboratorio.motivoAnulacion}`
          : "Resultado anulado",
        snapshotResultado: snapshotAnulado,
      });
    }

    resultadoLaboratorio.versionResultado =
      Number(resultadoLaboratorio.versionResultado ?? 1) + 1;
    resultadoLaboratorio.estadoResultado = "PENDIENTE";
    resultadoLaboratorio.observacionGeneral = "";

    for (const item of resultadoLaboratorio.resultadosItems ?? []) {
      item.valor = null;
      item.observacion = "";
      item.estado = "PENDIENTE";
      item.evaluacionReferencia = {
        estado: "PENDIENTE",
        referenciaAplicada: null,
        mensaje: "",
      };
      item.alertasDetectadas = [];
      item.registradoPor = null;
      item.usuarioRegistroResultado = null;
      item.fechaRegistroResultado = null;
      item.actualizadoPor = null;
      item.usuarioActualizacionResultado = null;
      item.fechaActualizacionResultado = null;
    }

    resultadoLaboratorio.validadoPor = null;
    resultadoLaboratorio.usuarioValidacion = null;
    resultadoLaboratorio.fechaValidacion = null;
    resultadoLaboratorio.observacionValidacion = "";
    resultadoLaboratorio.confirmoAlertasCriticasValidacion = false;

    resultadoLaboratorio.liberadoPor = null;
    resultadoLaboratorio.usuarioLiberacion = null;
    resultadoLaboratorio.fechaLiberacion = null;
    resultadoLaboratorio.confirmoAlertasCriticasLiberacion = false;

    resultadoLaboratorio.estadoPrevioAnulacion = null;
    resultadoLaboratorio.anuladoPor = null;
    resultadoLaboratorio.usuarioAnulacion = null;
    resultadoLaboratorio.fechaAnulacion = null;
    resultadoLaboratorio.motivoAnulacion = null;
    resultadoLaboratorio.autorizacionAnulacionPor = null;
    resultadoLaboratorio.usuarioAutorizacionAnulacion = null;
    resultadoLaboratorio.rolAutorizacionAnulacion = null;
    resultadoLaboratorio.fechaAutorizacionAnulacion = null;

    resultadoLaboratorio.updatedBy = uid;
    resultadoLaboratorio.usuarioActualizacion = nombreUsuario ?? null;
    resultadoLaboratorio.fechaActualizacion = ahora;

    registrarEventoHistorialResultado(resultadoLaboratorio, {
      tipoEvento: "REAPERTURA",
      estadoAnterior,
      estadoNuevo: "PENDIENTE",
      uid,
      nombreUsuario,
      fecha: ahora,
      detalle:
        "Resultado reabierto para un nuevo ciclo de registro sin modificar la muestra asociada",
      metadatos: {
        versionAnterior: versionActual,
      },
    });

    unidad.estado = "PENDIENTE";
    if (typeof solicitud.markModified === "function") {
      solicitud.markModified("unidadesLaboratorio");
    }

    solicitud.estado = "EN PROCESO";
    solicitud.fechaAtencionArea = null;
    solicitud.atendidoPor = null;
    solicitud.usuarioAtencion = null;
    solicitud.updatedBy = uid;
    solicitud.usuarioActualizacion = nombreUsuario ?? null;
    solicitud.fechaActualizacion = ahora;

    await resultadoLaboratorio.save({ session });
    await solicitud.save({ session });

    const estadoOperativo = await resolverEstadoOperativoSolicitud({
      solicitud,
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,
      msg: "Resultado reabierto correctamente. Puede registrarse un nuevo informe con la muestra vigente si continúa apta.",
      estadoResultado: resultadoLaboratorio.estadoResultado,
      estadoUnidadLaboratorio: unidad.estado,
      estadoSolicitud: solicitud.estado,
      estadoOperativo,
      resultado: resultadoLaboratorio,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al reabrir resultado de laboratorio:", error);

    return res.status(error.statusCode ?? 400).json({
      ok: false,
      msg: error.message || "No se pudo reabrir el resultado de laboratorio",
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  anularResultadoLaboratorioSeguro,
  reabrirResultadoLaboratorio,
};
