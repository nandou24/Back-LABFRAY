const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const { response } = require("express");
//const moment = require("moment");

// Crear una nueva solicitud de atención
const crearSolicitud = async (req, res) => {
  try {
    const {
      codCotizacion,
      codigoPago,
      tipo,
      servicios,
      hc,
      tipoDocumento,
      nroDocumento,
      nombreCompleto,
      codUsuarioEmisor,
      usuarioEmisor,
    } = req.body;

    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

    // Validación básica
    if (
      !codCotizacion ||
      !tipo ||
      servicios.length === 0 ||
      !hc ||
      !nombreCompleto
    ) {
      return res.status(400).json({ message: "Faltan campos obligatorios." });
    }

    let nuevCodigoSolicitud = await generarCodigoSolicitud();

    const nuevaSolicitud = new SolicitudAtencion({
      codigoSolicitud: nuevCodigoSolicitud,
      codCotizacion: codCotizacion,
      codigoPago: codigoPago, // Puede ser null si no se proporciona
      tipo: tipo,
      servicios: servicios.map((serv) => ({
        ...serv,
        estado: "PENDIENTE",
      })),
      hc: hc,
      tipoDocumento: tipoDocumento,
      nroDocumento: nroDocumento,
      nombreCompleto: nombreCompleto.toUpperCase(),
      fechaEmision: new Date(),
      codUsuarioEmisor: codUsuarioEmisor,
      usuarioEmisor: usuarioEmisor,
      estado: "GENERADO",
      createdBy: uid, // uid del usuario que creó la solicitud
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó la solicitud
      fechaRegistro: new Date(), // Fecha de registro
    });

    await nuevaSolicitud.save();
    res.status(201).json({
      message: "Solicitud registrada correctamente",
      solicitud: nuevaSolicitud,
    });
  } catch (error) {
    console.error("Error al crear solicitud de atención:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// Generar el código de solicitud con formato SOL'año''mes'0001
async function generarCodigoSolicitud(session) {
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
      { new: true }
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
        "nombreRefMedico apePatRefMedico apeMatRefMedico"
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
  crearSolicitud,
  obtenerPorRangoFechas,
  generarCodigoSolicitud,
};
