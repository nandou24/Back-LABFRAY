const { Router } = require("express");

const {
  crearLaboratorioReferencia,
  obtenerLaboratoriosReferencia,
  obtenerLaboratorioReferenciaPorId,
  actualizarLaboratorioReferencia,
  cambiarEstadoLaboratorioReferencia,
} = require("../../controllers/Mantenimiento/laboratorioReferenciaController");

const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// ====== Listar / buscar ======

router.get("/", validarJWT, obtenerLaboratoriosReferencia);

// ====== Obtener por ID ======

router.get("/:id", validarJWT, obtenerLaboratorioReferenciaPorId);

// ====== Registrar ======

router.post("/", validarJWT, crearLaboratorioReferencia);

// ====== Actualizar ======

router.put("/:id", validarJWT, actualizarLaboratorioReferencia);

// ====== Cambiar estado ======

router.put("/:id/estado", validarJWT, cambiarEstadoLaboratorioReferencia);

module.exports = router;
