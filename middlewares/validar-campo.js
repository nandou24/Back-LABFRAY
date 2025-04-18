const { response } = require("express");
const { validationResult } = require("express-validator");

const validarCampos = (req, res = response, next) => {


    //validationResult obtiene los resultados de las validaciones
    const errors = validationResult(req);
     console.log(errors);
     console.log("aqui resultado de validaciones");

    if (!errors.isEmpty()) {
        console.log('no pasó validaciones')
        return res.status(400).json({
            ok: false,
            errors: errors.mapped() //! ERRORES DE FORMULARIO
        });
        
    }

    console.log('PASÓ validaciones')
    //En el middleware si pasa correctamente ejecuta el next
    next();

}

module.exports = {
    validarCampos
}