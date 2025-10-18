const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearAtencionEmpresa,
  listarAtencionesVigentes,
} = require("../../controllers/Gestion/atencionEmpresaController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// Registrar una nueva atención de empresa
router.post(
  "/",
  [
    validarJWT,
    check("servicioTipo", "El tipo de servicio es obligatorio").not().isEmpty(),
    check("fechaRegistro", "La fecha de registro es obligatoria")
      .not()
      .isEmpty(),
    check("programaciones", "Debe haber al menos una programación").isArray({
      min: 1,
    }),
    validarCampos,
  ],
  crearAtencionEmpresa
);

router.get("/listar-vigentes", validarJWT, listarAtencionesVigentes);

module.exports = router;
