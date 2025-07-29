const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearPruebaLab,
  mostrarUltimasPruebas,
  encontrarTermino,
  actualizarPrueba,
} = require("../../controllers/Mantenimiento/pruebaLabController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo favorito
router.post(
  "/newPruebaLab",
  [
    //validarJWT,

    check("areaLab")
      .notEmpty()
      .withMessage("Área de laboratorio es obligatorio"),

    check("nombrePruebaLab")
      .notEmpty()
      .withMessage("Nombre de prueba es obligatorio"),

    check("condPreAnalitPaciente")
      .notEmpty()
      .withMessage("Condiciones pre-analíticas para paciente son obligatorias"),

    check("condPreAnalitRefer")
      .notEmpty()
      .withMessage(
        "Condiciones pre-analíticas para referencia son obligatorias"
      ),

    check("tipoMuestra")
      .notEmpty()
      .withMessage("Tipo de muestra es obligatorio"),

    check("tipoTuboEnvase")
      .notEmpty()
      .withMessage("Tipo de tubo / envase es obligatorio"),

    check("tiempoRespuesta")
      .notEmpty()
      .withMessage("Tiempo de respuesta es obligatorio"),

    check("estadoPrueba")
      .notEmpty()
      .withMessage("Estado de la prueba es obligatorio"),

    validarCampos,
  ],
  crearPruebaLab
);

//POST
//! Listar últimos 30 pacientes
router.get(
  "/last30",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimasPruebas
);

//POST
//! Buscar paciente
router.get(
  "/findTerm",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTermino
);

//POST
//! Actualizar Paciente
router.put(
  "/:codPruebaLab/updatePrueba",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  actualizarPrueba
);
//para exportar rutas
module.exports = router;
