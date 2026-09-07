const { Router } = require("express");

const {
  crearTuboEnvase,
  obtenerTubosEnvases,
  obtenerTuboEnvasePorId,
  actualizarTuboEnvase,
  cambiarEstadoTuboEnvase,
} = require("../../controllers/Mantenimiento/tuboEnvaseController");

const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// ==========================================
// OBTENER TODOS
// GET /api/tuboEnvase
// GET /api/tuboEnvase?estado=ACTIVO
// ==========================================
router.get("/", validarJWT, obtenerTubosEnvases);

// ==========================================
// OBTENER POR ID
// GET /api/tuboEnvase/:id
// ==========================================
router.get("/:id", validarJWT, obtenerTuboEnvasePorId);

// ==========================================
// CREAR
// POST /api/tuboEnvase
// ==========================================
router.post("/", validarJWT, crearTuboEnvase);

// ==========================================
// ACTUALIZAR
// PUT /api/tuboEnvase/:id
// ==========================================
router.put("/:id", validarJWT, actualizarTuboEnvase);

// ==========================================
// CAMBIAR ESTADO
// PUT /api/tuboEnvase/:id/estado
// ==========================================
router.put("/:id/estado", validarJWT, cambiarEstadoTuboEnvase);

module.exports = router;
