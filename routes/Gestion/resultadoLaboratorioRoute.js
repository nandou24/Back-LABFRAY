const { Router } = require("express");

const {
  inicializarResultadosSolicitud,
  registrarEditarResultadoItem,
  registrarResultadosMasivos,
  validarResultadoLaboratorio,
  liberarResultadoLaboratorio,
  anularResultadoLaboratorio,
  obtenerResultadosPorSolicitud,
  obtenerResultadoPorId,
  obtenerResultadosLiberadosPorSolicitud,
} = require("../../controllers/Gestion/resultadoLaboratorioController");

const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

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
  registrarEditarResultadoItem,
);

// ====== Registrar resultados masivos ======

router.put(
  "/:resultadoLaboratorioId/items",
  validarJWT,
  registrarResultadosMasivos,
);

// ====== Validar resultado ======

router.put(
  "/:resultadoLaboratorioId/validar",
  validarJWT,
  validarResultadoLaboratorio,
);
// ====== Liberar resultado ======

router.put(
  "/:resultadoLaboratorioId/liberar",
  validarJWT,
  liberarResultadoLaboratorio,
);

// ====== Anular resultado ======

router.put(
  "/:resultadoLaboratorioId/anular",
  validarJWT,
  anularResultadoLaboratorio,
);

module.exports = router;
