const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
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

module.exports = {
  crearSolicitudesAtencion,
  obtenerPorRangoFechas,
  generarCodigoSolicitud,
};
