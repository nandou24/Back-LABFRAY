const { response } = require("express");
const mongoose = require("mongoose");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");
const Empresa = require("../../models/Mantenimiento/Empresa");
const Paciente = require("../../models/Mantenimiento/Paciente");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
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

// ====== Normalizar plazo del protocolo ======

const normalizarPlazoResultados = (plazo) => {
  const cantidadDias = Number(plazo?.cantidadDias);
  const tipoDias = String(plazo?.tipoDias ?? "").trim().toUpperCase();

  if (!Number.isInteger(cantidadDias) || cantidadDias < 1) {
    throw new Error(
      "El protocolo seleccionado no tiene un plazo de resultados válido",
    );
  }

  if (!["HABILES", "CALENDARIO"].includes(tipoDias)) {
    throw new Error(
      "El protocolo seleccionado no tiene definido el tipo de días del plazo",
    );
  }

  return { cantidadDias, tipoDias };
};

// ====== Resolver snapshot contractual del protocolo ======

const resolverSnapshotProtocolo = async ({ empresaId, protocoloId }) => {
  if (!mongoose.Types.ObjectId.isValid(empresaId)) {
    throw new Error("La empresa seleccionada no es válida");
  }

  if (!mongoose.Types.ObjectId.isValid(protocoloId)) {
    throw new Error("El protocolo seleccionado no es válido");
  }

  const empresa = await Empresa.findById(empresaId).lean();

  if (!empresa || empresa.estado === false) {
    throw new Error("La empresa seleccionada no existe o se encuentra inactiva");
  }

  const protocolo = (empresa.protocolos ?? []).find(
    (item) => item?._id?.toString() === protocoloId.toString(),
  );

  if (!protocolo) {
    throw new Error("El protocolo seleccionado no pertenece a la empresa");
  }

  if (protocolo.estado === false) {
    throw new Error("El protocolo seleccionado se encuentra inactivo");
  }

  const serviciosProgramados = Array.isArray(protocolo.servicios)
    ? protocolo.servicios.map((servicio) => ({
        servicioId: servicio.servicioId,
        codServicio: servicio.codServicio,
        nombreServicio: servicio.nombreServicio,
        tipoServicio: servicio.tipoServicio,
      }))
    : [];

  if (serviciosProgramados.length === 0) {
    throw new Error("El protocolo seleccionado no tiene servicios configurados");
  }

  return {
    empresaId: empresa._id,
    rucEmpresa: empresa.ruc,
    razonSocialEmpresa: empresa.razonSocial,
    nombreComercialEmpresa: empresa.nombreComercial ?? "",
    protocoloId: protocolo._id,
    codProtocolo: protocolo.codigoProtocolo,
    nombreProtocolo: protocolo.nombreProtocolo,
    serviciosProgramados,
    plazoResultados: normalizarPlazoResultados(protocolo.plazoResultados),
  };
};

// ====== Identificación opcional y prevención de duplicados ======
const normalizarDocumentoProgramacion = (datos) => {
  const nroDoc = String(datos.nroDoc ?? "").trim().toUpperCase();
  const tipoDoc = nroDoc ? String(datos.tipoDoc ?? "").trim().toUpperCase() : null;
  if (nroDoc) {
    const formatos = {
      DNI: /^\d{8}$/,
      CE: /^[A-Z0-9]{1,13}$/,
      PASAPORTE: /^[A-Z0-9]{1,16}$/,
    };
    if (!formatos[tipoDoc]?.test(nroDoc)) {
      throw new Error("Documento inválido para el tipo seleccionado");
    }
  }
  return { tipoDoc, nroDoc: nroDoc || null };
};

const expresionNombre = (valor) => {
  const limpio = String(valor ?? "").trim().replace(/\s+/g, " ");
  const escapado = limpio.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${escapado.replace(/ /g, "\\s+")}\\s*$`, "i");
};

const filtroDuplicadoProgramacion = (datos, exceptoId = null) => {
  const { inicioDia, finDia } = construirRangoDia(datos.fechaProgramada);
  const filtro = {
    empresaId: datos.empresaId,
    protocoloId: datos.protocoloId,
    fechaProgramada: { $gte: inicioDia, $lte: finDia },
  };
  if (exceptoId) filtro._id = { $ne: exceptoId };

  if (datos.pacienteId) {
    filtro.$or = [{ pacienteId: datos.pacienteId }];
    if (datos.tipoDoc && datos.nroDoc) {
      filtro.$or.push({ tipoDoc: datos.tipoDoc, nroDoc: datos.nroDoc });
    }
  } else if (datos.tipoDoc && datos.nroDoc) {
    filtro.tipoDoc = datos.tipoDoc;
    filtro.nroDoc = datos.nroDoc;
  } else {
    // Sin documento, identificar coincidencias de nombre dentro del mismo protocolo y fecha.
    filtro.nroDoc = { $in: [null, ""] };
    filtro.nombreCliente = expresionNombre(datos.nombreCliente);
    filtro.apePatCliente = expresionNombre(datos.apePatCliente);
    if (String(datos.apeMatCliente ?? "").trim()) {
      filtro.apeMatCliente = expresionNombre(datos.apeMatCliente);
    } else {
      filtro.apeMatCliente = { $in: [null, ""] };
    }
  }
  return filtro;
};

const camposIdentidadProgramacion = [
  "tipoDoc", "nroDoc", "nombreCliente", "apePatCliente", "apeMatCliente",
  "pacienteId", "hc", "sexoCliente", "fechaNacimiento",
];
const cambiaIdentidad = (antes, propuesta) => camposIdentidadProgramacion.some((campo) => {
  if (!(campo in propuesta)) return false;
  const previo = antes[campo] instanceof Date ? antes[campo].toISOString() : antes[campo];
  const nuevo = propuesta[campo] instanceof Date ? propuesta[campo].toISOString() : propuesta[campo];
  return String(previo ?? "").trim().toUpperCase() !== String(nuevo ?? "").trim().toUpperCase();
});

const crearProgramacion = async (req, res = response) => {
  try {
    const { empresaId, protocoloId } = req.body;

    // ====== Congelar protocolo vigente ======

    const snapshotProtocolo = await resolverSnapshotProtocolo({
      empresaId,
      protocoloId,
    });

    const documento = normalizarDocumentoProgramacion(req.body);
    const datosIdentidad = { ...req.body, ...documento };
    const programacionDuplicada = await ProgramacionPacienteEmpresa.findOne(
      filtroDuplicadoProgramacion(datosIdentidad),
    ).lean();

    if (programacionDuplicada) {
      return res.status(409).json({
        ok: false,
        msg: "Ya existe una programación para este paciente, empresa y protocolo en la misma fecha",
      });
    }

    const codProgramacion = await generarCodigoProgramacion();
    const programacion = new ProgramacionPacienteEmpresa({
      ...req.body,
      ...documento,
      ...snapshotProtocolo,
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
    return res.status(400).json({
      ok: false,
      msg: error.message || "Error al registrar la programación",
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
      // ====== El registro manual usa día local; Excel utiliza día calendario ======
      const fechaLocal = {};
      const fechaExcel = {};
      const diaPeru = (valor) => {
        const partes = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(new Date(valor));
        const obtener = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
        return `${obtener('year')}-${obtener('month')}-${obtener('day')}`;
      };
      if (fechaInicio) {
        fechaLocal.$gte = new Date(fechaInicio);
        fechaExcel.$gte = new Date(`${diaPeru(fechaInicio)}T00:00:00.000Z`);
      }
      if (fechaFin) {
        fechaLocal.$lte = new Date(fechaFin);
        fechaExcel.$lte = new Date(`${diaPeru(fechaFin)}T23:59:59.999Z`);
      }
      // Incluye importaciones anteriores a la corrección de huso horario.
      filtro.$or = [
        { origenRegistro: { $ne: 'IMPORTACION_EXCEL' }, fechaProgramada: fechaLocal },
        { origenRegistro: 'IMPORTACION_EXCEL', fechaProgramada: fechaExcel },
      ];
    }

    const programaciones = await ProgramacionPacienteEmpresa.find(filtro)
      .sort({ fechaProgramada: -1, horaProgramada: -1 })
      .lean();

    // ====== Estado de identificación del paciente vinculado ======
    const pacienteIds = [...new Set(programaciones
      .filter((item) => item.pacienteId)
      .map((item) => String(item.pacienteId)))];
    const pacientes = pacienteIds.length
      ? await Paciente.find({ _id: { $in: pacienteIds } })
          .select('_id estadoIdentificacion')
          .lean()
      : [];
    const estados = new Map(pacientes.map((p) => [String(p._id), p.estadoIdentificacion]));
    const respuesta = programaciones.map((item) => ({
      ...item,
      estadoIdentificacionPaciente: item.pacienteId
        ? (estados.get(String(item.pacienteId)) ?? null)
        : null,
    }));

    return res.json({ ok: true, programaciones: respuesta });
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
    const programacionActual = await ProgramacionPacienteEmpresa.findById(
      req.params.id,
    );

    if (!programacionActual) {
      return res
        .status(404)
        .json({ ok: false, msg: "Programación no encontrada" });
    }

    const datosActualizables = { ...req.body };
    const actualizaDocumento = "nroDoc" in req.body || "tipoDoc" in req.body;
    if (actualizaDocumento) {
      const documento = normalizarDocumentoProgramacion({
        tipoDoc: req.body.tipoDoc ?? programacionActual.tipoDoc,
        nroDoc: req.body.nroDoc ?? ("nroDoc" in req.body ? null : programacionActual.nroDoc),
      });
      Object.assign(datosActualizables, documento);
    }

    // ====== Proteger historia clínica y solicitudes existentes ======
    if ((programacionActual.pacienteId || programacionActual.estadoProgramacion !== "PROGRAMADO") &&
        cambiaIdentidad(programacionActual, datosActualizables)) {
      return res.status(409).json({
        ok: false,
        codigo: "IDENTIDAD_VINCULADA",
        msg: "La identidad ya está vinculada a un paciente o una atención. No puede modificarse únicamente desde la programación.",
      });
    }

    if (!programacionActual.pacienteId && programacionActual.estadoProgramacion === "PROGRAMADO") {
      // La vinculación a un paciente existente debe hacerse por búsqueda, no enviando un ID arbitrario.
      if (datosActualizables.pacienteId &&
          String(datosActualizables.pacienteId) !== String(programacionActual.pacienteId ?? "")) {
        const paciente = await Paciente.findById(datosActualizables.pacienteId).lean();
        if (!paciente || !paciente.hc) {
          return res.status(409).json({ ok: false, msg: "Paciente seleccionado no válido" });
        }
        if (!validarCoincidenciaIdentidad(datosActualizables, paciente).coincide) {
          return res.status(409).json({ ok: false, msg: "Los nombres no coinciden con el paciente vinculado" });
        }
        if (String(datosActualizables.tipoDoc ?? "") !== String(paciente.tipoDoc ?? "") ||
            String(datosActualizables.nroDoc ?? "") !== String(paciente.nroDoc ?? "")) {
          return res.status(409).json({ ok: false, msg: "El documento no coincide con el paciente seleccionado" });
        }
        datosActualizables.hc = paciente.hc;
      }
    }

    delete datosActualizables.codProgramacion;
    delete datosActualizables.estadoProgramacion;
    delete datosActualizables.createdBy;
    delete datosActualizables.usuarioRegistro;
    delete datosActualizables.plazoResultados;
    delete datosActualizables.serviciosProgramados;
    delete datosActualizables.codProtocolo;
    delete datosActualizables.nombreProtocolo;
    delete datosActualizables.rucEmpresa;
    delete datosActualizables.razonSocialEmpresa;
    delete datosActualizables.nombreComercialEmpresa;

    const empresaIdNuevo = String(
      req.body.empresaId ?? programacionActual.empresaId ?? "",
    );
    const protocoloIdNuevo = String(
      req.body.protocoloId ?? programacionActual.protocoloId ?? "",
    );

    const cambioContrato =
      empresaIdNuevo !== String(programacionActual.empresaId ?? "") ||
      protocoloIdNuevo !== String(programacionActual.protocoloId ?? "");

    if (cambioContrato) {
      const snapshotProtocolo = await resolverSnapshotProtocolo({
        empresaId: empresaIdNuevo,
        protocoloId: protocoloIdNuevo,
      });

      Object.assign(datosActualizables, snapshotProtocolo);
    } else {
      delete datosActualizables.empresaId;
      delete datosActualizables.protocoloId;
    }

    const condiciones = {
      ...programacionActual.toObject(),
      ...datosActualizables,
      empresaId: empresaIdNuevo,
      protocoloId: protocoloIdNuevo,
    };
    if ("fechaProgramada" in req.body || "tipoDoc" in req.body ||
        "nroDoc" in req.body || "empresaId" in req.body ||
        "protocoloId" in req.body || "nombreCliente" in req.body ||
        "apePatCliente" in req.body || "apeMatCliente" in req.body) {
      const duplicada = await ProgramacionPacienteEmpresa.findOne(
        filtroDuplicadoProgramacion(condiciones, programacionActual._id),
      ).lean();
      if (duplicada) {
        return res.status(409).json({
          ok: false,
          msg: "Ya existe una programación para este trabajador, empresa y protocolo en la misma fecha",
        });
      }
    }

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

    return res.json({
      ok: true,
      msg: "Programación actualizada correctamente",
      programacion,
    });
  } catch (error) {
    console.error("Error al actualizar programación empresarial:", error);
    return res.status(400).json({
      ok: false,
      msg: error.message || "Datos de programación inválidos",
    });
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

      // ====== Documento opcional, pero siempre completo ======
      if (Boolean(tipoDoc) !== Boolean(nroDoc)) {
        await session.abortTransaction();
        return res.status(409).json({
          ok: false,
          codigo: "DOCUMENTO_INCOMPLETO",
          msg: "El tipo y número de documento deben registrarse juntos.",
        });
      }

      if (!tipoDoc && !nroDoc) {
        // ====== Evitar crear otra HC ante coincidencias de identidad ======
        const filtroNombre = {
          nombreCliente: expresionNombre(programacion.nombreCliente),
          apePatCliente: expresionNombre(programacion.apePatCliente),
          apeMatCliente: String(programacion.apeMatCliente ?? "").trim()
            ? expresionNombre(programacion.apeMatCliente)
            : { $in: [null, ""] },
        };
        const candidatos = await Paciente.find(filtroNombre)
          .select("_id hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente")
          .limit(5)
          .session(session)
          .lean();

        if (candidatos.length) {
          await session.abortTransaction();
          return res.status(409).json({
            ok: false,
            codigo: "POSIBLE_PACIENTE_EXISTENTE",
            msg: "Hay pacientes registrados con los mismos nombres y apellidos. Revise la identidad antes de generar otra historia clínica.",
            indicacion: "Seleccione el paciente desde Buscar paciente registrado en la programación, o complete su documento antes de iniciar.",
            candidatos: candidatos.map(({ _id, hc, tipoDoc, nroDoc }) => ({
              pacienteId: _id,
              hc,
              tipoDoc: tipoDoc ?? null,
              nroDoc: nroDoc ?? null,
            })),
          });
        }

        const datosPaciente = {
          tipoDoc: null,
          nroDoc: null,
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

        programacion.pacienteId = paciente._id;
        programacion.hc = paciente.hc;
        formaResolucion = "PACIENTE_SIN_DOCUMENTO";
      } else {
        // ====== Buscar paciente por documento ======
        paciente = await Paciente.findOne({ tipoDoc, nroDoc }).session(session);
      }

      // ========================================
      // 4.2.1. EL PACIENTE NO EXISTE
      // CREAR PACIENTE + HC
      // ========================================

      if (tipoDoc && nroDoc && !paciente) {
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
      else if (tipoDoc && nroDoc) {
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
        plazoResultados: programacion.plazoResultados ?? null,
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
      PACIENTE_SIN_DOCUMENTO: "Paciente con identificación pendiente registrado y vinculado correctamente",
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


// ====== Regularizar documento de paciente con identificación pendiente ======
const regularizarDocumentoProgramacion = async (req, res = response) => {
  const { id } = req.params;
  const { uid, nombreUsuario } = req.user;
  const tipoDoc = String(req.body.tipoDoc ?? '').trim().toUpperCase();
  const nroDoc = String(req.body.nroDoc ?? '').trim().toUpperCase();
  const motivo = String(req.body.motivo ?? '').trim();

  const formatos = {
    DNI: /^\d{8}$/,
    CE: /^[A-Z0-9]{1,13}$/,
    PASAPORTE: /^[A-Z0-9]{1,16}$/,
  };

  if (!formatos[tipoDoc]?.test(nroDoc) || motivo.length < 10) {
    return res.status(400).json({
      ok: false,
      codigo: 'DATOS_INVALIDOS',
      msg: 'Ingrese un documento válido y un motivo de al menos 10 caracteres.',
    });
  }

  const session = await mongoose.startSession();
  try {
    let resultado;
    await session.withTransaction(async () => {
      const errorNegocio = (codigo, msg, status = 409) => {
        const error = new Error(msg);
        error.codigo = codigo;
        error.status = status;
        throw error;
      };

      const programacion = await ProgramacionPacienteEmpresa.findById(id).session(session);
      if (!programacion) {
        errorNegocio('PROGRAMACION_NO_ENCONTRADA', 'La programación no existe.', 404);
      }
      if (!programacion.pacienteId || !programacion.hc) {
        errorNegocio('PACIENTE_NO_VINCULADO', 'Inicie la atención o vincule una historia clínica antes de regularizar el documento.');
      }

      const paciente = await Paciente.findById(programacion.pacienteId).session(session);
      if (!paciente || String(paciente.hc) !== String(programacion.hc)) {
        errorNegocio('VINCULO_INVALIDO', 'La historia clínica vinculada no coincide con la programación.');
      }
      if (paciente.estadoIdentificacion !== 'PENDIENTE') {
        errorNegocio('IDENTIFICACION_REGISTRADA', 'El paciente ya tiene identificación REGISTRADA. La modificación requiere el procedimiento de corrección del maestro de pacientes.');
      }
      if (!validarCoincidenciaIdentidad(programacion, paciente).coincide) {
        errorNegocio('INCONSISTENCIA_IDENTIDAD', 'Los nombres de la programación y del paciente no coinciden. Revise la identidad antes de continuar.');
      }
      if (paciente.tipoDoc === tipoDoc && paciente.nroDoc === nroDoc) {
        errorNegocio('SIN_CAMBIOS', 'El documento ingresado es igual al documento actual.');
      }

      const otroPaciente = await Paciente.findOne({
        _id: { $ne: paciente._id }, tipoDoc, nroDoc,
      }).session(session).lean();
      if (otroPaciente) {
        errorNegocio('DOCUMENTO_YA_REGISTRADO', 'El documento ya pertenece a otra historia clínica. No se fusionarán pacientes automáticamente.');
      }

      const ahora = new Date();
      const anterior = { tipoDoc: paciente.tipoDoc ?? null, nroDoc: paciente.nroDoc ?? null };
      paciente.tipoDoc = tipoDoc;
      paciente.nroDoc = nroDoc;
      paciente.historialDocumentos.push({
        ...anterior,
        tipoDocNuevo: tipoDoc,
        nroDocNuevo: nroDoc,
        motivo,
        fecha: ahora,
        uid,
        nombreUsuario,
      });
      paciente.updatedBy = uid;
      paciente.usuarioActualizacion = nombreUsuario;
      paciente.fechaActualizacion = ahora;
      // La identificación sigue PENDIENTE hasta su validación formal.
      await paciente.save({ session });

      const auditoria = {
        tipoDoc, nroDoc,
        updatedBy: uid,
        usuarioActualizacion: nombreUsuario,
        fechaActualizacion: ahora,
      };
      await ProgramacionPacienteEmpresa.updateMany(
        { pacienteId: paciente._id },
        { $set: auditoria },
        { session, runValidators: true },
      );
      await SolicitudAtencion.updateMany(
        { clienteId: paciente._id },
        { $set: auditoria },
        { session, runValidators: true },
      );

      const programacionActualizada = await ProgramacionPacienteEmpresa
        .findById(programacion._id).session(session).lean();
      resultado = {
        programacion: {
          ...programacionActualizada,
          estadoIdentificacionPaciente: paciente.estadoIdentificacion,
        },
        paciente: { _id: paciente._id, hc: paciente.hc, estadoIdentificacion: paciente.estadoIdentificacion },
      };
    });

    return res.json({
      ok: true,
      msg: 'Documento actualizado en paciente, programaciones y solicitudes vinculadas. Identificación pendiente de validar.',
      ...resultado,
    });
  } catch (error) {
    console.error('Error al regularizar documento empresarial:', error);
    return res.status(error.status ?? 500).json({
      ok: false,
      codigo: error.codigo ?? 'ERROR_REGULARIZACION',
      msg: error.codigo ? error.message : 'No se pudo regularizar el documento.',
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
  regularizarDocumentoProgramacion,
};
