const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearEmpresa,
  obtenerEmpresas,
  actualizarEmpresa,
  buscarEmpresasPorTermino,
  eliminarContactoEmpresa,
  eliminarSedeEmpresa,
  verificarCotizacionesVinculadasContacto,
} = require("../../controllers/Mantenimiento/empresaController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! Crear una nueva empresa
router.post(
  "/",
  [
    validarJWT,

    check("ruc")
      .notEmpty()
      .withMessage("RUC es obligatorio")
      .isLength({ min: 11, max: 11 })
      .withMessage("RUC debe tener 11 dígitos"),

    check("razonSocial").notEmpty().withMessage("Razón social es obligatoria"),

    check("departamento").notEmpty().withMessage("Departamento es obligatorio"),

    check("provincia").notEmpty().withMessage("Provincia es obligatoria"),

    check("distrito").notEmpty().withMessage("Distrito es obligatorio"),

    check("cantidadTrabajadores")
      .notEmpty()
      .withMessage("Cantidad de trabajadores es obligatoria")
      .isNumeric()
      .withMessage("Cantidad de trabajadores debe ser un número"),

    check("tipoEmpresa")
      .notEmpty()
      .withMessage("Tipo de empresa es obligatorio")
      .isIn(["Privada", "Publica", "Mixta"])
      .withMessage("Tipo de empresa debe ser: Privada, Publica o Mixta"),

    // check("sector")
    //   .notEmpty()
    //   .withMessage("Sector es obligatorio")
    //   .isIn(["Salud", "Educacion", "Mineria", "Construction", "Otros"])
    //   .withMessage(
    //     "Sector debe ser: Salud, Educacion, Mineria, Construction u Otros"
    //   ),

    // Validaciones para personas de contacto (array)
    check("personasContacto")
      .isArray({ min: 1 })
      .withMessage("Debe incluir al menos una persona de contacto"),

    check("personasContacto.*.nombre")
      .notEmpty()
      .withMessage("Nombre de contacto es obligatorio"),

    check("personasContacto.*.cargo")
      .notEmpty()
      .withMessage("Cargo de contacto es obligatorio"),

    check("personasContacto.*.telefono")
      .notEmpty()
      .withMessage("Teléfono de contacto es obligatorio"),

    // Validaciones para ubicaciones/sedes (array)
    check("ubicacionesSedes")
      .isArray({ min: 1 })
      .withMessage("Debe incluir al menos una sede"),

    check("ubicacionSedes.*.nombreSede")
      .notEmpty()
      .withMessage("Nombre de sede es obligatorio"),

    check("ubicacionSedes.*.departamentoSede")
      .notEmpty()
      .withMessage("Departamento de sede es obligatorio"),

    check("ubicacionSedes.*.provinciaSede")
      .notEmpty()
      .withMessage("Provincia de sede es obligatoria"),

    check("ubicacionSedes.*.distritoSede")
      .notEmpty()
      .withMessage("Distrito de sede es obligatorio"),

    validarCampos,
  ],
  crearEmpresa
);

//! Actualizar empresa
router.put(
  "/",
  [
    validarJWT,

    check("ruc")
      .optional()
      .isLength({ min: 11, max: 11 })
      .withMessage("RUC debe tener 11 dígitos"),

    check("tipoEmpresa")
      .optional()
      .isIn(["Privada", "Publica", "Mixta"])
      .withMessage("Tipo de empresa debe ser: Privada, Publica o Mixta"),

    // check("sector")
    //   .optional()
    //   .isIn(["Salud", "Educacion", "Mineria", "Construction", "Otros"])
    //   .withMessage(
    //     "Sector debe ser: Salud, Educacion, Mineria, Construction u Otros"
    //   ),

    check("cantidadTrabajadores")
      .optional()
      .isNumeric()
      .withMessage("Cantidad de trabajadores debe ser un número"),

    validarCampos,
  ],
  actualizarEmpresa
);

//GET

//! Obtener todas las empresas
router.get("/", [validarJWT], obtenerEmpresas);

//! Buscar empresas por término
router.get("/findTerm", buscarEmpresasPorTermino);

//! Verificar cotizaciones vinculadas a un contacto
router.get(
  "/contacto/:ruc/:contactoId/cotizaciones",
  [validarJWT],
  verificarCotizacionesVinculadasContacto
);

//DELETE

//! Eliminar contacto específico de empresa
router.delete(
  "/contacto/:ruc/:contactoId",
  [validarJWT],
  eliminarContactoEmpresa
);

//! Eliminar sede específica de empresa
router.delete("/sede/:ruc/:sedeId", [validarJWT], eliminarSedeEmpresa);

// //! Eliminar empresa (soft delete)
// router.delete("/deleteEmpresa/:ruc", [validarJWT], eliminarEmpresa);

module.exports = router;
