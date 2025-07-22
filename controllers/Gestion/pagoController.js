const { response } = require("express");
const {
  generarCodigoSolicitud,
} = require("../Gestion/solicitudAtencionController");
const Pago = require("../../models/PagoPaciente");
const Cotizacion = require("../../models/CotizacionPaciente").CotizacionModel;
const SolicitudAtencion = require("../../models/SolicitudAtencion");
const mongoose = require("mongoose");
const { validarEntradaPago } = require("../../utils/pagos/validacionesPago");

const generarPagoPersona = async (req, res = response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { codPago, codCotizacion } = req.body;

    const datos = req.body;

    // Paso 1: Validar datos del request
    const validacion = validarEntradaPago(datos);
    if (!validacion.ok) return res.status(400).json(validacion);

    // Paso 2: Buscar cotización original para ver estado actual
    const cotizacionOriginal = await Cotizacion.findOne({
      codCotizacion,
    }).lean();

    // Paso 3: Buscar si el codPago ya existe
    const pagoExistente = await Pago.findOne({ codPago }).lean();

    // Aquí definiremos qué flujo seguir:
    if (!pagoExistente) {
      // 🔁 Flujo de creación de pago
      await crearPago(datos, session, cotizacionOriginal);
    } else {
      // 🔁 Flujo de actualización de pago
      await actualizarPago(datos, pagoExistente, cotizacionOriginal, session);
    }

    await session.commitTransaction();
    session.endSession();

    //Generar respuesta exitosa
    return res.status(200).json({
      ok: true,
      msg: "Pago procesado con éxito",
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Error al registrar el pago:", error);
    console.log("❌ Transacción revertida correctamente");

    console.error("Error al registrar el pago:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar el pago.",
    });
  }
};

const crearPago = async (datos, session, cotizacionOriginal) => {
  const {
    codCotizacion,
    detallePagos,
    serviciosCotizacion,
    fechaCotizacion,
    tipoDoc,
    nroDoc,
    clienteId,
    nombreCliente,
    apePatCliente,
    apeMatCliente,
  } = datos;

  console.log("Datos recibidos para crear pago:", cotizacionOriginal);

  // 1. Total real desde la BD
  //debemos obtener el total del último historial de la cotización

  const ultimoHistorial =
    cotizacionOriginal.historial[cotizacionOriginal.historial.length - 1];
  if (!ultimoHistorial) {
    throw new Error("No se encontró historial en la cotización.");
  }

  const totalBD = ultimoHistorial.total;

  // 2. Generar código de pago
  const nuevoCodPago = await generarCodigoPago();

  // 3. Calcular monto total de los pagos enviados
  const totalPagado = detallePagos.reduce(
    (sum, pago) => sum + (pago.monto || 0),
    0
  );

  // 4. Calcular diferencia
  const diferencia = totalBD - totalPagado;

  if (diferencia < 0) {
    throw new Error("El monto pagado excede el total de la cotización.");
  }

  // 5. Determinar estado
  const estadoBack = diferencia == 0 ? "PAGO TOTAL" : "PAGO PARCIAL";

  // 6. Crear detalle con marca de esAntiguo = true
  const detalleConAntiguedad = detallePagos.map((p) => ({
    ...p,
    esAntiguo: true,
  }));

  // 7. Crear pago
  const nuevoPago = new Pago({
    ...datos,
    codPago: nuevoCodPago,
    fechaCotizacion: fechaCotizacion,
    detallePagos: detalleConAntiguedad,
    faltaPagar: diferencia,
    estadoPago: estadoBack,
    estadoCotizacion: estadoBack,
  });

  await nuevoPago.save({ session });

  // 8. Actualizar estado de cotización
  await Cotizacion.updateOne(
    { codCotizacion },
    { $set: { estadoCotizacion: estadoBack } },
    { session }
  );

  // 9. Generar órdenes de atención si corresponde
  // Solo si la cotización está en un estado que permite generar órdenes
  const estadosPermitidos = ["GENERADA", "MODIFICADA", "PAGO ANULADO"];

  if (estadosPermitidos.includes(cotizacionOriginal.estadoCotizacion)) {
    const agrupados = agruparServiciosPorTipo(serviciosCotizacion);

    const tipoMap = {
      LAB: "LABORATORIO",
      CON: "CONSULTA",
      ECO: "ECOGRAFIA",
      RX: "RADIOGRAFIA",
    };

    for (const tipo in agrupados) {
      const tipoValido = tipoMap[tipo] || tipo;
      const servicios = agrupados[tipo];

      const solicitud = new SolicitudAtencion({
        codSolicitud: await generarCodigoSolicitud(session),
        codPago: nuevoCodPago,
        codCotizacion: codCotizacion,
        fechaCotizacion: fechaCotizacion,
        tipo: tipoValido,
        servicios: servicios.map((serv) => ({
          codigoServicio: serv.codServicio,
          nombreServicio: serv.nombreServicio,
          estado: "PENDIENTE",
          medicoAtiende: serv.medicoAtiende,
        })),
        hc: ultimoHistorial.hc,
        clienteId: clienteId,
        tipoDoc: tipoDoc,
        nroDoc: nroDoc,
        nombreCliente: nombreCliente,
        apePatCliente: apePatCliente,
        apeMatCliente: apeMatCliente,
        fechaEmision: new Date(),
        codUsuarioEmisor: "codigoUsuarioEmisor",
        usuarioEmisor: "usuarioEmisor",
        estado: "GENERADO",
      });

      await solicitud.save({ session });
    }
  }

  return nuevoCodPago;
};

const actualizarPago = async (
  datos,
  pagoExistente,
  cotizacionOriginal,
  session
) => {
  const { codPago, codCotizacion, detallePagos } = datos;

  // 1. Calcular total pagado
  const totalPagadoAnterior = pagoExistente.detallePagos.reduce(
    (sum, p) => sum + (p.monto || 0),
    0
  );
  const totalNuevosPagos = detallePagos.reduce(
    (sum, p) => sum + (p.monto || 0),
    0
  );
  const totalPagadoActual = +(totalPagadoAnterior + totalNuevosPagos).toFixed(
    2
  );

  // 2. Calcular cuánto falta pagar
  const ultimoHistorial =
    cotizacionOriginal.historial[cotizacionOriginal.historial.length - 1];
  if (!ultimoHistorial) {
    throw new Error("No se encontró historial en la cotización.");
  }

  const totalCotizacion = ultimoHistorial.total;
  const faltaPagarCalculado = +(totalCotizacion - totalPagadoActual).toFixed(2);

  // 3. Validar
  if (faltaPagarCalculado < 0) {
    throw new Error("El monto total pagado excede el total de la cotización.");
  }

  // 4. Determinar nuevo estado
  const nuevoEstado = faltaPagarCalculado === 0 ? "PAGO TOTAL" : "PAGO PARCIAL";

  // 5. Actualizar documento de pago
  await Pago.updateOne(
    { codPago },
    {
      $push: {
        detallePagos: {
          $each: detallePagos.map((p) => ({ ...p, esAntiguo: true })),
        },
      },
      $set: {
        faltaPagar: faltaPagarCalculado,
        estadoPago: nuevoEstado,
        estadoCotizacion: nuevoEstado,
      },
    },
    { session }
  );

  // 6. Actualizar estado de cotización
  await Cotizacion.updateOne(
    { codCotizacion },
    { $set: { estadoCotizacion: nuevoEstado } },
    { session }
  );

  return nuevoEstado;
};

function agruparServiciosPorTipo(servicios) {
  return servicios.reduce((acc, serv) => {
    if (!acc[serv.tipoServicio]) acc[serv.tipoServicio] = [];
    acc[serv.tipoServicio].push(serv);
    return acc;
  }, {});
}

const generarCodigoPago = async () => {
  const anioActual = new Date().getFullYear();
  const prefijo = `P${anioActual}`;

  // Buscar el último código que comience con el prefijo del año actual
  const ultimoPago = await Pago.findOne({ codPago: new RegExp(`^${prefijo}`) })
    .sort({ codPago: -1 })
    .lean();

  let nuevoNumero = 1;

  if (ultimoPago?.codPago) {
    const ultimaParte = ultimoPago.codPago.split("-")[1]; // ejemplo: "000237"
    nuevoNumero = parseInt(ultimaParte, 10) + 1;
  }

  if (nuevoNumero > 99999) {
    const error = new Error(
      `Se alcanzó el límite máximo de códigos de pago para el año ${anioActual}.`
    );
    error.name = "LimitePagoError";
    throw error;
  }

  const correlativo = nuevoNumero.toString().padStart(5, "0");

  return `${prefijo}-${correlativo}`;
};

const mostrarUltimosPagos = async (req, res = response) => {
  try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);

    const pagos = await Pago.find({
      estadoCotizacion: { $in: ["PAGO TOTAL", "PAGO PARCIAL"] },
    })
      .sort({ codPago: -1 })
      .limit(limite)
      .lean();

    return res.json({
      ok: true,
      pagos: pagos,
    });
  } catch (error) {
    console.error("❌ Error al consultar pagos:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTermino = async (req, res = response) => {
  const termino = req.query.search;
  console.log(termino);

  try {
    const cotizaciones = await Pago.find({
      historial: {
        $elemMatch: {
          $or: [
            { pacienteNombreCompleto: { $regex: termino, $options: "i" } }, // Nombre del cliente
            { nroDoc: { $regex: termino, $options: "i" } }, // Número de documento
          ],
        },
      },
    })
      .sort({ updatedAt: -1 }) // 📌 Ordena de más nuevas a más antiguas
      .limit(10); // 📌 Limita a 10 resultados;
    return res.json({
      ok: true,
      cotizaciones, //! favoritos: favoritos
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarDetallePago = async (req, res = response) => {
  const termino = req.query.codCoti;

  try {
    if (!termino) {
      return res.status(400).json({
        ok: false,
        msg: "El código de cotización es requerido.",
        detallePago: [],
      });
    }

    const pagos = await Pago.findOne({ codCotizacion: termino });

    if (!pagos || pagos.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: "No se encontraron pagos para esta cotización.",
        detallePago: [],
      });
    }

    return res.status(200).json({
      ok: true,
      detallePago: pagos.detallePagos,
    });
  } catch (error) {
    console.error("❌ Error en backend:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al obtener el detalle de pagos",
      detallePago: [],
    });
  }
};

const anularPago = async (req, res = response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { motivo, observacion } = req.body;
    const { codPago } = req.params;

    // Validar que se envíe el código de pago
    if (!codPago || !motivo) {
      return res.status(400).json({
        ok: false,
        msg: "El código de pago y el motivo son requeridos.",
      });
    }

    // Buscar el pago por su código
    const pago = await Pago.findOne({ codPago });

    // Validar que el pago exista
    if (!pago) {
      return res.status(404).json({
        ok: false,
        msg: "Pago no encontrado.",
      });
    }

    // Verificar si el pago ya está anulado
    if (pago.estadoPago === "ANULADO") {
      return res.status(400).json({
        ok: false,
        msg: "El pago ya fue anulado previamente.",
      });
    }

    // Actualizar el estado del pago a ANULADO y agregar la información de anulación
    await Pago.updateOne(
      { codPago },
      {
        $set: {
          tienePagosAnteriores: false, // No se permiten pagos posteriores a la anulación
          estadoPago: "ANULADO",
          anulacion: {
            motivo: motivo,
            observacion: observacion,
            fecha: new Date(),
          },
        },
      },
      { session }
    );

    // Actualizar el estado de la cotización a MODIFICADO
    await Cotizacion.updateOne(
      { codCotizacion: pago.codCotizacion },
      { $set: { estadoCotizacion: "PAGO ANULADO" } },
      { session }
    );

    // Actualizar el estado de las solicitudes asociadas
    await SolicitudAtencion.updateMany(
      { cotizacionId: pago.codCotizacion },
      { $set: { estado: "ANULADO", "servicios.$[].estado": "ANULADO" } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      ok: true,
      msg: "Pago anulado con éxito.",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("❌ Error al anular el pago:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al anular el pago.",
    });
  }
};

module.exports = {
  generarPagoPersona,
  mostrarUltimosPagos,
  encontrarTermino,
  encontrarDetallePago,
  anularPago,
};
