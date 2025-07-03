const { Router } = require("express");
const { check } = require("express-validator");
const {
  generarPagoPersona,
  mostrarUltimosPagos,
  encontrarTermino,
  encontrarDetallePago,
  anularPago,
} = require("../../controllers/Gestion/pagoController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo pago
router.post(
  "/newPagoPersona",
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
  generarPagoPersona
);

//POST
//! Listar últimos pagos
router.get(
  "/latest",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimosPagos
);

//POST
//! Buscar pago por término
router.get(
  "/findTerm",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTermino
);

//! Buscar pago detalle
router.get(
  "/findPayDetail",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarDetallePago
);

router.put(
  "/anularPago/:codPago",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  anularPago
);

module.exports = router;
