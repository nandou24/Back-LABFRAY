const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearUsuario,
  loginUsuario,
  cambiarSede,
  consultarSedesSesion,
  cambiarPasswordObligatorio,
} = require("../controllers/auth");
const { validarCampos } = require("../middlewares/validar-campo");
const { validarJWT } = require("../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//! crear un nuevo usuario
//* /api/auth/new
router.post(
  "/newUser",
  [
    check("name")
      .notEmpty()
      .withMessage("El nombre es obligatorio")
      .isLength({ min: 1 })
      .withMessage("El name es mínimo de 6 caracteres"),

    check("email")
      .notEmpty()
      .withMessage("El email es obligatorio")
      .isEmail()
      .withMessage("Email ingresado no es valido"),

    check("password")
      .notEmpty()
      .withMessage("El password es obligatorio")
      .isLength({ min: 6 })
      .withMessage("El password es mínimo de 6 caracteres"),

    check("rol")
      .notEmpty()
      .withMessage("El rol es obligatorio")
      .isLength({ min: 1 })
      .withMessage("El rol es mínimo de 1 caracter"),

    validarCampos,
  ],
  crearUsuario
);

//POST
//! Login de usuario
//* /api/auth
router.post(
  "/login",
  [
    check("nombreUsuario").notEmpty().withMessage("El usuario es obligatorio"),

    check("password")
      .notEmpty()
      .withMessage("La contraseña es obligatoria")
      .isLength({ min: 6 })
      .withMessage("La contraseña es mínimo de 6 caracteres"),
    validarCampos,
  ],
  loginUsuario
);

// ====== Selección de contexto autenticada, sin volver a emitir JWT ======
router.post('/seleccionar-sede', validarJWT, cambiarSede);
router.post('/cambiar-sede', validarJWT, cambiarSede);
router.get('/sesion-sedes', validarJWT, consultarSedesSesion);

// ====== Solo se acepta token temporal de cambio de contraseña ======
router.post('/cambiar-password-obligatorio', [
  check('passwordActual').notEmpty(),
  check('passwordNueva').notEmpty(),
  validarCampos,
], cambiarPasswordObligatorio);

//para exportar rutas
module.exports = router;
