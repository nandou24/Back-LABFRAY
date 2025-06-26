const SolicitudAtencion = require("../models/SolicitudAtencion");
const { response } = require("express");
//const moment = require("moment");

// Crear una nueva solicitud de atención
const crearSolicitud = async (req, res) => {
  try {
    const {
      cotizacionId,
      codigoPago,
      tipo,
      servicios,
      hc,
      tipoDocumento,
      nroDocumento,
      pacienteNombre,
      codUsuarioEmisor,
      usuarioEmisor,
    } = req.body;

    // Validación básica
    if (
      !cotizacionId ||
      !tipo ||
      servicios.length === 0 ||
      !hc ||
      !pacienteNombre
    ) {
      return res.status(400).json({ message: "Faltan campos obligatorios." });
    }

    let nuevCodigoSolicitud = await generarCodigoSolicitud();

    const nuevaSolicitud = new SolicitudAtencion({
      codigoSolicitud: nuevCodigoSolicitud,
      cotizacionId: cotizacionId,
      codigoPago: codigoPago, // Puede ser null si no se proporciona
      tipo: tipo,
      servicios: servicios.map((serv) => ({
        ...serv,
        estado: "PENDIENTE",
      })),
      hc: hc,
      tipoDocumento: tipoDocumento,
      nroDocumento: nroDocumento,
      pacienteNombre: pacienteNombre.toUpperCase(),
      fechaEmision: new Date(),
      codUsuarioEmisor: codUsuarioEmisor,
      usuarioEmisor: usuarioEmisor,
      estado: "GENERADO",
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
    codigoSolicitud: { $regex: `^${prefijo}` },
  })
    .sort({ codigoSolicitud: -1 })
    .session(session) // Usar la sesión si se está en una transacción
    .lean();

  //console.log("Última solicitud encontrada:", ultimaSolicitud);

  let consecutivo = 1;
  if (ultimaSolicitud && ultimaSolicitud.codigoSolicitud) {
    const ultimos4 = ultimaSolicitud.codigoSolicitud.slice(-4);
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
    const solicitud = await SolicitudAtencion.findByIdAndUpdate(
      id,
      { estado },
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
    const { fechaInicio, fechaFin } = req.query;
    const solicitudes = await SolicitudAtencion.find({
      fechaEmision: {
        $gte: new Date(fechaInicio),
        $lte: new Date(fechaFin),
      },
    }).sort({ fechaEmision: -1 });
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
