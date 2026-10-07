const { Router } = require("express");
const { validarJWT } = require("../../middlewares/validar-token");
const { validarRutaEntrega } = require("../../middlewares/validar-ruta-entrega");
const {
  obtenerBandejaEntregaResultados,
  obtenerInformeEntregable,
  registrarEntregaResultados,
} = require("../../controllers/Gestion/entregaResultadoLaboratorioController");

const router = Router();
router.use(validarJWT, validarRutaEntrega);

// ====== Consulta de Recepción ======
router.get("/bandeja", obtenerBandejaEntregaResultados);
router.get("/solicitud/:solicitudAtencionId", obtenerInformeEntregable);

// ====== Registro de entrega parcial o final ======
router.post("/solicitud/:solicitudAtencionId/entregas", registrarEntregaResultados);

module.exports = router;
