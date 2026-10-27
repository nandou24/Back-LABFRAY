const { Router } = require("express");
const {
  subirFotoPerfilPaciente,
  subirFotoEvaluacionPaciente,
  subirFotoEvaluacionTemporal,
  listarHistorialFotosTemporales,
  obtenerImagenHistoricaTemporal,
  obtenerImagenEvaluacionPaciente,
  obtenerFotoPerfilPaciente,
  obtenerFotoIdentificacionPaciente,
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

// ====== Evaluación: subir imagen vinculada a programación y solicitudes ======
router.post(
  '/:pacienteId/foto-evaluacion',
  validarJWT,
  uploadArchivoPaciente.single('archivo'),
  subirFotoEvaluacionPaciente,
);

// ====== MC.2: fotografía temporal por programación, nunca por paciente ======
router.post(
  '/programaciones/:programacionEmpresaId/foto-evaluacion-temporal',
  validarJWT,
  uploadArchivoPaciente.single('archivo'),
  subirFotoEvaluacionTemporal,
);

// ====== MC.3.2: consultar historial y fotografía original ======
router.get('/programaciones/:programacionEmpresaId/fotos-temporales',
  validarJWT, listarHistorialFotosTemporales);
router.get('/programaciones/:programacionEmpresaId/fotos-temporales/:fotoId/imagen',
  validarJWT, obtenerImagenHistoricaTemporal);

// ====== Lectura autenticada en lugar de URL pública S3 ======
router.get('/foto-evaluacion/imagen', validarJWT, obtenerImagenEvaluacionPaciente);

// ====== Consulta de identificación por HC, paciente o programación ======
router.get("/foto-identificacion", validarJWT, obtenerFotoIdentificacionPaciente);

// ====== Consultar foto de identificación ======
router.get(
  "/:pacienteId/foto-perfil",
  validarJWT,
  obtenerFotoPerfilPaciente,
);

module.exports = router;
