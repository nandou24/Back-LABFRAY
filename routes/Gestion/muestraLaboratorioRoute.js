const { Router } = require("express");

const {
  inicializarMuestrasSolicitud,
  recolectarMuestra,
  recibirMuestra,
  obtenerMuestrasRecepcionMasiva,
  recibirMuestrasMasivamente,
  obtenerMuestrasAceptacionMasiva,
  aceptarMuestrasMasivamente,
  aceptarMuestra,
  rechazarMuestra,
  anularMuestra,
  generarReintentoMuestra,
  obtenerBandejaTomaMuestras,
  obtenerMuestrasPorSolicitud,
  obtenerMuestrasPorCodigoLaboratorio,
  obtenerDetalleMuestra,
  registrarEvidenciaMuestra,
  anularEvidenciaMuestra,
  obtenerEvidenciasMuestra,
} = require("../../controllers/Gestion/muestraLaboratorioController");

const { validarJWT } = require("../../middlewares/validar-token");

const {
  cargarEvidenciaMuestra,
} = require("../../middlewares/subir-evidencia-muestra");

const router = Router();

// ====== Inicializar muestras ======

router.post(
  "/inicializar/:solicitudAtencionId",
  validarJWT,
  inicializarMuestrasSolicitud,
);

// ====== Recepción masiva ======

router.get(
  "/masiva/recepcion",
  validarJWT,
  obtenerMuestrasRecepcionMasiva,
);

router.put(
  "/masiva/recibir",
  validarJWT,
  recibirMuestrasMasivamente,
);

// ====== Aceptación masiva ======

router.get(
  "/masiva/aceptacion",
  validarJWT,
  obtenerMuestrasAceptacionMasiva,
);

router.put(
  "/masiva/aceptar",
  validarJWT,
  aceptarMuestrasMasivamente,
);

// ====== Registrar recolección ======

router.put("/:muestraLaboratorioId/recolectar", validarJWT, recolectarMuestra);

// ====== Registrar recepción ======

router.put("/:muestraLaboratorioId/recibir", validarJWT, recibirMuestra);

// ====== Registrar aceptación ======

router.put("/:muestraLaboratorioId/aceptar", validarJWT, aceptarMuestra);

// ====== Registrar rechazo ======

router.put(
  "/:muestraLaboratorioId/rechazar",
  validarJWT,
  cargarEvidenciaMuestra,
  rechazarMuestra,
);

// ====== Anular muestra ======

router.put("/:muestraLaboratorioId/anular", validarJWT, anularMuestra);

// ====== Generar reintento ======

router.post(
  "/:muestraLaboratorioId/reintentar",
  validarJWT,
  generarReintentoMuestra,
);

// ====== Registrar evidencia fotográfica ======

router.post(
  "/:muestraLaboratorioId/evidencias",
  validarJWT,
  cargarEvidenciaMuestra,
  registrarEvidenciaMuestra,
);

// ====== Anular evidencia fotográfica ======

router.put(
  "/:muestraLaboratorioId/evidencias/:evidenciaId/anular",
  validarJWT,
  anularEvidenciaMuestra,
);

// ====== Consultar evidencias fotográficas ======

router.get(
  "/:muestraLaboratorioId/evidencias",
  validarJWT,
  obtenerEvidenciasMuestra,
);

// ====== Bandeja operativa ======

router.get("/bandeja", validarJWT, obtenerBandejaTomaMuestras);

// ====== Consultar por solicitud ======

router.get(
  "/solicitud/:solicitudAtencionId",
  validarJWT,
  obtenerMuestrasPorSolicitud,
);

// ====== Consultar por código laboratorio ======

router.get(
  "/codigo/:codigoLaboratorio",
  validarJWT,
  obtenerMuestrasPorCodigoLaboratorio,
);

// ====== Consultar detalle de muestra ======

router.get("/:muestraLaboratorioId", validarJWT, obtenerDetalleMuestra);

module.exports = router;
