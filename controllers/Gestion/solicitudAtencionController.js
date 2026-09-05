const mongoose = require("mongoose");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");
const { response } = require("express");

// Generar el código de solicitud con formato SOL'año''mes'0001
async function generarCodigoSolicitud(session) {
  if (!session) {
    throw new Error(
      "Se requiere una sesión de MongoDB para generar el código de solicitud",
    );
  }

  const ahora = new Date();
  const anio = ahora.getFullYear().toString().slice(-2); // '24'
  const mes = (ahora.getMonth() + 1).toString().padStart(2, "0"); // '06'
  const prefijo = `SOL${anio}${mes}`; // ej. SOL2406

  // Buscar la última solicitud creada este mes
  const ultimaSolicitud = await SolicitudAtencion.findOne({
    codSolicitud: { $regex: `^${prefijo}` },
  })
    .sort({ codSolicitud: -1 })
    .session(session) // Usar la sesión si se está en una transacción
    .lean();

  //console.log("Última solicitud encontrada:", ultimaSolicitud);

  let consecutivo = 1;
  if (ultimaSolicitud && ultimaSolicitud.codSolicitud) {
    const ultimos4 = ultimaSolicitud.codSolicitud.slice(-4);
    consecutivo = parseInt(ultimos4, 10) + 1;
  }

  const codigo = `${prefijo}${consecutivo.toString().padStart(4, "0")}`;
  return codigo;
}

// ==========================================
// NORMALIZAR TIPO DE SOLICITUD
// ==========================================

const normalizarTipoSolicitud = (tipoServicio) => {
  if (!tipoServicio) {
    throw new Error("El servicio no tiene definido un tipo de servicio");
  }

  const tipoNormalizado = tipoServicio.trim().toUpperCase();

  const tipos = {
    LAB: "Laboratorio",
    LABORATORIO: "Laboratorio",

    CON: "Consulta",
    CONSULTA: "Consulta",

    ECO: "Ecografía",
    ECOGRAFIA: "Ecografía",
    ECOGRAFÍA: "Ecografía",

    RX: "Radiografía",
    RADIOGRAFIA: "Radiografía",
    RADIOGRAFÍA: "Radiografía",
    "RAYOS X": "Radiografía",

    PRO: "Procedimiento",
    PROCEDIMIENTO: "Procedimiento",

    OTRO: "Otro",
  };

  const tipoSolicitud = tipos[tipoNormalizado];

  if (!tipoSolicitud) {
    throw new Error(
      `Tipo de servicio no soportado para solicitud de atención: ${tipoServicio}`,
    );
  }

  return tipoSolicitud;
};

// ==========================================
// AGRUPAR SERVICIOS POR TIPO
// ==========================================

const agruparServiciosPorTipo = (servicios) => {
  if (!Array.isArray(servicios) || servicios.length === 0) {
    throw new Error(
      "No existen servicios para generar solicitudes de atención",
    );
  }

  return servicios.reduce((agrupados, servicio) => {
    const tipo = normalizarTipoSolicitud(servicio.tipoServicio);

    if (!agrupados[tipo]) {
      agrupados[tipo] = [];
    }

    agrupados[tipo].push(servicio);

    return agrupados;
  }, {});
};

// ==========================================
// CREAR SOLICITUDES DE ATENCIÓN
// ==========================================

const crearSolicitudesAtencion = async ({
  origenAtencion,
  servicios,
  paciente,
  datosOrigen,
  session,
  uid,
  nombreUsuario,
}) => {
  // ==========================================
  // VALIDAR SESIÓN
  // ==========================================

  if (!session) {
    throw new Error(
      "Se requiere una sesión de MongoDB para crear solicitudes de atención",
    );
  }

  // ==========================================
  // VALIDAR ORIGEN
  // ==========================================

  if (!["PARTICULAR", "EMPRESA"].includes(origenAtencion)) {
    throw new Error("Origen de atención no válido");
  }

  // ==========================================
  // VALIDAR PACIENTE
  // ==========================================

  if (
    !paciente?.clienteId ||
    !paciente?.hc ||
    !paciente?.tipoDoc ||
    !paciente?.nroDoc ||
    !paciente?.nombreCliente ||
    !paciente?.apePatCliente
  ) {
    throw new Error(
      "Faltan datos obligatorios del paciente para generar las solicitudes",
    );
  }

  // ==========================================
  // VALIDAR DATOS DEL ORIGEN
  // ==========================================

  if (origenAtencion === "PARTICULAR") {
    if (
      !datosOrigen?.pagoId ||
      !datosOrigen?.codPago ||
      !datosOrigen?.cotizacionId ||
      !datosOrigen?.codCotizacion
    ) {
      throw new Error(
        "Faltan datos del pago o cotización para generar las solicitudes",
      );
    }
  }

  if (origenAtencion === "EMPRESA") {
    if (
      !datosOrigen?.programacionEmpresaId ||
      !datosOrigen?.codProgramacion ||
      !datosOrigen?.empresaId ||
      !datosOrigen?.razonSocialEmpresa ||
      !datosOrigen?.protocoloId ||
      !datosOrigen?.codProtocolo ||
      !datosOrigen?.nombreProtocolo
    ) {
      throw new Error(
        "Faltan datos de la programación empresarial para generar las solicitudes",
      );
    }
  }

  // ==========================================
  // AGRUPAR SERVICIOS
  // ==========================================

  const serviciosAgrupados = agruparServiciosPorTipo(servicios);

  const solicitudesCreadas = [];

  const ahora = new Date();

  // ==========================================
  // CREAR UNA SOLICITUD POR TIPO
  // ==========================================

  for (const [tipo, serviciosTipo] of Object.entries(serviciosAgrupados)) {
    const codSolicitud = await generarCodigoSolicitud(session);

    const datosSolicitud = {
      codSolicitud,
      origenAtencion,
      tipo,
      servicios: serviciosTipo.map((servicio) => ({
        servicioId: servicio.servicioId,
        codServicio: servicio.codServicio,
        nombreServicio: servicio.nombreServicio,
        estado: "PENDIENTE",
        ...(servicio.medicoAtiende && {
          medicoAtiende: servicio.medicoAtiende,
        }),
      })),

      // ======================================
      // PACIENTE
      // ======================================

      hc: paciente.hc,
      clienteId: paciente.clienteId,
      tipoDoc: paciente.tipoDoc,
      nroDoc: paciente.nroDoc,
      nombreCliente: paciente.nombreCliente,
      apePatCliente: paciente.apePatCliente,
      apeMatCliente: paciente.apeMatCliente || "",

      // ======================================
      // SOLICITUD
      // ======================================

      fechaEmision: ahora,
      estado: "GENERADO",

      // ======================================
      // AUDITORÍA
      // ======================================

      createdBy: uid,
      usuarioRegistro: nombreUsuario,
      fechaRegistro: ahora,
    };

    // ==========================================
    // ORIGEN PARTICULAR
    // ==========================================

    if (origenAtencion === "PARTICULAR") {
      Object.assign(datosSolicitud, {
        pagoId: datosOrigen.pagoId,
        codPago: datosOrigen.codPago,
        cotizacionId: datosOrigen.cotizacionId,
        codCotizacion: datosOrigen.codCotizacion,
        fechaCotizacion: datosOrigen.fechaCotizacion,
        solicitanteId: datosOrigen.solicitanteId || null,
      });
    }

    // ==========================================
    // ORIGEN EMPRESA
    // ==========================================

    if (origenAtencion === "EMPRESA") {
      Object.assign(datosSolicitud, {
        programacionEmpresaId: datosOrigen.programacionEmpresaId,
        codProgramacion: datosOrigen.codProgramacion,
        empresaId: datosOrigen.empresaId,
        razonSocialEmpresa: datosOrigen.razonSocialEmpresa,
        protocoloId: datosOrigen.protocoloId,
        codProtocolo: datosOrigen.codProtocolo,
        nombreProtocolo: datosOrigen.nombreProtocolo,
      });
    }

    // ==========================================
    // GUARDAR SOLICITUD
    // ==========================================

    const nuevaSolicitud = new SolicitudAtencion(datosSolicitud);

    await nuevaSolicitud.save({
      session,
    });

    solicitudesCreadas.push(nuevaSolicitud);
  }

  return solicitudesCreadas;
};

// Actualizar el estado de una solicitud
exports.actualizarEstado = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

    const solicitud = await SolicitudAtencion.findByIdAndUpdate(
      id,
      {
        estado,
        updatedBy: uid, // uid del usuario que actualiza
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true },
    );
    if (!solicitud) {
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }
    res.json(solicitud);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Traer solicitudes por rango de fechas
const obtenerPorRangoFechas = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, terminoBusqueda } = req.query;
    console.log("Fechas recibidas:", fechaInicio, fechaFin);
    console.log("Término de búsqueda:", terminoBusqueda);

    const filtro = {
      fechaEmision: {
        $gte: new Date(fechaInicio),
        $lte: new Date(fechaFin),
      },
    };

    if (terminoBusqueda.trim() !== "") {
      const regex = new RegExp(terminoBusqueda.trim(), "i"); // 'i' = case-insensitive
      filtro.$or = [
        { pacienteNombre: regex },
        { codCotizacion: regex },
        { nroDocumento: regex },
      ];
    }

    const solicitudes = await SolicitudAtencion.find(filtro)
      .populate(
        "solicitanteId",
        "nombreRefMedico apePatRefMedico apeMatRefMedico",
      )
      .populate("pagoId", "subTotalFacturar")
      .populate("programacionEmpresaId")
      .sort({ fechaEmision: -1 });

    console.log("Solicitudes encontradas:", solicitudes.length);

    res.json(solicitudes);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Buscar solicitudes dentro de un rango de fechas (puede incluir filtros adicionales)
exports.buscarSolicitudes = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, ...otrosFiltros } = req.query;
    const filtro = {
      ...otrosFiltros,
      fechaEmision: {
        $gte: new Date(fechaInicio),
        $lte: new Date(fechaFin),
      },
    };
    const solicitudes = await SolicitudAtencion.find(filtro);
    res.json(solicitudes);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ==========================================
// RECALCULAR ESTADO DE PROGRAMACIÓN EMPRESA
// SEGÚN ATENCIONES DE SUS ÁREAS
// ==========================================

const recalcularEstadoProgramacionEmpresa = async ({
  programacionEmpresaId,
  session,
  uid,
  nombreUsuario,
  ahora,
}) => {
  // ==========================================
  // VALIDAR PROGRAMACIÓN
  // ==========================================

  const programacion = await ProgramacionPacienteEmpresa.findById(
    programacionEmpresaId,
  ).session(session);

  if (!programacion) {
    const error = new Error("La programación empresarial asociada no existe");
    error.codigo = "PROGRAMACION_NO_ENCONTRADA";
    throw error;
  }

  // ==========================================
  // VALIDAR ESTADO ACTUAL
  // ==========================================

  if (
    !["EN ATENCION", "PENDIENTE DE COMPLETAR"].includes(
      programacion.estadoProgramacion,
    )
  ) {
    const error = new Error(
      `No se puede recalcular una programación en estado ${programacion.estadoProgramacion}`,
    );

    error.codigo = "ESTADO_PROGRAMACION_NO_PERMITIDO";

    throw error;
  }

  // ==========================================
  // OBTENER TODAS LAS SOLICITUDES
  // DE LA PROGRAMACIÓN
  // ==========================================

  const solicitudes = await SolicitudAtencion.find({
    origenAtencion: "EMPRESA",
    programacionEmpresaId: programacion._id,
  })
    .session(session)
    .lean();

  if (solicitudes.length === 0) {
    const error = new Error(
      "La programación no tiene solicitudes de atención asociadas",
    );

    error.codigo = "SOLICITUDES_NO_ENCONTRADAS";

    throw error;
  }

  // ==========================================
  // EVALUAR AVANCE DE ATENCIONES
  // ==========================================

  const totalSolicitudes = solicitudes.length;

  const solicitudesAtendidas = solicitudes.filter(
    (solicitud) => solicitud.estado === "ATENDIDO",
  ).length;

  const todasAtendidas = solicitudesAtendidas === totalSolicitudes;

  // ==========================================
  // ACTUALIZAR PROGRAMACIÓN
  // ==========================================

  programacion.estadoProgramacion = todasAtendidas
    ? "ATENDIDO"
    : "PENDIENTE DE COMPLETAR";

  programacion.fechaUltimaAtencion = ahora;

  if (todasAtendidas) {
    programacion.fechaFinalizacion = ahora;
  }

  // ==========================================
  // AUDITORÍA
  // ==========================================

  programacion.updatedBy = uid;

  programacion.usuarioActualizacion = nombreUsuario;

  programacion.fechaActualizacion = ahora;

  await programacion.save({
    session,
  });

  return {
    programacion,
    resumen: {
      totalSolicitudes,
      solicitudesAtendidas,
      solicitudesPendientes: totalSolicitudes - solicitudesAtendidas,
      todasAtendidas,
    },
  };
};

// ==========================================
// COMPLETAR ATENCIÓN DE UN ÁREA
// ==========================================

const completarAtencionArea = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { id } = req.params;
    const { uid, nombreUsuario } = req.user;

    // ========================================
    // 1. VALIDAR ID
    // ========================================

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();

      return res.status(400).json({
        ok: false,
        codigo: "ID_SOLICITUD_INVALIDO",
        msg: "El ID de la solicitud no es válido",
      });
    }

    // ========================================
    // 2. OBTENER SOLICITUD
    // ========================================

    const solicitud = await SolicitudAtencion.findById(id).session(session);

    if (!solicitud) {
      await session.abortTransaction();

      return res.status(404).json({
        ok: false,
        codigo: "SOLICITUD_NO_ENCONTRADA",
        msg: "Solicitud de atención no encontrada",
      });
    }

    // ========================================
    // 3. VALIDAR ESTADO ACTUAL
    // ========================================

    if (!["GENERADO", "EN PROCESO"].includes(solicitud.estado)) {
      await session.abortTransaction();

      return res.status(409).json({
        ok: false,
        codigo: "ATENCION_AREA_NO_PERMITIDA",
        msg: `No se puede completar la atención de una solicitud en estado ${solicitud.estado}`,
      });
    }

    // ========================================
    // 4. VALIDAR ORIGEN EMPRESA
    // ========================================

    if (
      solicitud.origenAtencion === "EMPRESA" &&
      !solicitud.programacionEmpresaId
    ) {
      await session.abortTransaction();

      return res.status(409).json({
        ok: false,
        codigo: "PROGRAMACION_EMPRESA_REQUERIDA",
        msg: "La solicitud empresarial no tiene una programación asociada",
      });
    }

    const ahora = new Date();

    // ========================================
    // 5. COMPLETAR ATENCIÓN DEL ÁREA
    // ========================================

    solicitud.estado = "ATENDIDO";
    solicitud.fechaAtencionArea = ahora;
    solicitud.atendidoPor = uid;
    solicitud.usuarioAtencion = nombreUsuario;

    // ========================================
    // 6. AUDITORÍA GENERAL
    // ========================================

    solicitud.updatedBy = uid;
    solicitud.usuarioActualizacion = nombreUsuario;
    solicitud.fechaActualizacion = ahora;

    await solicitud.save({
      session,
    });

    // ========================================
    // 7. RECALCULAR PROGRAMACIÓN
    // SOLO PARA EMPRESA
    // ========================================

    let programacionActualizada = null;
    let resumenProgramacion = null;

    if (solicitud.origenAtencion === "EMPRESA") {
      const resultado = await recalcularEstadoProgramacionEmpresa({
        programacionEmpresaId: solicitud.programacionEmpresaId,
        session,
        uid,
        nombreUsuario,
        ahora,
      });

      programacionActualizada = resultado.programacion;
      resumenProgramacion = resultado.resumen;
    }

    // ========================================
    // 8. CONFIRMAR TRANSACCIÓN
    // ========================================

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,
      msg: "Atención del área completada correctamente",
      solicitud,
      programacion: programacionActualizada,
      resumenProgramacion,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al completar atención del área:", error);

    // Errores de integridad / negocio
    if (error.codigo) {
      return res.status(409).json({
        ok: false,
        codigo: error.codigo,
        msg: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al completar la atención del área",
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  crearSolicitudesAtencion,
  obtenerPorRangoFechas,
  generarCodigoSolicitud,
  completarAtencionArea,
};
