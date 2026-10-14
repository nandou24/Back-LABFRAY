const { Router } = require("express");

const {
  crearDiaNoLaborable,
  obtenerDiasNoLaborables,
  obtenerDiaNoLaborablePorId,
  actualizarDiaNoLaborable,
  cambiarEstadoDiaNoLaborable,
} = require("../../controllers/Mantenimiento/diaNoLaborableController");

const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

router.get("/", validarJWT, obtenerDiasNoLaborables);
router.get("/:id", validarJWT, obtenerDiaNoLaborablePorId);
router.post("/", validarJWT, crearDiaNoLaborable);
router.put("/:id", validarJWT, actualizarDiaNoLaborable);
router.put("/:id/estado", validarJWT, cambiarEstadoDiaNoLaborable);

module.exports = router;
