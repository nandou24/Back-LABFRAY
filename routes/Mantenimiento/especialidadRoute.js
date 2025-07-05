const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearEspecialidad,
  actualizarEspecialidad,
  eliminarEspecialidad,
  listarEspecialida,
  buscarEspecialidad,
} = require("../../controllers/Mantenimiento/especialidadController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

router.post(
  "/newEspecialidad",
  [
    //validarJWT,

    check("nombreEspecialidad")
      .notEmpty()
      .withMessage("El nombre de la especialidad es obligatorio"),

    validarCampos,
  ],
  crearEspecialidad
);

// Actualizar ruta
router.put("/:codEspecialidad", actualizarEspecialidad);

// Eliminar ruta
router.delete("/:codEspecialidad", eliminarEspecialidad);

// Listar rutas
router.get("/latest", listarEspecialida);

// Buscar rutas
router.get("/findTerm", buscarEspecialidad);

module.exports = router;
