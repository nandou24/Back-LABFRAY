const { response } = require("express");
const mongoose = require("mongoose");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");
const Paciente = require("../../models/Mantenimiento/Paciente");
const { crearSolicitudesAtencion } = require("./solicitudAtencionController");

const { registrarPaciente } = require("../Mantenimiento/pacienteController");

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
      .sort({ fechaProgramada: -1, horaProgramada: -1 })
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

    // ==========================================
    // OBTENER PROGRAMACIÓN ACTUAL
    // ==========================================

    const programacionActual = await ProgramacionPacienteEmpresa.findById(
      req.params.id,
    );

    if (!programacionActual) {
      return res.status(404).json({
        ok: false,
        msg: "Programación no encontrada",
      });
    }

    // ==========================================
    // VALIDAR CANCELACIÓN
    // ==========================================

    if (
      estadoProgramacion === "CANCELADO" &&
      programacionActual.estadoProgramacion !== "PROGRAMADO"
    ) {
      return res.status(409).json({
        ok: false,
        codigo: "CANCELACION_NO_PERMITIDA",
        msg: "Solo se puede cancelar una programación que se encuentre en estado PROGRAMADO.",
      });
    }

    // ==========================================
    // VALIDAR NO ASISTENCIA
    // ==========================================

    if (
      estadoProgramacion === "NO ASISTIO" &&
      programacionActual.estadoProgramacion !== "PROGRAMADO"
    ) {
      return res.status(409).json({
        ok: false,
        codigo: "NO_ASISTENCIA_NO_PERMITIDA",
        msg: "Solo se puede marcar como NO ASISTIO una programación que se encuentre en estado PROGRAMADO.",
      });
    }

    const ahora = new Date();

    const datos = {
      estadoProgramacion,
      updatedBy: req.user.uid,
      usuarioActualizacion: req.user.nombreUsuario,
      fechaActualizacion: new Date(),
    };

    if (pendientes !== undefined) datos.pendientes = pendientes;

    // ==========================================
    // FECHAS SEGÚN ESTADO
    // ==========================================

    if (estadoProgramacion === "EN ATENCION") {
      datos.fechaInicioAtencion = ahora;
      datos.fechaUltimaAtencion = ahora;
    }
    if (estadoProgramacion === "PENDIENTE DE COMPLETAR") {
      datos.fechaUltimaAtencion = ahora;
    }
    if (estadoProgramacion === "ATENDIDO") {
      datos.fechaFinalizacion = ahora;
      datos.fechaUltimaAtencion = ahora;
    }

    if (
      estadoProgramacion === "NO ASISTIO" ||
      estadoProgramacion === "CANCELADO"
    ) {
      datos.fechaFinalizacion = ahora;
    }

    // ==========================================
    // ACTUALIZAR
    // ==========================================

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
      msg:
        estadoProgramacion === "CANCELADO"
          ? "Programación cancelada correctamente"
          : "Estado actualizado correctamente",
      programacion,
    });
  } catch (error) {
    console.error("Error al actualizar estado de programación:", error);
    return res
      .status(400)
      .json({ ok: false, msg: "Estado o pendientes inválidos" });
  }
};

const normalizarTextoIdentidad = (valor) => {
  return (valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
};

const validarCoincidenciaIdentidad = (programacion, paciente) => {
  const campos = [
    {
      campo: "nombreCliente",
      programacion: programacion.nombreCliente,
      paciente: paciente.nombreCliente,
    },
    {
      campo: "apePatCliente",
      programacion: programacion.apePatCliente,
      paciente: paciente.apePatCliente,
    },
    {
      campo: "apeMatCliente",
      programacion: programacion.apeMatCliente,
      paciente: paciente.apeMatCliente,
    },
  ];

  const diferencias = campos.filter((item) => {
    return (
      normalizarTextoIdentidad(item.programacion) !==
      normalizarTextoIdentidad(item.paciente)
    );
  });

  return {
    coincide: diferencias.length === 0,

    diferencias,
  };
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
    // 4. RESOLVER PACIENTE
    // ==========================================

    let paciente = null;
    let formaResolucion = null;
    // ==========================================
    // 4.1. PROGRAMACIÓN CON PACIENTE ID
    // ==========================================

    if (programacion.pacienteId) {
      paciente = await Paciente.findById(programacion.pacienteId).session(
        session,
      );

      if (!paciente) {
        await session.abortTransaction();

        return res.status(409).json({
          ok: false,
          msg: "La programación está vinculada a un paciente que no existe",
        });
      }

      if (!paciente.hc) {
        await session.abortTransaction();

        return res.status(409).json({
          ok: false,
          msg: "El paciente vinculado no cuenta con historia clínica",
        });
      }

      // Sincronizamos la HC de la programación
      // con la HC oficial del paciente.

      programacion.hc = paciente.hc;
      formaResolucion = "PACIENTE_ID";
    }

    // ==========================================
    // 4.2. PROGRAMACIÓN SIN PACIENTE ID
    // ==========================================
    else {
      const tipoDoc = programacion.tipoDoc?.trim();
      const nroDoc = programacion.nroDoc?.trim();

      // ========================================
      // VALIDAR QUE EXISTA DOCUMENTO
      // ========================================

      if (!tipoDoc || !nroDoc) {
        await session.abortTransaction();

        return res.status(400).json({
          ok: false,
          codigo: "DOCUMENTO_REQUERIDO",
          msg: "No se puede iniciar la atención sin documento de identidad.",
          indicacion:
            "Edite la programación e ingrese el tipo y número de documento antes de continuar.",
        });
      }

      // ========================================
      // BUSCAR PACIENTE POR DOCUMENTO
      // ========================================

      paciente = await Paciente.findOne({
        tipoDoc,
        nroDoc,
      }).session(session);

      // ========================================
      // 4.2.1. EL PACIENTE NO EXISTE
      // CREAR PACIENTE + HC
      // ========================================

      if (!paciente) {
        const datosPaciente = {
          tipoDoc,
          nroDoc,
          nombreCliente: programacion.nombreCliente,
          apePatCliente: programacion.apePatCliente,
          apeMatCliente: programacion.apeMatCliente || "",
          fechaNacimiento: programacion.fechaNacimiento || null,
          sexoCliente: programacion.sexoCliente || null,
        };

        paciente = await registrarPaciente({
          datosPaciente,
          estadoIdentificacion: "PENDIENTE",
          session,
          uid,
          nombreUsuario,
        });

        // ======================================
        // VINCULAR NUEVO PACIENTE
        // ======================================

        programacion.pacienteId = paciente._id;
        programacion.hc = paciente.hc;
        formaResolucion = "PACIENTE_CREADO";
      }

      // ========================================
      // 4.2.2. EL PACIENTE YA EXISTE
      // ========================================
      else {
        // Aquí conservamos TODA la validación
        // de inconsistencia de identidad
        // que acabamos de implementar.

        const validacionIdentidad = validarCoincidenciaIdentidad(
          programacion,
          paciente,
        );

        if (!validacionIdentidad.coincide) {
          await session.abortTransaction();

          return res.status(409).json({
            ok: false,
            codigo: "INCONSISTENCIA_IDENTIDAD",
            msg: "El documento indicado pertenece a un paciente registrado, pero los datos de identidad no coinciden con la programación.",
            indicacion:
              "Verifique los datos y edite la programación antes de iniciar la atención.",

            programacionPaciente: {
              tipoDoc: programacion.tipoDoc,
              nroDoc: programacion.nroDoc,
              nombreCliente: programacion.nombreCliente,
              apePatCliente: programacion.apePatCliente,
              apeMatCliente: programacion.apeMatCliente,
            },

            pacienteRegistrado: {
              hc: paciente.hc,
              tipoDoc: paciente.tipoDoc,
              nroDoc: paciente.nroDoc,
              nombreCliente: paciente.nombreCliente,
              apePatCliente: paciente.apePatCliente,
              apeMatCliente: paciente.apeMatCliente,
            },

            diferencias: validacionIdentidad.diferencias,
          });
        }

        // ========================================
        // VALIDAR HC
        // ========================================

        if (!paciente.hc) {
          await session.abortTransaction();

          return res.status(409).json({
            ok: false,
            msg: "El paciente encontrado no cuenta con historia clínica",
          });
        }

        // ========================================
        // VINCULAR PACIENTE A LA PROGRAMACIÓN
        // ========================================

        programacion.pacienteId = paciente._id;
        programacion.hc = paciente.hc;
        formaResolucion = "DOCUMENTO";
      }
    }

    // ==========================================
    // 5. INICIAR ATENCIÓN
    // ==========================================

    const ahora = new Date();
    programacion.estadoProgramacion = "EN ATENCION";
    programacion.fechaInicioAtencion = ahora;
    programacion.fechaUltimaAtencion = ahora;

    // ==========================================
    // 6. ACTUALIZAR AUDITORÍA
    // ==========================================

    programacion.updatedBy = uid;
    programacion.usuarioActualizacion = nombreUsuario;
    programacion.fechaActualizacion = new Date();

    // ==========================================
    // 7. GUARDAR PROGRAMACIÓN
    // ==========================================

    await programacion.save({
      session,
    });

    // ==========================================
    // 8. CREAR SOLICITUDES DE ATENCIÓN
    // ==========================================

    const solicitudesCreadas = await crearSolicitudesAtencion({
      origenAtencion: "EMPRESA",

      servicios: programacion.serviciosProgramados,

      // ======================================
      // PACIENTE
      // ======================================

      paciente: {
        clienteId: paciente._id,
        hc: paciente.hc,
        tipoDoc: paciente.tipoDoc,
        nroDoc: paciente.nroDoc,
        nombreCliente: paciente.nombreCliente,
        apePatCliente: paciente.apePatCliente,
        apeMatCliente: paciente.apeMatCliente || "",
      },

      // ======================================
      // ORIGEN EMPRESA
      // ======================================

      datosOrigen: {
        programacionEmpresaId: programacion._id,
        codProgramacion: programacion.codProgramacion,
        empresaId: programacion.empresaId,
        razonSocialEmpresa: programacion.razonSocialEmpresa,
        protocoloId: programacion.protocoloId,
        codProtocolo: programacion.codProtocolo,
        nombreProtocolo: programacion.nombreProtocolo,
      },

      session,
      uid,
      nombreUsuario,
    });

    // ==========================================
    // 9. CONFIRMAR TRANSACCIÓN
    // ==========================================

    await session.commitTransaction();

    const mensajesResolucion = {
      PACIENTE_ID: "Paciente existente resuelto correctamente",
      DOCUMENTO: "Paciente encontrado por documento y vinculado correctamente",
      PACIENTE_CREADO: "Paciente registrado y vinculado correctamente",
    };

    return res.status(200).json({
      ok: true,
      msg: "Atención iniciada correctamente",
      formaResolucion,
      paciente: {
        _id: paciente._id,
        hc: paciente.hc,
        estadoIdentificacion: paciente.estadoIdentificacion,
      },
      programacion,
      solicitudes: solicitudesCreadas,
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
