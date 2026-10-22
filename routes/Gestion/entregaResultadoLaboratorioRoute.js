const { Router } = require("express");
const { validarJWT } = require("../../middlewares/validar-token");
const { validarRutaEntrega } = require("../../middlewares/validar-ruta-entrega");
const { cargarInformeDespacho } = require("../../middlewares/subir-informe-despacho");
const {
  obtenerBandejaEntregaResultados,
  obtenerInformeEntregable,
  obtenerFirmasInformePdf,
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

const {
  registrarInformeVerificable,
  verificarInformePublico,
} = require('../../controllers/Gestion/verificacionInformeLaboratorioController');

const router = Router();

// ====== Acceso seguro público por token ======
router.post("/despachos/acceso", accederInformeDespacho);

// ====== Verificar sin revelar identidad ni resultados clínicos ======
router.get('/verificar-informe/:token', verificarInformePublico);

router.use(validarJWT, validarRutaEntrega);

// ====== Consulta de Recepción ======
router.get("/bandeja", obtenerBandejaEntregaResultados);
router.get("/solicitud/:solicitudAtencionId", obtenerInformeEntregable);

// ====== Registrar conjunto exacto de pruebas del informe ======
router.post('/solicitud/:solicitudAtencionId/informes-verificables', registrarInformeVerificable);
// ====== Firmas de informe solo desde generación PDF autenticada ======
router.post('/solicitud/:solicitudAtencionId/firmas-pdf', obtenerFirmasInformePdf);

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
