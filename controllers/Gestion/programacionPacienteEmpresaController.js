const { response } = require("express");
const mongoose = require("mongoose");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");

const construirRangoDia = (fecha) => {
  const base = new Date(fecha);
  const inicioDia = new Date(base);
  inicioDia.setHours(0, 0, 0, 0);
  const finDia = new Date(base);
  finDia.setHours(23, 59, 59, 999);

  return { inicioDia, finDia };
};

const generarCodigoProgramacion = async () => {
  const anioActual = new Date().getFullYear();
  const ultimaProgramacion = await ProgramacionPacienteEmpresa.findOne({
    codProgramacion: new RegExp(`^PPE-${anioActual}-`),
  })
    .sort({ codProgramacion: -1 })
    .lean();

  const ultimoNumero = ultimaProgramacion
    ? Number.parseInt(ultimaProgramacion.codProgramacion.split("-")[2], 10)
    : 0;

  return `PPE-${anioActual}-${String(ultimoNumero + 1).padStart(4, "0")}`;
};

const crearProgramacion = async (req, res = response) => {
  try {
    const {
      empresaId,
      protocoloId,
      fechaProgramada,
      pacienteId,
      tipoDoc,
      nroDoc,
    } = req.body;

    const { inicioDia, finDia } = construirRangoDia(fechaProgramada);

    const filtroDuplicado = {
      empresaId,
      protocoloId,
      fechaProgramada: { $gte: inicioDia, $lte: finDia },
    };

    // El paciente se identifica por pacienteId cuando existe,
    // y adicionalmente por tipo y número de documento.
    if (pacienteId) {
      filtroDuplicado.$or = [{ pacienteId }, { tipoDoc, nroDoc }];
    } else {
      filtroDuplicado.tipoDoc = tipoDoc;
      filtroDuplicado.nroDoc = nroDoc;
    }

    const programacionDuplicada =
      await ProgramacionPacienteEmpresa.findOne(filtroDuplicado).lean();

    if (programacionDuplicada) {
      return res.status(409).json({
        ok: false,
        msg: "Ya existe una programación para este paciente, empresa y protocolo en la misma fecha",
      });
    }

    const codProgramacion = await generarCodigoProgramacion();
    const programacion = new ProgramacionPacienteEmpresa({
      ...req.body,
      codProgramacion,
      estadoProgramacion: "PROGRAMADO",
      createdBy: req.user.uid,
      usuarioRegistro: req.user.nombreUsuario,
    });

    await programacion.save();

    return res.status(201).json({
      ok: true,
      msg: "Programación registrada correctamente",
      programacion,
    });
  } catch (error) {
    console.error("Error al registrar programación empresarial:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al registrar la programación",
    });
  }
};

const listarProgramaciones = async (req, res = response) => {
  try {
    //console.log("Query parameters:", req.query);
    const { empresaId, estadoProgramacion, nroDoc, fechaInicio, fechaFin } =
      req.query;
    const filtro = {};

    if (empresaId) filtro.empresaId = empresaId;
    if (estadoProgramacion) filtro.estadoProgramacion = estadoProgramacion;
    if (nroDoc) filtro.nroDoc = nroDoc;
    if (fechaInicio || fechaFin) {
      filtro.fechaProgramada = {};
      if (fechaInicio) filtro.fechaProgramada.$gte = new Date(fechaInicio);
      if (fechaFin) {
        const fin = new Date(fechaFin);
        fin.setHours(23, 59, 59, 999);
        filtro.fechaProgramada.$lte = fin;
      }
    }

    const programaciones = await ProgramacionPacienteEmpresa.find(filtro)
      .sort({ fechaProgramada: 1, horaProgramada: 1 })
      .lean();

    return res.json({ ok: true, programaciones });
  } catch (error) {
    console.error("Error al listar programaciones empresariales:", error);
    return res
      .status(500)
      .json({ ok: false, msg: "Error al listar programaciones" });
  }
};

const obtenerProgramacion = async (req, res = response) => {
  try {
    const programacion = await ProgramacionPacienteEmpresa.findById(
      req.params.id,
    ).lean();

    if (!programacion) {
      return res
        .status(404)
        .json({ ok: false, msg: "Programación no encontrada" });
    }

    return res.json({ ok: true, programacion });
  } catch (error) {
    console.error("Error al obtener programación empresarial:", error);
    return res
      .status(500)
      .json({ ok: false, msg: "Error al obtener la programación" });
  }
};

const actualizarProgramacion = async (req, res = response) => {
  try {
    const datosActualizables = { ...req.body };
    delete datosActualizables.codProgramacion;
    delete datosActualizables.estadoProgramacion;
    delete datosActualizables.createdBy;
    delete datosActualizables.usuarioRegistro;

    const programacion = await ProgramacionPacienteEmpresa.findByIdAndUpdate(
      req.params.id,
      {
        ...datosActualizables,
        updatedBy: req.user.uid,
        usuarioActualizacion: req.user.nombreUsuario,
        fechaActualizacion: new Date(),
      },
      { new: true, runValidators: true },
    );

    if (!programacion) {
      return res
        .status(404)
        .json({ ok: false, msg: "Programación no encontrada" });
    }

    return res.json({
      ok: true,
      msg: "Programación actualizada correctamente",
      programacion,
    });
  } catch (error) {
    console.error("Error al actualizar programación empresarial:", error);
    return res
      .status(400)
      .json({ ok: false, msg: "Datos de programación inválidos" });
  }
};

const actualizarEstadoProgramacion = async (req, res = response) => {
  try {
    const { estadoProgramacion, pendientes } = req.body;
    const datos = {
      estadoProgramacion,
      updatedBy: req.user.uid,
      usuarioActualizacion: req.user.nombreUsuario,
      fechaActualizacion: new Date(),
    };
    const ahora = new Date();

    if (pendientes !== undefined) datos.pendientes = pendientes;
    if (estadoProgramacion === "EN ATENCION") {
      datos.fechaInicioAtencion = ahora;
      datos.fechaUltimaAtencion = ahora;
    }
    if (estadoProgramacion === "PENDIENTE DE COMPLETAR") {
      datos.fechaUltimaAtencion = ahora;
    }
    if (["ATENDIDO", "NO ASISTIO", "CANCELADO"].includes(estadoProgramacion)) {
      datos.fechaFinalizacion = ahora;
      datos.fechaUltimaAtencion = ahora;
    }

    const programacion = await ProgramacionPacienteEmpresa.findByIdAndUpdate(
      req.params.id,
      datos,
      { new: true, runValidators: true },
    );

    if (!programacion) {
      return res
        .status(404)
        .json({ ok: false, msg: "Programación no encontrada" });
    }

    return res.json({
      ok: true,
      msg: "Estado actualizado correctamente",
      programacion,
    });
  } catch (error) {
    console.error("Error al actualizar estado de programación:", error);
    return res
      .status(400)
      .json({ ok: false, msg: "Estado o pendientes inválidos" });
  }
};

// ==========================================
// INICIAR ATENCIÓN DE PROGRAMACIÓN EMPRESARIAL
// ==========================================

const iniciarAtencionProgramacion = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { id } = req.params;
    const { uid, nombreUsuario } = req.user;

    // ==========================================
    // 1. VALIDAR ID DE PROGRAMACIÓN
    // ==========================================

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({
        ok: false,
        msg: "El ID de la programación no es válido",
      });
    }

    // ==========================================
    // 2. OBTENER PROGRAMACIÓN
    // ==========================================

    const programacion =
      await ProgramacionPacienteEmpresa.findById(id).session(session);

    if (!programacion) {
      await session.abortTransaction();
      return res.status(404).json({
        ok: false,
        msg: "Programación no encontrada",
      });
    }

    // ==========================================
    // 3. VALIDAR ESTADO ACTUAL
    // ==========================================

    if (programacion.estadoProgramacion !== "PROGRAMADO") {
      await session.abortTransaction();
      return res.status(409).json({
        ok: false,
        msg: "La programación no se encuentra en estado PROGRAMADO",
      });
    }

    // ==========================================
    // POR AHORA NO HACEMOS CAMBIOS
    // ==========================================

    await session.commitTransaction();
    return res.status(200).json({
      ok: true,
      msg: "Programación validada para iniciar atención",
      programacion,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al iniciar atención empresarial:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al iniciar la atención empresarial",
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  crearProgramacion,
  listarProgramaciones,
  obtenerProgramacion,
  actualizarProgramacion,
  actualizarEstadoProgramacion,
  iniciarAtencionProgramacion,
};
