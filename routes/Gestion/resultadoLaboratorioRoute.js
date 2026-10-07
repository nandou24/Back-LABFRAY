const { Router } = require("express");

const {
  obtenerBandejaResultadosLaboratorio,
  inicializarResultadosSolicitud,
  registrarEditarResultadoItem,
  registrarResultadosMasivos,
  revisarResultadoAntesValidacion,
  validarResultadosMasivamente,
  validarResultadoLaboratorio,
  liberarResultadoLaboratorio,
  obtenerResultadosPorSolicitud,
  obtenerResultadoPorId,
  obtenerResultadosLiberadosPorSolicitud,
} = require("../../controllers/Gestion/resultadoLaboratorioController");
const {
  anularResultadoLaboratorioSeguro,
  reabrirResultadoLaboratorio,
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

// ====== Consulta y entrega independiente para Recepción ======
router.use("/entrega", require("./entregaResultadoLaboratorioRoute"));

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

// ====== Revisar informe antes de validar ======

router.put(
  "/:resultadoLaboratorioId/revision-items",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_VALIDAR),
  revisarResultadoAntesValidacion,
);

// ====== Validar resultados masivamente ======

router.put(
  "/validar-masivo",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_VALIDAR),
  validarResultadosMasivamente,
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

// ====== Reabrir resultado anulado ======

router.put(
  "/:resultadoLaboratorioId/reabrir",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_ANULAR),
  reabrirResultadoLaboratorio,
);

module.exports = router;
