const { randomUUID } = require('crypto');
const { response } = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const RecursoHumano = require("../../models/Mantenimiento/RecHumano");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");
const Empresa = require("../../models/Mantenimiento/Empresa");
const Paciente = require("../../models/Mantenimiento/Paciente");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ArchivoPaciente = require("../../models/Mantenimiento/ArchivoPaciente");
const { crearSolicitudesAtencion } = require("./solicitudAtencionController");

const { registrarPaciente } = require("../Mantenimiento/pacienteController");
const { buscarCoincidenciasVinculacion } = require("../../utils/Gestion/buscarCoincidenciasVinculacion");
const { obtenerConflictoRevisionIdentidad } = require("../../utils/Gestion/obtenerConflictoRevisionIdentidad");
const { evaluarIdentidadParaNuevaHC, obtenerUltimasDecisiones } = require("../../utils/Gestion/evaluarIdentidadParaNuevaHC");

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
      pacienteId: null,
      hc: null,
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

// ====== Determinar alcance de gestión documental empresarial ======
const obtenerAccionDocumentoPaciente = (paciente) => {
  if (!paciente || paciente.estadoIdentificacion !== 'PENDIENTE') return null;
  const tieneDocumento = Boolean(paciente.tipoDoc && paciente.nroDoc);
  if (!paciente.tipoDoc && !paciente.nroDoc) return 'REGULARIZAR';
  if (!tieneDocumento) return null;
  const primerCambio = paciente.historialDocumentos?.[0];
  // Solo se corrige aquí un documento asignado inicialmente desde "sin documento".
  const provieneDeRegularizacion = primerCambio &&
    !primerCambio.tipoDoc && !primerCambio.nroDoc &&
    (primerCambio.tipoOperacion ?? 'REGULARIZACION') === 'REGULARIZACION' &&
    Boolean(primerCambio.tipoDocNuevo && primerCambio.nroDocNuevo);
  return provieneDeRegularizacion ? 'CORREGIR' : null;
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
          .select('_id estadoIdentificacion tipoDoc nroDoc historialDocumentos')
          .lean()
      : [];
    const pacientesPorId = new Map(pacientes.map((p) => [String(p._id), p]));
    const respuesta = programaciones.map((item) => {
      const paciente = item.pacienteId ? pacientesPorId.get(String(item.pacienteId)) : null;
      return {
        ...item,
        accionDocumentoPaciente: obtenerAccionDocumentoPaciente(paciente),
      };
    });

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

    // ====== Vinculación solo por endpoint auditado ======
    if ((req.body.pacienteId && String(req.body.pacienteId) !== String(programacionActual.pacienteId ?? '')) ||
        (req.body.hc && String(req.body.hc) !== String(programacionActual.hc ?? ''))) {
      return res.status(409).json({ ok:false,
        msg:'La vinculación de HC se realiza desde la revisión de coincidencias.' });
    }
    const datosActualizables = { ...req.body };
    delete datosActualizables.pacienteId;
    delete datosActualizables.hc;
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

    // ====== No ignorar una decisión documental anterior no resuelta ======
    const conflictoVigente = obtenerConflictoRevisionIdentidad(programacion);
    if (!programacion.pacienteId && programacion.nroDoc && conflictoVigente) {
      await session.abortTransaction();
      return res.status(409).json({ ok:false, codigo:'REVISION_IDENTIDAD_PENDIENTE',
        msg:'Esta programación tiene una revisión de identidad pendiente de resolver. No puede iniciar atención por vinculación automática.' });
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
        // ====== Sin DNI: solicitud temporal, NO crear paciente ni HC ======
        programacion.pacienteId = null;
        programacion.hc = null;
        programacion.identidadTemporalActiva = true;
        programacion.fechaInicioIdentidadTemporal = new Date();
        formaResolucion = 'IDENTIDAD_TEMPORAL';
      } else {
        // ====== Reevaluar todo el maestro antes de crear la HC ======
        const coincidencias = await buscarCoincidenciasVinculacion(
          Paciente, programacion, validarCoincidenciaIdentidad, session,
        );
        const evaluacion = evaluarIdentidadParaNuevaHC(programacion, coincidencias);
        if (!evaluacion.permiteCrear) {
          await session.abortTransaction();
          return res.status(409).json({
            ok: false, codigo: evaluacion.codigo, msg: evaluacion.msg,
            candidatos: evaluacion.candidatos.map(item => ({ pacienteId: item.pacienteId, hc: item.hc })),
          });
        }
        // ====== Sin coincidencias ni pendientes: crear alta documentada de empresa ======
        const datosPaciente = {
          tipoDoc, nroDoc,
          nombreCliente: programacion.nombreCliente,
          apePatCliente: programacion.apePatCliente,
          apeMatCliente: programacion.apeMatCliente || '',
          fechaNacimiento: programacion.fechaNacimiento || null,
          sexoCliente: programacion.sexoCliente || null,
          origenAlta: 'CAMPANA_EMPRESA',
        };
        paciente = await registrarPaciente({
          datosPaciente, estadoIdentificacion: 'REGISTRADA',
          session, uid, nombreUsuario,
        });
        programacion.pacienteId = paciente._id;
        programacion.hc = paciente.hc;
        formaResolucion = 'PACIENTE_CREADO';
      }

    }

    // ==========================================
    // 5. INICIAR ATENCIÓN
    // ==========================================

    const ahora = new Date();
    // ====== Auditar primera vinculación realizada al iniciar atención ======
    if (paciente?._id && !Array.isArray(programacion.historialVinculaciones)) {
      programacion.historialVinculaciones = [];
    }
    if (paciente?._id && !programacion.historialVinculaciones.some(item => item.tipo === 'VINCULACION_INICIAL')) {
      const nombreCompletoUsuario = await obtenerNombreCompletoOperador({ uid, nombreUsuario, session });
      programacion.historialVinculaciones.push({
        tipo:'VINCULACION_INICIAL', pacienteIdAnterior:null, hcAnterior:null,
        pacienteIdNuevo:paciente._id, hcNueva:paciente.hc, fecha:ahora,
        ejecutadoPor:uid, usuario:nombreUsuario, nombreCompletoUsuario, origenDocumento:'EMPRESA',
        tipoResolucion: formaResolucion === 'PACIENTE_CREADO' ? 'ALTA_NUEVA_EMPRESA' : 'COINCIDENCIA_EXACTA'
      });
    }
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

      paciente: formaResolucion === 'IDENTIDAD_TEMPORAL' ? {
        clienteId: null, hc: null, tipoDoc: null, nroDoc: null,
        nombreCliente: programacion.nombreCliente,
        apePatCliente: programacion.apePatCliente,
        apeMatCliente: programacion.apeMatCliente || '',
      } : {
        clienteId: paciente._id, hc: paciente.hc,
        tipoDoc: paciente.tipoDoc, nroDoc: paciente.nroDoc,
        nombreCliente: paciente.nombreCliente,
        apePatCliente: paciente.apePatCliente,
        apeMatCliente: paciente.apeMatCliente || '',
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
        identidadTemporal: formaResolucion === 'IDENTIDAD_TEMPORAL',
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
      IDENTIDAD_TEMPORAL: "Atención temporal iniciada sin crear paciente ni HC. La liberación quedará bloqueada hasta resolver el documento.",
    };

    return res.status(200).json({
      ok: true,
      msg: mensajesResolucion[formaResolucion] ?? 'Atención iniciada correctamente',
      formaResolucion,
      paciente: paciente ? { _id: paciente._id, hc: paciente.hc } : null,
      programacion: {
        ...programacion.toObject(),
        accionDocumentoPaciente: obtenerAccionDocumentoPaciente(paciente),
      },
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



// ====== Detectar coincidencias documentales sin fusionar pacientes ======
const buscarCoincidenciasDocumentoHC = async ({ pacienteId, tipoDoc, nroDoc, session = null }) => {
  const filtro = {
    _id: { $ne: pacienteId },
    $or: [
      { tipoDoc, nroDoc },
      { historialDocumentos: { $elemMatch: { tipoDoc, nroDoc } } },
      { historialDocumentos: { $elemMatch: { tipoDocNuevo: tipoDoc, nroDocNuevo: nroDoc } } },
    ],
  };
  const encontrados = await Paciente.find(filtro)
    .select('_id hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente historialDocumentos')
    .limit(21).session(session).lean();
  return {
    hayCoincidencias: encontrados.length > 0,
    masResultados: encontrados.length > 20,
    candidatos: encontrados.slice(0, 20).map((p) => ({
      pacienteId: String(p._id), hc: p.hc,
      nombreCompleto: [p.apePatCliente, p.apeMatCliente, p.nombreCliente].filter(Boolean).join(' '),
      coincidencia: p.tipoDoc === tipoDoc && p.nroDoc === nroDoc ? 'DOCUMENTO_ACTUAL' : 'HISTORIAL_DOCUMENTO',
    })),
  };
};

// ====== Verificación de solo lectura; no vincula ni fusiona historias ======
const verificarDocumentoProgramacion = async (req, res = response) => {
  try {
    const tipoDoc = String(req.body?.tipoDoc ?? '').trim().toUpperCase();
    const nroDoc = String(req.body?.nroDoc ?? '').trim().toUpperCase();
    const formatos = { DNI: /^\d{8}$/, CE: /^[A-Z0-9]{1,13}$/, PASAPORTE: /^[A-Z0-9]{1,16}$/ };
    if (!formatos[tipoDoc]?.test(nroDoc)) {
      return res.status(400).json({ ok: false, codigo: 'DOCUMENTO_INVALIDO', msg: 'Documento no válido.' });
    }
    const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id).select('pacienteId hc').lean();
    if (!programacion?.pacienteId || !programacion.hc) {
      return res.status(409).json({ ok: false, codigo: 'PACIENTE_NO_VINCULADO', msg: 'La programación no tiene una HC vinculada.' });
    }
    const paciente = await Paciente.findById(programacion.pacienteId)
      .select('hc estadoIdentificacion tipoDoc nroDoc historialDocumentos').lean();
    if (!paciente || String(paciente.hc) !== String(programacion.hc) ||
        !['REGULARIZAR', 'CORREGIR'].includes(obtenerAccionDocumentoPaciente(paciente))) {
      return res.status(409).json({ ok: false, codigo: 'GESTION_DOCUMENTAL_NO_PERMITIDA', msg: 'La HC no permite cambiar su documento desde Programaciones.' });
    }
    const coincidencias = await buscarCoincidenciasDocumentoHC({ pacienteId: paciente._id, tipoDoc, nroDoc });
    return res.json({ ok: true, tipoDoc, nroDoc, ...coincidencias,
      msg: coincidencias.hayCoincidencias
        ? 'Se detectaron otras HC vinculadas con este documento. Se requiere resolver la identidad desde el procedimiento de regularización de atención.'
        : 'No se encontraron coincidencias documentales en otras HC. La identidad aún requiere validación.' });
  } catch (error) {
    console.error('Error al verificar documento de HC:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo verificar el documento.' });
  }
};

// ====== Regularizar documento de paciente con identificación pendiente ======
const regularizarDocumentoProgramacion = async (req, res = response) => {
  const { id } = req.params;
  const { uid, nombreUsuario } = req.user;
  const tipoDoc = String(req.body.tipoDoc ?? '').trim().toUpperCase();
  const nroDoc = String(req.body.nroDoc ?? '').trim().toUpperCase();
  const motivo = String(req.body.motivo ?? '').trim();

  if (req.body.identidadConfirmada !== true) {
    return res.status(400).json({ ok: false, codigo: 'IDENTIDAD_NO_CONFIRMADA', msg: 'Debe confirmar que verificó la identidad del paciente.' });
  }

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
        errorNegocio('IDENTIFICACION_REGISTRADA', 'El documento de un paciente del maestro no puede modificarse desde Programaciones de Empresas.');
      }
      if (obtenerAccionDocumentoPaciente(paciente) !== 'REGULARIZAR') {
        errorNegocio('REGULARIZACION_NO_PERMITIDA', 'El paciente ya tiene un documento o no proviene de una programación sin documento. Una corrección posterior exige segunda autorización.');
      }
      if (!validarCoincidenciaIdentidad(programacion, paciente).coincide) {
        errorNegocio('INCONSISTENCIA_IDENTIDAD', 'Los nombres de la programación y del paciente no coinciden. Revise la identidad antes de continuar.');
      }
      if (paciente.tipoDoc === tipoDoc && paciente.nroDoc === nroDoc) {
        errorNegocio('SIN_CAMBIOS', 'El documento ingresado es igual al documento actual.');
      }

      // ====== Revisar documento vigente e histórico en otras HC ======
      const coincidencias = await buscarCoincidenciasDocumentoHC({ pacienteId: paciente._id, tipoDoc, nroDoc, session });
      if (coincidencias.hayCoincidencias) {
        const error = new Error('Documento encontrado en otra HC. No se modificó ninguna historia. Revise la identidad; no está permitido asignar el documento a dos pacientes.');
        error.codigo = 'POSIBLE_CONCILIACION_HC'; error.status = 409;
        error.coincidencias = coincidencias;
        throw error;
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
        tipoOperacion: 'REGULARIZACION',
        cambios: [
          ...(anterior.tipoDoc !== tipoDoc ? [{ campo: 'tipoDoc', valorAnterior: anterior.tipoDoc, valorNuevo: tipoDoc }] : []),
          ...(anterior.nroDoc !== nroDoc ? [{ campo: 'nroDoc', valorAnterior: anterior.nroDoc, valorNuevo: nroDoc }] : []),
        ],
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
            accionDocumentoPaciente: obtenerAccionDocumentoPaciente(paciente),
        },
        paciente: { _id: paciente._id, hc: paciente.hc },
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
      coincidencias: error.coincidencias ?? null,
      msg: error.codigo ? error.message : 'No se pudo regularizar el documento.',
    });
  } finally {
    await session.endSession();
  }
};


// ====== Comprobar permiso de un segundo usuario ======
const autorizarCorreccionDocumento = async (datos, ejecutor, session) => {
  const nombre = String(datos.nombreUsuarioAutorizador ?? '').trim();
  const password = datos.passwordAutorizador;
  const denegar = (msg) => {
    const error = new Error(msg);
    error.status = 403;
    error.codigo = 'AUTORIZACION_DENEGADA';
    throw error;
  };
  if (!nombre || typeof password !== 'string' || !password) {
    denegar('Se requiere el usuario y la contraseña del responsable que autoriza la corrección.');
  }
  const responsable = await RecursoHumano.findOne({ 'datosLogueo.nombreUsuario': nombre })
    .populate({ path: 'datosLogueo.rol', populate: { path: 'rutasPermitidas' } })
    .session(session);
  if (!responsable?.datosLogueo?.estado || !responsable.datosLogueo.passwordHash) {
    denegar('El usuario autorizador no existe o se encuentra inactivo.');
  }
  if (!await bcrypt.compare(password, responsable.datosLogueo.passwordHash)) {
    denegar('Las credenciales de autorización son incorrectas.');
  }
  const uidAutorizador = String(responsable.codRecHumano ?? '').trim();
  const loginAutorizador = String(responsable.datosLogueo.nombreUsuario ?? '').trim();
  if (!uidAutorizador || uidAutorizador === String(ejecutor.uid ?? '').trim() ||
      loginAutorizador.toLowerCase() === String(ejecutor.nombreUsuario ?? '').trim().toLowerCase()) {
    denegar('El autorizador debe ser un usuario distinto del operador que realiza el cambio.');
  }
  const rol = responsable.datosLogueo.rol;
  if (!rol || rol.estado === false) denegar('El rol del autorizador se encuentra inactivo.');
  // ====== Reutilizar el criterio de acceso por rutas de Toma de Muestras ======
  const rutas = Array.isArray(rol.rutasPermitidas) ? rol.rutasPermitidas : [];
  const tieneAcceso = rutas.some((ruta) => {
    if (!ruta || ruta.estado === false) return false;
    const url = String(ruta.urlRuta ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    return /(^|\/)(programacion-empresas|programacion-empresa|programacionpacienteempresa)$/.test(url);
  });
  if (!tieneAcceso) denegar('El autorizador no tiene habilitada la ruta de Programaciones de Empresas.');
  return {
    autorizadoPor: uidAutorizador,
    usuarioAutorizacion: loginAutorizador,
    rolAutorizacion: rol.nombreRol ?? null,
  };
};

// ====== Consultar historial de documento del paciente ======
const obtenerHistorialDocumentoProgramacion = async (req, res = response) => {
  try {
    const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id)
      .select('pacienteId hc').lean();
    if (!programacion?.pacienteId || !programacion.hc) {
      return res.status(404).json({ ok: false, msg: 'No existe una historia clínica vinculada.' });
    }
    const paciente = await Paciente.findById(programacion.pacienteId)
      .select('hc historialDocumentos').lean();
    if (!paciente || String(paciente.hc) !== String(programacion.hc)) {
      return res.status(409).json({ ok: false, msg: 'La vinculación con la historia clínica es inválida.' });
    }
    // ====== Preservar compatibilidad con registros previos ======
    const historial = [...(paciente.historialDocumentos ?? [])].reverse().map((cambio) => ({
      fecha: cambio.fecha,
      tipoOperacion: cambio.tipoOperacion ?? 'REGULARIZACION',
      tipoDocAnterior: cambio.tipoDoc ?? null,
      nroDocAnterior: cambio.nroDoc ?? null,
      tipoDocNuevo: cambio.tipoDocNuevo,
      nroDocNuevo: cambio.nroDocNuevo,
      motivo: cambio.motivo,
      uid: cambio.uid,
      nombreUsuario: cambio.nombreUsuario,
      autorizadoPor: cambio.autorizadoPor ?? null,
      usuarioAutorizacion: cambio.usuarioAutorizacion ?? null,
      rolAutorizacion: cambio.rolAutorizacion ?? null,
      cambios: cambio.cambios?.length ? cambio.cambios : [
        ...(cambio.tipoDoc !== cambio.tipoDocNuevo
          ? [{ campo: 'tipoDoc', valorAnterior: cambio.tipoDoc ?? null, valorNuevo: cambio.tipoDocNuevo }] : []),
        ...(cambio.nroDoc !== cambio.nroDocNuevo
          ? [{ campo: 'nroDoc', valorAnterior: cambio.nroDoc ?? null, valorNuevo: cambio.nroDocNuevo }] : []),
      ],
    }));
    return res.json({ ok: true, hc: paciente.hc, historial });
  } catch (error) {
    console.error('Error al consultar historial de documentos:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo obtener el historial.' });
  }
};

// ====== Corregir documento inicialmente regularizado con segunda autorización ======
const corregirDocumentoProgramacion = async (req, res = response) => {
  const { uid, nombreUsuario } = req.user;
  const tipoDoc = String(req.body.tipoDoc ?? '').trim().toUpperCase();
  const nroDoc = String(req.body.nroDoc ?? '').trim().toUpperCase();
  const motivo = String(req.body.motivo ?? '').trim();
  const formatos = {
    DNI: /^\d{8}$/, CE: /^[A-Z0-9]{1,13}$/, PASAPORTE: /^[A-Z0-9]{1,16}$/,
  };
  if (!formatos[tipoDoc]?.test(nroDoc) || motivo.length < 10 || motivo.length > 300 ||
      req.body.identidadConfirmada !== true) {
    return res.status(400).json({ ok: false, codigo: 'DATOS_INVALIDOS', msg: 'Documento, motivo o confirmación de identidad inválidos.' });
  }
  const session = await mongoose.startSession();
  try {
    let resultado;
    await session.withTransaction(async () => {
      const errorNegocio = (codigo, msg, status = 409) => {
        const e = new Error(msg);
        e.codigo = codigo; e.status = status; throw e;
      };
      const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id).session(session);
      if (!programacion) errorNegocio('PROGRAMACION_NO_ENCONTRADA', 'La programación no existe.', 404);
      if (!programacion.pacienteId || !programacion.hc) {
        errorNegocio('PACIENTE_NO_VINCULADO', 'La programación no tiene historia clínica vinculada.');
      }
      const paciente = await Paciente.findById(programacion.pacienteId).session(session);
      if (!paciente || String(paciente.hc) !== String(programacion.hc)) {
        errorNegocio('VINCULO_INVALIDO', 'La HC de la programación y del paciente no coinciden.');
      }
      if (paciente.estadoIdentificacion === 'REGISTRADA') {
        errorNegocio('IDENTIDAD_MAESTRA_PROTEGIDA', 'Los documentos de pacientes registrados en el maestro solo pueden modificarse mediante un procedimiento independiente.');
      }
      if (obtenerAccionDocumentoPaciente(paciente) !== 'CORREGIR') {
        errorNegocio('CORRECCION_NO_PERMITIDA', 'Solo puede corregirse con autorización un documento asignado previamente a un paciente programado sin DNI.');
      }
      if (!validarCoincidenciaIdentidad(programacion, paciente).coincide) {
        errorNegocio('INCONSISTENCIA_IDENTIDAD', 'Los nombres de la programación no coinciden con la HC.');
      }
      if (paciente.tipoDoc === tipoDoc && paciente.nroDoc === nroDoc) {
        errorNegocio('SIN_CAMBIOS', 'El documento nuevo coincide con el registrado.');
      }
      // ====== Revisar documento vigente e histórico en otras HC ======
      const coincidencias = await buscarCoincidenciasDocumentoHC({ pacienteId: paciente._id, tipoDoc, nroDoc, session });
      if (coincidencias.hayCoincidencias) {
        const error = new Error('Documento encontrado en otra HC. No se modificó ninguna historia. Revise la identidad; no está permitido asignar el documento a dos pacientes.');
        error.codigo = 'POSIBLE_CONCILIACION_HC'; error.status = 409;
        error.coincidencias = coincidencias;
        throw error;
      }

      // ====== Exigir credenciales de un segundo responsable antes de escribir ======
      const autorizacion = await autorizarCorreccionDocumento(req.body, { uid, nombreUsuario }, session);
      const ahora = new Date();
      const anterior = { tipoDoc: paciente.tipoDoc ?? null, nroDoc: paciente.nroDoc ?? null };
      paciente.tipoDoc = tipoDoc;
      paciente.nroDoc = nroDoc;
      paciente.historialDocumentos.push({
        ...anterior, tipoDocNuevo: tipoDoc, nroDocNuevo: nroDoc,
        motivo, fecha: ahora, uid, nombreUsuario,
        tipoOperacion: 'CORRECCION_AUTORIZADA', ...autorizacion,
        cambios: [
          ...(anterior.tipoDoc !== tipoDoc ? [{ campo: 'tipoDoc', valorAnterior: anterior.tipoDoc, valorNuevo: tipoDoc }] : []),
          ...(anterior.nroDoc !== nroDoc ? [{ campo: 'nroDoc', valorAnterior: anterior.nroDoc, valorNuevo: nroDoc }] : []),
        ],
      });
      paciente.updatedBy = uid;
      paciente.usuarioActualizacion = nombreUsuario;
      paciente.fechaActualizacion = ahora;
      await paciente.save({ session });
      const actualizacion = {
        tipoDoc, nroDoc, updatedBy: uid,
        usuarioActualizacion: nombreUsuario, fechaActualizacion: ahora,
      };
      await ProgramacionPacienteEmpresa.updateMany(
        { pacienteId: paciente._id }, { $set: actualizacion }, { session, runValidators: true });
      await SolicitudAtencion.updateMany(
        { clienteId: paciente._id }, { $set: actualizacion }, { session, runValidators: true });
      const programacionActualizada = await ProgramacionPacienteEmpresa.findById(programacion._id)
        .session(session).lean();
      resultado = {
        programacion: {
          ...programacionActualizada,
            accionDocumentoPaciente: obtenerAccionDocumentoPaciente(paciente),
        },
        paciente: { _id: paciente._id, hc: paciente.hc },
      };
    });
    return res.json({ ok: true, msg: 'Documento corregido con autorización y auditoría registradas.', ...resultado });
  } catch (error) {
    console.error('Error al corregir documento empresarial:', error.codigo ?? error.message);
    return res.status(error.status ?? 500).json({
      ok: false, codigo: error.codigo ?? 'ERROR_CORRECCION',
      coincidencias: error.coincidencias ?? null,
      msg: error.codigo ? error.message : 'No se pudo corregir el documento.',
    });
  } finally {
    await session.endSession();
  }
};


// ====== Buscar coincidencias independientes y fotografía de evaluación disponible ======
const consultarCoincidenciasVinculacion = async (req, res = response) => {
  try {
    const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id).lean();
    if (!programacion) return res.status(404).json({ ok:false, msg:'Programación no encontrada' });
    const coincidencias = await buscarCoincidenciasVinculacion(Paciente, programacion, validarCoincidenciaIdentidad);
    const ids = [...new Set(coincidencias.candidatos.map(item => item.pacienteId))];
    const fotos = ids.length ? await ArchivoPaciente.find({
      pacienteId: { $in: ids }, tipoArchivo: 'FOTO_EVALUACION',
      estadoArchivo: 'ACTIVO',
      $or: [{ programacionEmpresaId: { $ne: null } }, { 'solicitudAtencionIds.0': { $exists: true } }],
    }).select('pacienteId programacionEmpresaId solicitudAtencionIds fechaCaptura')
      .sort({ fechaCaptura: -1 }).lean() : [];
    const ultimaPorPaciente = new Map();
    for (const foto of fotos) {
      const clave = String(foto.pacienteId);
      if (!ultimaPorPaciente.has(clave)) ultimaPorPaciente.set(clave, {
        programacionEmpresaId: foto.programacionEmpresaId ? String(foto.programacionEmpresaId) : null,
        solicitudAtencionId: foto.programacionEmpresaId ? null :
          (foto.solicitudAtencionIds?.[0] ? String(foto.solicitudAtencionIds[0]) : null),
        fechaCaptura: foto.fechaCaptura,
      });
    }
    const agregarFoto = item => ({ ...item, fotoReferencia: ultimaPorPaciente.get(item.pacienteId) ?? null });
    return res.json({ ok:true, vinculada:Boolean(programacion.pacienteId),
      porDocumento:coincidencias.porDocumento.map(agregarFoto),
      porNombres:coincidencias.porNombres.map(agregarFoto),
      masPorDocumento:false, masPorNombres:false });
  } catch (error) {
    console.error('Error al consultar coincidencias:', error);
    return res.status(500).json({ ok:false, msg:'No se pudieron consultar las coincidencias' });
  }
};

// ====== Nombre completo del operador desde el maestro de personal ======
const nombreCompletoRecurso = (recurso) => [
  recurso?.nombreRecHumano,
  recurso?.apePatRecHumano,
  recurso?.apeMatRecHumano,
].map(valor => String(valor ?? '').trim()).filter(Boolean).join(' ');

const obtenerNombreCompletoOperador = async ({ uid, nombreUsuario, session = null }) => {
  const filtros = [];
  if (uid) filtros.push({ codRecHumano: String(uid) });
  if (nombreUsuario) filtros.push({ 'datosLogueo.nombreUsuario': String(nombreUsuario) });
  if (!filtros.length) return null;
  const consulta = RecursoHumano.find({ $or: filtros })
    .select('codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano datosLogueo.nombreUsuario')
    .lean();
  if (session) consulta.session(session);
  const recursos = await consulta;
  const recurso = recursos.find(item => String(item.codRecHumano) === String(uid))
    ?? recursos.find(item => String(item.datosLogueo?.nombreUsuario ?? '').toLowerCase() === String(nombreUsuario ?? '').toLowerCase());
  return recurso ? (nombreCompletoRecurso(recurso) || null) : null;
};

// ====== Primera vinculación con paciente existente ======
const vincularPacienteInicial = async (req, res = response) => {
  try {
    const pacienteId = String(req.body?.pacienteId ?? '');
    const motivoDecision = String(req.body?.motivoDecision ?? '').trim();
    const confirmacionExpresa = req.body?.confirmacionExpresa === true;
    if (!mongoose.isValidObjectId(pacienteId)) return res.status(400).json({ ok:false, msg:'Paciente inválido' });
    const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id).lean();
    if (!programacion) return res.status(404).json({ ok:false, msg:'Programación no encontrada' });
    if (programacion.pacienteId || programacion.hc || programacion.estadoProgramacion !== 'PROGRAMADO')
      return res.status(409).json({ ok:false, msg:'Esta programación ya tiene vinculación o atención iniciada. Requiere corrección autorizada.' });
    const haySolicitudes = await SolicitudAtencion.exists({ programacionEmpresaId: programacion._id });
    if (haySolicitudes) return res.status(409).json({ ok:false, msg:'Existen solicitudes. No se permite la primera vinculación por este flujo.' });
    const paciente = await Paciente.findById(pacienteId).lean();
    if (!paciente?.hc || !paciente.tipoDoc || !paciente.nroDoc ||
      paciente.estadoIdentificacion === 'PENDIENTE')
      return res.status(409).json({ ok:false, msg:'La HC elegida no está habilitada para vinculación inicial.' });
    const identidad = validarCoincidenciaIdentidad(programacion, paciente);
    const mismoDocumento = String(programacion.tipoDoc ?? '').toUpperCase() === String(paciente.tipoDoc).toUpperCase()
      && String(programacion.nroDoc ?? '').toUpperCase() === String(paciente.nroDoc).toUpperCase();
    if (!mismoDocumento)
      return res.status(409).json({ok:false, codigo:'DOCUMENTO_DISCREPANTE',
        msg:'No se puede vincular una HC con documento diferente. Primero debe resolverse la identidad.' });
    if (motivoDecision.length > 300)
      return res.status(400).json({ok:false, codigo:'MOTIVO_DECISION_INVALIDO',
        msg:'El motivo opcional no puede superar los 300 caracteres.' });
    // ====== Exigir confirmación expresa cuando existen diferencias ======
    if (!identidad.coincide && !confirmacionExpresa)
      return res.status(400).json({ok:false, codigo:'CONFIRMACION_IDENTIDAD_REQUERIDA',
        msg:'Confirme expresamente que revisó las diferencias y se trata del mismo paciente.' });
    const nombreCompletoUsuario = await obtenerNombreCompletoOperador({
      uid: req.user.uid, nombreUsuario: req.user.nombreUsuario,
    });
    const evento = { tipo:'VINCULACION_INICIAL', pacienteIdAnterior:null, hcAnterior:null,
      pacienteIdNuevo: paciente._id, hcNueva: paciente.hc, fecha:new Date(),
      ejecutadoPor:req.user.uid, usuario:req.user.nombreUsuario,
      nombreCompletoUsuario, origenDocumento:'EMPRESA',
      tipoResolucion: identidad.coincide ? 'COINCIDENCIA_EXACTA' : 'DISCREPANCIA_DOCUMENTO_COINCIDENTE',
      motivoDecision: motivoDecision || null };
    const actualizado = await ProgramacionPacienteEmpresa.findOneAndUpdate(
      { _id:programacion._id, pacienteId:null, estadoProgramacion:'PROGRAMADO',
        $or:[{hc:null},{hc:{$exists:false}}] },
      { $set:{ pacienteId:paciente._id, hc:paciente.hc,
        updatedBy:req.user.uid, usuarioActualizacion:req.user.nombreUsuario,
        fechaActualizacion:new Date() }, $push:{ historialVinculaciones:evento } },
      { new:true, runValidators:true });
    if (!actualizado) return res.status(409).json({ok:false,msg:'La programación cambió. Actualice la pantalla.'});
    return res.json({ok:true,msg:'Paciente vinculado con auditoría registrada',programacion:actualizado});
  } catch (error) {
    return res.status(500).json({ok:false,msg:'No se pudo vincular el paciente'});
  }
};

// ====== Registrar decisión sin vincular ni crear una HC ======
const registrarRevisionCoincidencia = async (req, res = response) => {
  try {
    const pacienteId = String(req.body?.pacienteId ?? '');
    const decision = String(req.body?.decision ?? '').trim().toUpperCase();
    const motivo = String(req.body?.motivo ?? '').trim();
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(pacienteId) ||
        !['DISTINTO', 'PENDIENTE'].includes(decision) || motivo.length > 300) {
      return res.status(400).json({ ok:false, msg:'Candidato o decisión inválidos, o motivo opcional mayor a 300 caracteres.' });
    }
    const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id).lean();
    if (!programacion) return res.status(404).json({ ok:false, msg:'Programación no encontrada' });
    if (programacion.pacienteId || programacion.hc || programacion.estadoProgramacion !== 'PROGRAMADO') {
      return res.status(409).json({ ok:false, msg:'La programación ya tiene un vínculo o atención iniciada.' });
    }
    const haySolicitudes = await SolicitudAtencion.exists({ programacionEmpresaId: programacion._id });
    if (haySolicitudes) return res.status(409).json({ ok:false, msg:'Existen solicitudes; la revisión ordinaria no está permitida.' });
    const paciente = await Paciente.findById(pacienteId).lean();
    if (!paciente) return res.status(404).json({ ok:false, msg:'Paciente candidato no encontrado' });
    const identidad = validarCoincidenciaIdentidad(programacion, paciente);
    const mismoDoc = String(programacion.tipoDoc ?? '').toUpperCase() === String(paciente.tipoDoc ?? '').toUpperCase() &&
      Boolean(programacion.nroDoc) && String(programacion.nroDoc).toUpperCase() === String(paciente.nroDoc ?? '').toUpperCase();
    if (!mismoDoc && !identidad.coincide) {
      // ====== Comprobar pertenencia real a búsqueda nominal antes de registrar ======
      const candidatos = await buscarCoincidenciasVinculacion(Paciente, programacion, validarCoincidenciaIdentidad);
      if (!candidatos.candidatos.some(item => item.pacienteId === pacienteId)) {
        return res.status(409).json({ ok:false, msg:'Este paciente no figura entre las coincidencias.' });
      }
    }
    const nombreCompletoUsuario = await obtenerNombreCompletoOperador(req.user);
    const actualizado = await ProgramacionPacienteEmpresa.findOneAndUpdate(
      { _id:programacion._id, pacienteId:null, estadoProgramacion:'PROGRAMADO',
        $or:[{hc:null},{hc:{$exists:false}}] },
      { $push:{ historialRevisionIdentidad:{ decision, pacienteIdCandidato:paciente._id,
        hcCandidata:paciente.hc ?? null, documentoCoincidente:mismoDoc, motivo: motivo || null,
        tipoDocProgramacion:programacion.tipoDoc ?? null, nroDocProgramacion:programacion.nroDoc ?? null,
        nombreClienteProgramacion:programacion.nombreCliente,
        apePatClienteProgramacion:programacion.apePatCliente,
        apeMatClienteProgramacion:programacion.apeMatCliente ?? '',
        fecha:new Date(), ejecutadoPor:req.user.uid, usuario:req.user.nombreUsuario,
        nombreCompletoUsuario } } },
      { new:true, runValidators:true });
    if (!actualizado) return res.status(409).json({ok:false,msg:'La programación cambió. Actualice la pantalla.'});
    return res.json({ ok:true, decision, requiereRevision:mismoDoc,
      msg: mismoDoc ? 'Decisión registrada. El DNI coincidente requiere resolver el conflicto antes de crear otra HC.'
        : 'Decisión registrada. La programación continúa sin HC vinculada.' });
  } catch (error) {
    console.error('Error al registrar revisión de identidad:', error);
    return res.status(500).json({ok:false,msg:'No se pudo registrar la revisión de identidad.'});
  }
};

// ====== Historial de vinculación de una programación ======
const obtenerHistorialVinculaciones = async (req, res = response) => {
  try {
    const programacion = await ProgramacionPacienteEmpresa.findById(req.params.id)
      .select('codProgramacion pacienteId hc tipoDoc nroDoc nombreCliente apePatCliente apeMatCliente estadoProgramacion historialVinculaciones historialRevisionIdentidad').lean();
    if (!programacion) return res.status(404).json({ok:false,msg:'Programación no encontrada'});
    // ====== Completar eventos antiguos sin cambiar la auditoría guardada ======
    const historial = programacion.historialVinculaciones ?? [];
    const sinNombre = [...historial, ...(programacion.historialRevisionIdentidad ?? [])].filter(evento => !evento.nombreCompletoUsuario);
    const ids = [...new Set(sinNombre.map(evento => String(evento.ejecutadoPor ?? '').trim()).filter(Boolean))];
    const usuarios = [...new Set(sinNombre.map(evento => String(evento.usuario ?? '').trim()).filter(Boolean))];
    let recursos = [];
    if (ids.length || usuarios.length) {
      const filtros = [];
      if (ids.length) filtros.push({ codRecHumano: { $in: ids } });
      if (usuarios.length) filtros.push({ 'datosLogueo.nombreUsuario': { $in: usuarios } });
      recursos = await RecursoHumano.find({ $or: filtros })
        .select('codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano datosLogueo.nombreUsuario').lean();
    }
    const respuesta = historial.map(evento => {
      if (evento.nombreCompletoUsuario) return evento;
      const recurso = recursos.find(item => String(item.codRecHumano) === String(evento.ejecutadoPor ?? ''))
        ?? recursos.find(item => String(item.datosLogueo?.nombreUsuario ?? '').toLowerCase() === String(evento.usuario ?? '').toLowerCase());
      return { ...evento, nombreCompletoUsuario: recurso ? (nombreCompletoRecurso(recurso) || null) : null };
    });
    const revisiones = (programacion.historialRevisionIdentidad ?? []).map(evento => {
      if (evento.nombreCompletoUsuario) return evento;
      const recurso = recursos.find(item => String(item.codRecHumano) === String(evento.ejecutadoPor ?? ''))
        ?? recursos.find(item => String(item.datosLogueo?.nombreUsuario ?? '').toLowerCase() === String(evento.usuario ?? '').toLowerCase());
      return { ...evento, nombreCompletoUsuario: recurso ? (nombreCompletoRecurso(recurso) || null) : null };
    });
    // ====== Estado operativo vigente por candidato, sin alterar eventos ======
    let estadosCandidatos = [];
    if (!programacion.pacienteId && programacion.estadoProgramacion === 'PROGRAMADO') {
      const coincidencias = await buscarCoincidenciasVinculacion(Paciente, programacion, validarCoincidenciaIdentidad);
      const ultimas = obtenerUltimasDecisiones(programacion);
      estadosCandidatos = (coincidencias.candidatos ?? []).map(item => {
        const vigente = ultimas.get(String(item.pacienteId));
        return {
          pacienteId: item.pacienteId, hc: item.hc,
          nombreCompleto: [item.apePatCliente, item.apeMatCliente, item.nombreCliente].filter(Boolean).join(' '),
          documentoCoincidente: item.documentoExacto,
          estado: item.documentoExacto && vigente?.decision === 'DISTINTO'
            ? 'CONFLICTO_DOCUMENTAL' : vigente?.decision === 'DISTINTO'
              ? 'PERSONA_DISTINTA' : vigente?.decision === 'PENDIENTE' ? 'PENDIENTE' : 'SIN_REVISAR',
        };
      });
    }
    return res.json({ok:true, codProgramacion:programacion.codProgramacion,
      historial:respuesta, revisiones, estadosCandidatos});
  } catch (error) { return res.status(500).json({ok:false,msg:'No se pudo consultar el historial'}); }
};

module.exports = {
  consultarCoincidenciasVinculacion,
  vincularPacienteInicial,
  registrarRevisionCoincidencia,
  obtenerHistorialVinculaciones,
  crearProgramacion,
  listarProgramaciones,
  obtenerProgramacion,
  actualizarProgramacion,
  actualizarEstadoProgramacion,
  iniciarAtencionProgramacion,
  regularizarDocumentoProgramacion,
  verificarDocumentoProgramacion,
  corregirDocumentoProgramacion,
  obtenerHistorialDocumentoProgramacion,
};
