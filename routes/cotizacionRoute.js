const { Router } = require('express');
const { check } = require('express-validator');
const { crearCotizacion, mostrarUltimosServicios, encontrarTermino, encontrarTipoExamen, actualizarServicio } = require('../controllers/cotizacionController');
const { validarCampos } = require('../middlewares/validar-campo');
const { validarJWT } = require('../middlewares/validar-token');

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo favorito
router.post('/newCotizacionPersona', [
    
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

], crearCotizacion);

/*
//POST
//! Listar últimos servicios
router.get('/latest', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], mostrarUltimosServicios);

//POST
//! Buscar servicio
router.get('/findTerm', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], encontrarTermino);

//! Buscar exámenes
router.get('/tipoExamen', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], encontrarTipoExamen);

//POST
//! Actualizar Servicio
router.put('/:codServicio/updateServicio', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], actualizarServicio);
//para exportar rutas

*/

module.exports = router;