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

module.exports = {
  anularResultadoLaboratorioSeguro,
};
