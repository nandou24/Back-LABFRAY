const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearProfesion,
  actualizarProfesion,
  eliminarProfesion,
  listarProfesion,
  buscarProfesion,
} = require("../../controllers/Mantenimiento/profesionController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

router.post(
  "/newProfesion",
  [
    validarJWT,

    check("nombreProfesion")
      .notEmpty()
      .withMessage("El nombre de la profesión es obligatorio"),

    validarCampos,
  ],
  crearProfesion
);

// Actualizar ruta
router.put("/:codProfesion", [validarJWT], actualizarProfesion);

// Eliminar ruta
router.delete("/:codProfesion", [validarJWT], eliminarProfesion);

// Listar rutas
router.get("/latest", listarProfesion);

// Buscar rutas
router.get("/findTerm", buscarProfesion);

module.exports = router;
