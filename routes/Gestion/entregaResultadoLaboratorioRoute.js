const { Router } = require("express");
const { validarJWT } = require("../../middlewares/validar-token");
const { validarRutaEntrega } = require("../../middlewares/validar-ruta-entrega");
const { cargarInformeDespacho } = require("../../middlewares/subir-informe-despacho");
const {
  obtenerBandejaEntregaResultados,
  obtenerInformeEntregable,
  registrarEntregaResultados,
} = require("../../controllers/Gestion/entregaResultadoLaboratorioController");
const {
  crearDespachoSolicitud,
  enviarCorreoDespacho,
  enviarWhatsappDespacho,
  accederInformeDespacho,
  revocarAccesoDespacho,
  obtenerDespachosSolicitud,
  obtenerDespachoPorId,
  cancelarDespacho,
} = require("../../controllers/Gestion/despachoResultadoLaboratorioController");

const router = Router();

// ====== Acceso seguro público por token ======
router.post("/despachos/acceso", accederInformeDespacho);

router.use(validarJWT, validarRutaEntrega);

// ====== Consulta de Recepción ======
router.get("/bandeja", obtenerBandejaEntregaResultados);
router.get("/solicitud/:solicitudAtencionId", obtenerInformeEntregable);

// ====== Motor común de despacho ======
router.post("/solicitud/:solicitudAtencionId/despachos", crearDespachoSolicitud);
router.post(
  "/despachos/:despachoId/enviar-correo",
  cargarInformeDespacho,
  enviarCorreoDespacho,
);
router.post(
  "/despachos/:despachoId/enviar-whatsapp",
  enviarWhatsappDespacho,
);
router.get("/solicitud/:solicitudAtencionId/despachos", obtenerDespachosSolicitud);
router.get("/despachos/:despachoId", obtenerDespachoPorId);
router.post("/despachos/:despachoId/cancelar", cancelarDespacho);
router.post("/despachos/:despachoId/revocar-enlace", revocarAccesoDespacho);

// ====== Registro de entrega parcial o final ======
router.post("/solicitud/:solicitudAtencionId/entregas", registrarEntregaResultados);

module.exports = router;
