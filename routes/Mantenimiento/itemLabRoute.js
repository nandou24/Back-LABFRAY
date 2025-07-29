const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearItemLab,
  mostrarUltimosItems,
  encontrarTermino,
  actualizarItem,
} = require("../../controllers/Mantenimiento/itemLabController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo favorito
router.post(
  "/newItemLab",
  [
    //validarJWT,

    check("nombreInforme")
      .notEmpty()
      .withMessage("Nombre de informe es obligatorio"),

    check("nombreHojaTrabajo")
      .notEmpty()
      .withMessage("Nombre de hoja de trabajo es obligatorio"),

    check("metodoItemLab").notEmpty().withMessage("Falta método"),

    check("valoresInforme").notEmpty().withMessage("Falta valores de informe"),

    check("unidadesRef").notEmpty().withMessage("Unidades es obligatorio"),

    check("poseeValidacion")
      .notEmpty()
      .withMessage("Posee Validación es obligatorio"),

    validarCampos,
  ],
  crearItemLab
);

//POST
//! Listar últimos 30 pacientes
router.get(
  "/lastItems",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimosItems
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
  "/:codigo/updateItem",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  actualizarItem
);
//para exportar rutas
module.exports = router;
