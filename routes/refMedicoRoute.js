const { Router } = require('express');
const { check } = require('express-validator');
const { crearRefMedico, mostrarUltimosRefMedicos, encontrarTerminoRefMedico, actualizarRefMedico } = require('../controllers/refMedicoController');
const { validarCampos } = require('../middlewares/validar-campo');
// const { validarJWT } = require('../middlewares/validar-token');

const router = Router();

router.post('/newRefMedico', [
    //validarJWT,
    check('tipoDoc').notEmpty().withMessage('Tipo documento es obligatorio'),
    check('nroDoc').notEmpty().withMessage('Número de doc es obligatorio'),
    check('nombreRefMedico').notEmpty().withMessage('Nombre es obligatorio'),
    check('apePatRefMedico').notEmpty().withMessage('Apellido Paterno es obligatorio'),
    check('fechaNacimiento').notEmpty().withMessage('Fecha de nacimiento es obligatorio'),
    check('sexoRefMedico').notEmpty().withMessage('Sexo es obligatorio'),
    check('departamentoRefMedico').notEmpty().withMessage('Departamento es obligatorio'),
    check('provinciaRefMedico').notEmpty().withMessage('Provincia es obligatorio'),
    check('distritoRefMedico').notEmpty().withMessage('Distrito es obligatorio'),
    //check('phones').notEmpty().withMessage('Al menos un teléfono es obligatorio'),
    validarCampos
], crearRefMedico);

router.get('/latest', mostrarUltimosRefMedicos);
router.get('/findTerm', encontrarTerminoRefMedico);
router.put('/:codRefMedico/updateRefMedico', actualizarRefMedico);

module.exports = router;
