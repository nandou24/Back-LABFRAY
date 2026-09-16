const { Router } = require("express");

const {
  inicializarMuestrasSolicitud,
  recolectarMuestra,
  recibirMuestra,
  aceptarMuestra,
  rechazarMuestra,
  generarReintentoMuestra,
  obtenerMuestrasPorSolicitud,
  obtenerMuestrasPorCodigoLaboratorio,
  obtenerDetalleMuestra,
  registrarEvidenciaMuestra,
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

// ====== Registrar recolección ======

router.put("/:muestraLaboratorioId/recolectar", validarJWT, recolectarMuestra);

// ====== Registrar recepción ======

router.put("/:muestraLaboratorioId/recibir", validarJWT, recibirMuestra);

// ====== Registrar aceptación ======

router.put("/:muestraLaboratorioId/aceptar", validarJWT, aceptarMuestra);

// ====== Registrar rechazo ======

router.put("/:muestraLaboratorioId/rechazar", validarJWT, rechazarMuestra);

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
