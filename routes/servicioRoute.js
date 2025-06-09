const { Router } = require('express');
const { check } = require('express-validator');
const { crearServicio, mostrarUltimosServicios, encontrarTermino, encontrarTipoExamen, actualizarServicio, mostrarServiciosFavoritos } = require('../controllers/servicioController');
const { validarCampos } = require('../middlewares/validar-campo');
const { validarJWT } = require('../middlewares/validar-token');

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo favorito
router.post('/newServicio', [
    
    //validarJWT,
       
    check('tipoServicio')
    .notEmpty().withMessage('Tipo de servicio es obligatorio'),

    check('nombreServicio')
    .notEmpty().withMessage('Nombre de servicio es obligatorio'),
         
    check('precioServicio')
    .notEmpty().withMessage('Precio de servicio es obligatorio'),

    check('estadoServicio')
    .notEmpty().withMessage('Estado del servicio es obligatorio'), 
    
    validarCampos

], crearServicio);

//POST
//! Listar últimos servicios
router.get('/latest', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], mostrarUltimosServicios);

router.get('/latestFavorites', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], mostrarServiciosFavoritos);

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
module.exports = router;