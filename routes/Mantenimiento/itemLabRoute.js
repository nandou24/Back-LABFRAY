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

const router = Router();

// ==========================================================
// VALIDACIONES ITEM LAB
// ==========================================================

const validacionesItemLab = [
  check("nombreInforme")
    .notEmpty()
    .withMessage("Nombre de informe es obligatorio"),

  check("nombreHojaTrabajo")
    .notEmpty()
    .withMessage("Nombre de hoja de trabajo es obligatorio"),

  check("metodoItemLab").notEmpty().withMessage("Método es obligatorio"),

  // ========================================================
  // TIPO DE RESULTADO
  // ========================================================

  check("tipoResultado", "Tipo de resultado no válido").isIn([
    "NUMERICO",
    "TEXTO",
    "CATEGORICO",
  ]),

  // ========================================================
  // UNIDADES
  // Solo obligatorias para NUMERICO
  // ========================================================

  check("unidadesRef").custom((value, { req }) => {
    if (req.body.tipoResultado === "NUMERICO") {
      if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
      ) {
        throw new Error("Unidades es obligatorio para resultados numéricos");
      }
    }

    return true;
  }),

  // ========================================================
  // OPCIONES
  // Obligatorias para CATEGORICO
  // ========================================================

  check("opcionesResultado").custom((value, { req }) => {
    if (req.body.tipoResultado === "CATEGORICO") {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(
          "Un resultado categórico debe tener al menos una opción",
        );
      }
    }

    return true;
  }),

  check("permiteValorNoListado")
    .optional()
    .isBoolean()
    .withMessage("Permite valor no listado debe ser verdadero o falso"),

  // ========================================================
  // LEGACY
  // ========================================================

  check("poseeValidacion")
    .optional()
    .isBoolean()
    .withMessage("Posee Validación debe ser verdadero o falso"),

  validarCampos,
];

// ==========================================================
// CREAR
// ==========================================================

router.post("/newItemLab", [validarJWT, ...validacionesItemLab], crearItemLab);

// ==========================================================
// LISTAR
// ==========================================================

router.get("/lastItems", mostrarUltimosItems);

// ==========================================================
// BUSCAR
// ==========================================================

router.get("/findTerm", encontrarTermino);

// ==========================================================
// ACTUALIZAR
// ==========================================================

router.put(
  "/:codigo/updateItem",
  [validarJWT, ...validacionesItemLab],
  actualizarItem,
);

module.exports = router;
