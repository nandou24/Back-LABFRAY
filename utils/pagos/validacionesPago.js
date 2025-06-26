function validarEntradaPago(datos) {
  const { serviciosCotizacion, detallePagos, totalFacturar } = datos;

  // 1. Validar que serviciosCotizacion no esté vacío
  if (
    !serviciosCotizacion ||
    !Array.isArray(serviciosCotizacion) ||
    serviciosCotizacion.length === 0
  ) {
    return {
      ok: false,
      msg: "No se han registrado servicios en la cotización a pagar.",
    };
  }

  // 2. Validar que detallePagos no esté vacío
  if (
    !detallePagos ||
    !Array.isArray(detallePagos) ||
    detallePagos.length === 0
  ) {
    return {
      ok: false,
      msg: "Debe registrar al menos un pago en la cotización.",
    };
  }

  // 3. Validar totalFacturar > 0
  if (typeof totalFacturar !== "number" || totalFacturar <= 0) {
    return {
      ok: false,
      msg: "El total a facturar debe ser mayor que cero.",
    };
  }

  return { ok: true };
}

module.exports = {
  validarEntradaPago,
};
