const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearPaciente,
  mostrarUltimosPacientes,
  encontrarTermino,
  actualizarPaciente,
  obtenerHistorialCambiosPaciente,
  actualizarDatosComplementarios,
  encontrarTerminoCotizaicon,
  mostrarUltimosPacientesCotizacion,
  encontrarTerminoporId,
} = require("../../controllers/Mantenimiento/pacienteController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo favorito
router.post(
  "/newPaciente",
  [
    validarJWT,

    check("tipoDoc").notEmpty().withMessage("Tipo documento es obligatorio"),

    check("nroDoc").notEmpty().withMessage("Número de doc es obligatorio"),

    check("nombreCliente").notEmpty().withMessage("Nombre es obligatorio"),

    check("apePatCliente")
      .notEmpty()
      .withMessage("Apellido Paterno es obligatorio"),

    check("fechaNacimiento").notEmpty().withMessage("Fecha de nacimiento es obligatoria"),
    check("sexoCliente").isIn(["Masculino", "Femenino"]).withMessage("Sexo es obligatorio"),

    check("departamentoCliente")
      .notEmpty()
      .withMessage("Departamento es obligatorio"),

    check("provinciaCliente")
      .notEmpty()
      .withMessage("Provincia es obligatorio"),

    // ====== Distrito opcional ======

    //check('phones')
    //.notEmpty().withMessage('Al menos un teléfono es obligatorio'),

    validarCampos,
  ],
  crearPaciente,
);

//POST
//! Listar últimos 30 pacientes
router.get(
  "/latest",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimosPacientes,
);

router.get(
  "/latestCotizacion",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimosPacientesCotizacion,
);

//GET
//! Buscar paciente
router.get(
  "/findTerm",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTermino,
);

//GET
//! Buscar paciente
router.get(
  "/findTermById",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTerminoporId,
);

router.get(
  "/findTermCotizacion",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTerminoCotizaicon,
);

//PUT
//! Actualizar Paciente
router.put("/updatePatient", [validarJWT], actualizarPaciente);
router.get("/historialCambios/:id", [validarJWT], obtenerHistorialCambiosPaciente);

// ====== Datos complementarios del paciente desde programación empresarial ======
router.patch(
  "/datosComplementarios/:id",
  [validarJWT],
  actualizarDatosComplementarios,
);

module.exports = router;
