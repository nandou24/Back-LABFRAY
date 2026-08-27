const { Router } = require("express");
const {
  subirFotoPerfilPaciente,
} = require("../../controllers/Mantenimiento/archivoPacienteController");
const uploadArchivoPaciente = require("../../middlewares/uploadArchivoPaciente");
const { validarJWT } = require("../../middlewares/validar-token");
const router = Router();

// ==========================================
// SUBIR / ACTUALIZAR FOTO DE PERFIL
// ==========================================

router.post(
  "/:pacienteId/foto-perfil",
  validarJWT,
  uploadArchivoPaciente.single("archivo"),
  subirFotoPerfilPaciente,
);

module.exports = router;
