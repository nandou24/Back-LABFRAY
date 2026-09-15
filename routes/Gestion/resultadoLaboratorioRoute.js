const { Router } = require("express");

const {
  inicializarResultadosSolicitud,
  registrarEditarResultadoItem,
  registrarResultadosMasivos,
} = require("../../controllers/Gestion/resultadoLaboratorioController");

const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// ====== Inicializar resultados ======

router.post(
  "/inicializar/:solicitudAtencionId",
  validarJWT,
  inicializarResultadosSolicitud,
);

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

module.exports = router;
