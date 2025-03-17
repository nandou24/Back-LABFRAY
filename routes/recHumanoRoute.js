const { Router } = require('express');
const { check } = require('express-validator');
const { crearRecursoHumano, mostrarUltimosRecurHumanos, encontrarTermino, actualizarRecursoHumano, obtenerSolicitantes,
    encontrarTerminoSolicitante} = require('../controllers/recursoHumanoController');
const { validarCampos } = require('../middlewares/validar-campo');
const { validarJWT } = require('../middlewares/validar-token');

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo favorito
router.post('/newRecHumano', [
    
    //validarJWT,
    
    check('tipoDoc')
    .notEmpty().withMessage('Tipo documento es obligatorio'),

    check('nroDoc')
    .notEmpty().withMessage('Número de doc es obligatorio'),

    check('nombreRecHumano')
    .notEmpty().withMessage('Nombre es obligatorio'),

    check('apePatRecHumano')
    .notEmpty().withMessage('Apellido Paterno es obligatorio'),
         
    check('fechaNacimiento')
    .notEmpty().withMessage('Fecha de nacimiento es obligatorio'),

    check('sexoRecHumano')
    .notEmpty().withMessage('Sexo es obligatorio'),  

    check('departamentoRecHumano')
    .notEmpty().withMessage('Departamento es obligatorio'), 

    check('provinciaRecHumano')
    .notEmpty().withMessage('Provincia es obligatorio'), 
        
    check('distritoRecHumano')
    .notEmpty().withMessage('Distrito es obligatorio'), 

    //check('phones')
    //.notEmpty().withMessage('Al menos un teléfono es obligatorio'), 

    validarCampos

], crearRecursoHumano);

//POST
//! Listar últimos 30 recursos humanos
router.get('/latest', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], mostrarUltimosRecurHumanos);

//! Listar últimos solicitantes
router.get('/latestSolicitantes', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], obtenerSolicitantes);

//POST
//! Buscar recurso humano
router.get('/findTerm', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], encontrarTermino);

//! Buscar solicitante
router.get('/findTermSolicitante', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], encontrarTerminoSolicitante);

//POST
//! Actualizar Paciente
router.put('/:codRecHumano/updateRecHumano', [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
], actualizarRecursoHumano);
//para exportar rutas
module.exports = router;