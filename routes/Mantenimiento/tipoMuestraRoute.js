const { Router } = require("express");

const {
  crearTipoMuestra,
  obtenerTiposMuestra,
  obtenerTipoMuestraPorId,
  actualizarTipoMuestra,
  cambiarEstadoTipoMuestra,
} = require("../../controllers/Mantenimiento/tipoMuestraController");

const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// ==========================================
// OBTENER TODOS
// GET /api/tipoMuestra
// GET /api/tipoMuestra?estado=ACTIVO
// ==========================================
router.get("/", validarJWT, obtenerTiposMuestra);

// ==========================================
// OBTENER POR ID
// GET /api/tipoMuestra/:id
// ==========================================
router.get("/:id", validarJWT, obtenerTipoMuestraPorId);

// ==========================================
// CREAR
// POST /api/tipoMuestra
// ==========================================
router.post("/", validarJWT, crearTipoMuestra);

// ==========================================
// ACTUALIZAR
// PUT /api/tipoMuestra/:id
// ==========================================
router.put("/:id", validarJWT, actualizarTipoMuestra);

// ==========================================
// CAMBIAR ESTADO
// PUT /api/tipoMuestra/:id/estado
// ==========================================
router.put("/:id/estado", validarJWT, cambiarEstadoTipoMuestra);

module.exports = router;
