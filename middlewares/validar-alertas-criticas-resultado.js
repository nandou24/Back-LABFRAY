const mongoose = require("mongoose");
const { response } = require("express");

const ResultadoLaboratorio = require("../models/Gestion/ResultadoLaboratorio");

// ====== Exigir confirmación para alertas críticas ======

const validarConfirmacionAlertasCriticasResultado = async (
  req,
  res = response,
  next,
) => {
  try {
    const { resultadoLaboratorioId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(resultadoLaboratorioId)) {
      return res.status(400).json({
        ok: false,
        msg: "El id del resultado de laboratorio no es válido",
      });
    }

    const resultado = await ResultadoLaboratorio.findById(
      resultadoLaboratorioId,
    )
      .select("resultadosItems.alertasDetectadas")
      .lean();

    if (!resultado) {
      return res.status(404).json({
        ok: false,
        msg: "El resultado de laboratorio no existe",
      });
    }

    const alertasCriticas = (resultado.resultadosItems ?? []).reduce(
      (total, item) =>
        total +
        (item.alertasDetectadas ?? []).filter(
          (alerta) => alerta.nivelAlerta === "CRITICA",
        ).length,
      0,
    );

    req.alertasCriticasResultado = alertasCriticas;

    if (
      alertasCriticas > 0 &&
      req.body?.confirmarAlertasCriticas !== true
    ) {
      return res.status(409).json({
        ok: false,
        codigo: "CONFIRMACION_ALERTAS_CRITICAS_REQUERIDA",
        alertasCriticas,
        msg:
          "El resultado contiene alertas críticas. Debe confirmar explícitamente su revisión antes de continuar",
      });
    }

    next();
  } catch (error) {
    console.error("Error al validar alertas críticas del resultado:", error);

    return res.status(500).json({
      ok: false,
      msg: "No se pudo verificar las alertas críticas del resultado",
    });
  }
};

module.exports = {
  validarConfirmacionAlertasCriticasResultado,
};
