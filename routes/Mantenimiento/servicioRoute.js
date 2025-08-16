const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearServicio,
  mostrarUltimosServicios,
  encontrarTermino,
  encontrarTipoExamen,
  actualizarServicio,
  mostrarServiciosFavoritos,
  obtenerItemsLaboratorioPorServicio,
  mostrarServiciosFavoritosEmpresa,
} = require("../../controllers/Mantenimiento/servicioController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo favorito
router.post(
  "/newServicio",
  [
    validarJWT,

    check("tipoServicio")
      .notEmpty()
      .withMessage("Tipo de servicio es obligatorio"),

    check("nombreServicio")
      .notEmpty()
      .withMessage("Nombre de servicio es obligatorio"),

    check("precioServicio")
      .notEmpty()
      .withMessage("Precio de servicio es obligatorio"),

    check("estadoServicio")
      .notEmpty()
      .withMessage("Estado del servicio es obligatorio"),

    validarCampos,
  ],
  crearServicio
);

//POST
//! Listar últimos servicios
router.get("/latest", mostrarUltimosServicios);

router.get("/latestFavorites", mostrarServiciosFavoritos);

router.get("/latestFavoritesEmpresa", mostrarServiciosFavoritosEmpresa);

//POST
//! Buscar servicio
router.get(
  "/findTerm",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTermino
);

//! Buscar exámenes
router.get(
  "/tipoExamen",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTipoExamen
);

//PUT
//! Actualizar Servicio
router.put("/:codServicio/updateServicio", [validarJWT], actualizarServicio);

router.get(
  "/pruebaLab-items",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  obtenerItemsLaboratorioPorServicio
);

//para exportar rutas
module.exports = router;
