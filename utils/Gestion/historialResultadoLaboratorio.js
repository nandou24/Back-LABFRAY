// ====== Clonar valor serializable ======

const clonarSerializable = (valor) => {
  if (valor === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
};

// ====== Construir snapshot antes de cambios críticos ======

const construirSnapshotResultado = (resultado) => ({
  versionResultado: Number(resultado?.versionResultado ?? 1),
  estadoResultado: resultado?.estadoResultado ?? null,
  observacionGeneral: resultado?.observacionGeneral ?? "",
  resultadosItems: clonarSerializable(resultado?.resultadosItems ?? []),
  validacion: {
    validadoPor: resultado?.validadoPor ?? null,
    usuarioValidacion: resultado?.usuarioValidacion ?? null,
    fechaValidacion: resultado?.fechaValidacion ?? null,
    observacionValidacion: resultado?.observacionValidacion ?? "",
    confirmoAlertasCriticasValidacion:
      resultado?.confirmoAlertasCriticasValidacion === true,
  },
  liberacion: {
    liberadoPor: resultado?.liberadoPor ?? null,
    usuarioLiberacion: resultado?.usuarioLiberacion ?? null,
    fechaLiberacion: resultado?.fechaLiberacion ?? null,
    confirmoAlertasCriticasLiberacion:
      resultado?.confirmoAlertasCriticasLiberacion === true,
  },
  anulacion: {
    estadoPrevioAnulacion: resultado?.estadoPrevioAnulacion ?? null,
    anuladoPor: resultado?.anuladoPor ?? null,
    usuarioAnulacion: resultado?.usuarioAnulacion ?? null,
    fechaAnulacion: resultado?.fechaAnulacion ?? null,
    motivoAnulacion: resultado?.motivoAnulacion ?? null,
    autorizacionAnulacionPor: resultado?.autorizacionAnulacionPor ?? null,
    usuarioAutorizacionAnulacion:
      resultado?.usuarioAutorizacionAnulacion ?? null,
    rolAutorizacionAnulacion: resultado?.rolAutorizacionAnulacion ?? null,
    fechaAutorizacionAnulacion:
      resultado?.fechaAutorizacionAnulacion ?? null,
  },
});

// ====== Registrar evento en historial ======

const registrarEventoHistorialResultado = (
  resultado,
  {
    tipoEvento,
    estadoAnterior = null,
    estadoNuevo = null,
    uid = null,
    nombreUsuario = null,
    detalle = "",
    metadatos = null,
    snapshotResultado = null,
    fecha = new Date(),
  },
) => {
  if (!resultado || !tipoEvento) {
    return;
  }

  if (!Array.isArray(resultado.historialEventos)) {
    resultado.historialEventos = [];
  }

  resultado.historialEventos.push({
    tipoEvento,
    versionResultado: Number(resultado.versionResultado ?? 1),
    estadoAnterior,
    estadoNuevo,
    ejecutadoPor: uid,
    usuarioEjecucion: nombreUsuario ?? null,
    fechaEvento: fecha,
    detalle: String(detalle ?? "").trim(),
    metadatos: metadatos ? clonarSerializable(metadatos) : null,
    snapshotResultado: snapshotResultado
      ? clonarSerializable(snapshotResultado)
      : null,
  });
};

module.exports = {
  construirSnapshotResultado,
  registrarEventoHistorialResultado,
};
