const crearNuevoPago = async ({
  reqBody,
  detallePagos,
  faltaPagarCalculado,
  estadoCotizacionBack,
  session,
}) => {
  const detalleConAntiguedad = detallePagos.map((p) => ({
    medioPago: p.medioPago,
    monto: p.monto,
    recargo: p.recargo,
    numOperacion: p.numOperacion,
    fechaPago: p.fechaPago,
    banco: p.banco,
    esAntiguo: true,
  }));

  const nuevoCodPago = await generarCodigoPago();

  const nuevoPago = new Pago({
    ...reqBody,
    detallePagos: detalleConAntiguedad,
    codPago: nuevoCodPago,
    faltaPagar: faltaPagarCalculado,
  });

  await nuevoPago.save({ session });

  await Cotizacion.findOneAndUpdate(
    { codCotizacion: reqBody.codCotizacion },
    { $set: { estadoCotizacion: estadoCotizacionBack } },
    { session }
  );

  return nuevoCodPago;
};

const actualizarPagoExistente = async ({
  codCotizacion,
  detallePagos,
  faltaPagarCalculado,
  subTotalFacturar,
  igvFacturar,
  totalFacturar,
  estadoCotizacionBack,
  session,
}) => {
  const nuevosPagos = detallePagos
    .filter((p) => !p.esAntiguo)
    .map((p) => ({
      ...p,
      esAntiguo: true,
    }));

  await Pago.updateOne(
    { codCotizacion },
    {
      $push: { detallePagos: { $each: nuevosPagos } },
      $set: {
        faltaPagar: faltaPagarCalculado,
        subTotalFacturar,
        igvFacturar,
        totalFacturar,
      },
    },
    { session }
  );

  await Cotizacion.findOneAndUpdate(
    { codCotizacion },
    { $set: { estadoCotizacion: estadoCotizacionBack } },
    { session }
  );
};

module.exports = {
  crearNuevoPago,
  actualizarPagoExistente,
};
