const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearCotizacion,
  mostrarUltimasCotizaciones,
  encontrarTermino,
  mostrarUltimasCotizacionesPorPagar,
  crearNuevaVersionCotiPersona,
  mostrarUltimasCotizacionesPagadas,
  verificarHcRegistrada,
} = require("../../controllers/Gestion/cotizacionController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nueva cotizacion
router.post(
  "/newCotizacionPersona",
  [
    //validarJWT,
    /*
    check('tipoServicio')
    .notEmpty().withMessage('Tipo de servicio es obligatorio'),

    check('nombreServicio')
    .notEmpty().withMessage('Nombre de servicio es obligatorio'),
         
    check('precioServicio')
    .notEmpty().withMessage('Precio de servicio es obligatorio'),

    check('estadoServicio')
    .notEmpty().withMessage('Estado del servicio es obligatorio'), 
    
    validarCampos*/
  ],
  crearCotizacion
);

//! crear un nuevo version
router.post(
  "/newVersionCotizacionPersona",
  [
    //validarJWT,
    /*
    check('tipoServicio')
    .notEmpty().withMessage('Tipo de servicio es obligatorio'),

    check('nombreServicio')
    .notEmpty().withMessage('Nombre de servicio es obligatorio'),
         
    check('precioServicio')
    .notEmpty().withMessage('Precio de servicio es obligatorio'),

    check('estadoServicio')
    .notEmpty().withMessage('Estado del servicio es obligatorio'), 
    
    validarCampos*/
  ],
  crearNuevaVersionCotiPersona
);

//POST
//! Listar últimas cotizaciones
router.get(
  "/latest",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimasCotizaciones
);

//! Listar últimas cotizaciones por pagar
router.get(
  "/latestPorPagar",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimasCotizacionesPorPagar
);

//! Listar últimas cotizaciones pagadas
router.get(
  "/latestPagadas",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimasCotizacionesPagadas
);

//! Buscar servicio
router.get(
  "/findTerm",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTermino
);

//GET
router.get(
  "/findHC",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  verificarHcRegistrada
);

module.exports = router;
