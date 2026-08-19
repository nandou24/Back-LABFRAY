const { response } = require("express");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");

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
    const { empresaId, estadoProgramacion, nroDoc, fechaInicio, fechaFin } = req.query;
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
    return res.status(500).json({ ok: false, msg: "Error al listar programaciones" });
  }
};

const obtenerProgramacion = async (req, res = response) => {
  try {
    const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id).lean();

    if (!programacion) {
      return res.status(404).json({ ok: false, msg: "Programación no encontrada" });
    }

    return res.json({ ok: true, programacion });
  } catch (error) {
    console.error("Error al obtener programación empresarial:", error);
    return res.status(500).json({ ok: false, msg: "Error al obtener la programación" });
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
      return res.status(404).json({ ok: false, msg: "Programación no encontrada" });
    }

    return res.json({ ok: true, msg: "Programación actualizada correctamente", programacion });
  } catch (error) {
    console.error("Error al actualizar programación empresarial:", error);
    return res.status(400).json({ ok: false, msg: "Datos de programación inválidos" });
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
      return res.status(404).json({ ok: false, msg: "Programación no encontrada" });
    }

    return res.json({ ok: true, msg: "Estado actualizado correctamente", programacion });
  } catch (error) {
    console.error("Error al actualizar estado de programación:", error);
    return res.status(400).json({ ok: false, msg: "Estado o pendientes inválidos" });
  }
};

module.exports = {
  crearProgramacion,
  listarProgramaciones,
  obtenerProgramacion,
  actualizarProgramacion,
  actualizarEstadoProgramacion,
};