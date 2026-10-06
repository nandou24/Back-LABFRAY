const { Router } = require("express");

const {
  obtenerBandejaResultadosLaboratorio,
  inicializarResultadosSolicitud,
  registrarEditarResultadoItem,
  registrarResultadosMasivos,
  validarResultadoLaboratorio,
  liberarResultadoLaboratorio,
  obtenerResultadosPorSolicitud,
  obtenerResultadoPorId,
  obtenerResultadosLiberadosPorSolicitud,
} = require("../../controllers/Gestion/resultadoLaboratorioController");
const {
  anularResultadoLaboratorioSeguro,
} = require("../../controllers/Gestion/resultadoLaboratorioCierreController");

const { validarJWT } = require("../../middlewares/validar-token");
const {
  validarPermisoAccion,
} = require("../../middlewares/validar-permiso-accion");
const {
  validarConfirmacionAlertasCriticasResultado,
} = require("../../middlewares/validar-alertas-criticas-resultado");
const { PERMISOS_ACCION } = require("../../utils/permisosAccion");

const router = Router();

// ====== Bandeja de Gestión de Resultados ======

router.get("/bandeja", validarJWT, obtenerBandejaResultadosLaboratorio);

// ====== Inicializar resultados ======

router.post(
  "/inicializar/:solicitudAtencionId",
  validarJWT,
  inicializarResultadosSolicitud,
);

// ====== Obtener resultados por solicitud ======

router.get(
  "/solicitud/:solicitudAtencionId",
  validarJWT,
  obtenerResultadosPorSolicitud,
);

// ====== Obtener resultados liberados por solicitud ======

router.get(
  "/solicitud/:solicitudAtencionId/liberados",
  validarJWT,
  obtenerResultadosLiberadosPorSolicitud,
);

// ====== Obtener resultado por id ======

router.get("/:resultadoLaboratorioId", validarJWT, obtenerResultadoPorId);

// ====== Registrar o editar Item ======

router.put(
  "/:resultadoLaboratorioId/items/:itemResultadoId",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_REGISTRAR),
  registrarEditarResultadoItem,
);

// ====== Registrar resultados masivos ======

router.put(
  "/:resultadoLaboratorioId/items",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_REGISTRAR),
  registrarResultadosMasivos,
);

// ====== Validar resultado ======

router.put(
  "/:resultadoLaboratorioId/validar",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_VALIDAR),
  validarConfirmacionAlertasCriticasResultado,
  validarResultadoLaboratorio,
);

// ====== Liberar resultado ======

router.put(
  "/:resultadoLaboratorioId/liberar",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_LIBERAR),
  validarConfirmacionAlertasCriticasResultado,
  liberarResultadoLaboratorio,
);

// ====== Anular resultado ======

router.put(
  "/:resultadoLaboratorioId/anular",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_ANULAR),
  anularResultadoLaboratorioSeguro,
);

module.exports = router;
