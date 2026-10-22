const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ResultadoLaboratorio = require("../../models/Gestion/ResultadoLaboratorio");
const RecursoHumano = require("../../models/Mantenimiento/RecHumano");
const AprobacionInforme = require("../../models/Gestion/AprobacionInformeLaboratorio");
const { validarIdentidadesParaLiberar } = require('../../utils/Gestion/validarIdentidadLiberacion');


const MAX_PRUEBAS = 100;

// ====== Normalizar selección y versiones vigentes ======
const normalizarSeleccion = (seleccion) => {
  if (!Array.isArray(seleccion) || !seleccion.length || seleccion.length > MAX_PRUEBAS) {
    return null;
  }

  const normalizados = seleccion.map((item) => ({
    resultadoLaboratorioId: String(item?.resultadoLaboratorioId ?? "").trim(),
    versionResultado: Number(item?.versionResultado),
  }));

  if (normalizados.some((item) =>
    !mongoose.isValidObjectId(item.resultadoLaboratorioId) ||
    !Number.isInteger(item.versionResultado) || item.versionResultado < 1
  )) {
    return null;
  }

  if (new Set(normalizados.map((item) => item.resultadoLaboratorioId)).size !== normalizados.length) {
    return null;
  }

  return normalizados.sort((a, b) =>
    a.resultadoLaboratorioId.localeCompare(b.resultadoLaboratorioId),
  );
};

const construirClaveSeleccion = (resultados) =>
  crypto.createHash("sha256").update(JSON.stringify(resultados)).digest("hex");

const serializarAprobacion = (registro, vigente) => ({
  _id: String(registro._id),
  solicitudAtencionId: String(registro.solicitudAtencionId),
  resultados: registro.resultados.map((item) => ({
    resultadoLaboratorioId: String(item.resultadoLaboratorioId),
    versionResultado: Number(item.versionResultado),
  })),
  firmante: {
    recursoHumanoId: String(registro.firmante.recursoHumanoId),
    codRecHumano: registro.firmante.codRecHumano,
    nombreCompleto: registro.firmante.nombreCompleto,
    profesion: registro.firmante.profesion,
    nroColegiatura: registro.firmante.nroColegiatura,
    especialidad: registro.firmante.especialidad ?? null,
    rne: registro.firmante.rne ?? null,
  },
  aprobadoPor: registro.aprobadoPor,
  usuarioAprobacion: registro.usuarioAprobacion,
  fechaAprobacion: registro.fechaAprobacion,
  vigente,
});

// ====== Consultar aprobaciones sin dar por vigentes resultados modificados ======
const obtenerAprobacionesInforme = async (req, res) => {
  try {
    const { solicitudAtencionId } = req.params;
    if (!mongoose.isValidObjectId(solicitudAtencionId)) {
      return res.status(400).json({ ok: false, msg: "Solicitud inválida" });
    }

    const registros = await AprobacionInforme.find({ solicitudAtencionId })
      .sort({ fechaAprobacion: -1 })
      .limit(100)
      .lean();

    const ids = [...new Set(registros.flatMap((registro) =>
      (registro.resultados ?? []).map((item) => String(item.resultadoLaboratorioId)),
    ))];
    const actuales = await ResultadoLaboratorio.find({
      solicitudAtencionId,
      _id: { $in: ids },
    }).select("_id estadoResultado versionResultado").lean();
    const porId = new Map(actuales.map((item) => [String(item._id), item]));

    const aprobaciones = registros.map((registro) => {
      const vigente = registro.resultados.length > 0 && registro.resultados.every((item) => {
        const actual = porId.get(String(item.resultadoLaboratorioId));
        return actual?.estadoResultado === "LIBERADO" &&
          Number(actual.versionResultado ?? 1) === Number(item.versionResultado);
      });
      return serializarAprobacion(registro, vigente);
    });

    return res.json({ ok: true, aprobaciones });
  } catch (error) {
    console.error("Error al consultar aprobaciones de informe:", error);
    return res.status(500).json({ ok: false, msg: "No se pudieron consultar las aprobaciones" });
  }
};

// ====== Registrar aprobación clínica por la profesional seleccionada ======
const aprobarInformeLaboratorio = async (req, res) => {
  try {
    const { solicitudAtencionId } = req.params;
    const { recursoHumanoId, nombreUsuarioFirmante, passwordFirmante } = req.body ?? {};
    const seleccion = normalizarSeleccion(req.body?.resultados);

    if (!mongoose.isValidObjectId(solicitudAtencionId) || !seleccion) {
      return res.status(400).json({ ok: false, msg: "Solicitud o selección de pruebas inválida" });
    }
    if (!mongoose.isValidObjectId(recursoHumanoId) ||
        typeof nombreUsuarioFirmante !== "string" || !nombreUsuarioFirmante.trim() ||
        typeof passwordFirmante !== "string" || !passwordFirmante) {
      return res.status(400).json({ ok: false, msg: "Indique la profesional y sus credenciales" });
    }

    const solicitud = await SolicitudAtencion.findById(solicitudAtencionId)
      .select("codSolicitud codigoLaboratorio tipo estado hc clienteId tipoDoc nroDoc").lean();
    if (!solicitud || solicitud.tipo !== "Laboratorio" || solicitud.estado === "ANULADO") {
      return res.status(409).json({ ok: false, msg: "Solicitud de laboratorio no disponible" });
    }

    // ====== No aprobar emisión sin identidad verificada ======
    await validarIdentidadesParaLiberar([solicitud]);

    const resultados = await ResultadoLaboratorio.find({
      solicitudAtencionId,
      _id: { $in: seleccion.map((item) => item.resultadoLaboratorioId) },
      estadoResultado: "LIBERADO",
    }).select("_id versionResultado estadoResultado").lean();
    const mapaActuales = new Map(resultados.map((item) => [String(item._id), item]));
    if (resultados.length !== seleccion.length || seleccion.some((item) =>
      Number(mapaActuales.get(item.resultadoLaboratorioId)?.versionResultado ?? 0) !== item.versionResultado
    )) {
      return res.status(409).json({
        ok: false,
        msg: "Las pruebas seleccionadas cambiaron o ya no están liberadas. Actualice el informe.",
      });
    }

    const recurso = await RecursoHumano.findById(recursoHumanoId)
      .populate("profesionesRecurso.profesionRef", "nombreProfesion estadoProfesion")
      .populate("profesionesRecurso.especialidades.especialidadRef", "nombreEspecialidad estadoEspecialidad");
    const profesion = (recurso?.profesionesRecurso ?? []).find((item) =>
      String(item._id) === String(recurso?.firmaLaboratorio?.profesionRecursoId ?? ""),
    );

    if (!recurso?.firmaLaboratorio?.habilitado ||
        !profesion || !profesion.profesionRef?.estadoProfesion ||
        !String(profesion.nroColegiatura ?? "").trim()) {
      return res.status(409).json({ ok: false, msg: "La profesional no está habilitada para firmar" });
    }

    // ====== La firma requiere autenticación personal de la profesional ======
    const usuario = String(recurso.datosLogueo?.nombreUsuario ?? "");
    const passwordHash = String(recurso.datosLogueo?.passwordHash ?? "");
    const credencialesValidas = recurso.usuarioSistema === true &&
      recurso.datosLogueo?.estado === true &&
      usuario.toLowerCase() === nombreUsuarioFirmante.trim().toLowerCase() &&
      passwordHash && await bcrypt.compare(passwordFirmante, passwordHash);
    if (!credencialesValidas) {
      return res.status(403).json({ ok: false, msg: "Credenciales de aprobación no válidas" });
    }

    const claveSeleccion = construirClaveSeleccion(seleccion);
    const existente = await AprobacionInforme.findOne({ solicitudAtencionId, claveSeleccion }).lean();
    if (existente) {
      if (String(existente.firmante.recursoHumanoId) !== String(recurso._id)) {
        return res.status(409).json({
          ok: false,
          msg: "El mismo conjunto de pruebas ya fue aprobado por otra profesional",
        });
      }
      return res.json({ ok: true, reutilizado: true, aprobacion: serializarAprobacion(existente, true) });
    }

    const especialidad = (profesion.especialidades ?? []).find((item) =>
      item.especialidadRef?.estadoEspecialidad !== false &&
      item.especialidadRef?.nombreEspecialidad,
    );
    const nombreCompleto = [
      recurso.nombreRecHumano, recurso.apePatRecHumano, recurso.apeMatRecHumano,
    ].filter(Boolean).join(" ").trim();

    // ====== Snapshot profesional inmutable para esta selección ======
    const nuevoRegistro = {
      solicitudAtencionId,
      codSolicitud: solicitud.codSolicitud,
      codigoLaboratorio: solicitud.codigoLaboratorio ?? "",
      claveSeleccion,
      resultados: seleccion,
      firmante: {
        recursoHumanoId: recurso._id,
        codRecHumano: recurso.codRecHumano,
        nombreCompleto,
        profesionRecursoId: profesion._id,
        profesion: profesion.profesionRef.nombreProfesion,
        nroColegiatura: profesion.nroColegiatura,
        especialidad: especialidad?.especialidadRef?.nombreEspecialidad ?? null,
        rne: especialidad?.rne ?? null,
      },
      aprobadoPor: recurso.codRecHumano,
      usuarioAprobacion: usuario,
      fechaAprobacion: new Date(),
      solicitadoPor: req.user.uid,
      usuarioSolicitud: req.user.nombreUsuario ?? null,
    };

    // ====== Revalidar estado antes de registrar la aprobación ======
    const vigente = await ResultadoLaboratorio.find({
      solicitudAtencionId,
      _id: { $in: seleccion.map((item) => item.resultadoLaboratorioId) },
      estadoResultado: "LIBERADO",
    }).select("_id versionResultado").lean();
    if (vigente.length !== seleccion.length || vigente.some((item) =>
      Number(item.versionResultado) !==
      seleccion.find((s) => s.resultadoLaboratorioId === String(item._id))?.versionResultado
    )) {
      return res.status(409).json({ ok: false, msg: "Los resultados cambiaron durante la aprobación" });
    }

    try {
      const registro = await AprobacionInforme.create(nuevoRegistro);
      return res.status(201).json({
        ok: true,
        reutilizado: false,
        aprobacion: serializarAprobacion(registro, true),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const duplicado = await AprobacionInforme.findOne({ solicitudAtencionId, claveSeleccion }).lean();
      if (duplicado && String(duplicado.firmante.recursoHumanoId) === String(recurso._id)) {
        return res.json({ ok: true, reutilizado: true, aprobacion: serializarAprobacion(duplicado, true) });
      }
      return res.status(409).json({ ok: false, msg: "El informe ya fue aprobado por otra profesional" });
    }
  } catch (error) {
    console.error("Error al aprobar informe de laboratorio:", error);
    return res.status(500).json({ ok: false, msg: "No se pudo registrar la aprobación del informe" });
  }
};

module.exports = { obtenerAprobacionesInforme, aprobarInformeLaboratorio };
