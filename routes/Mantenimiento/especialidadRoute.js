const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearEspecialidad,
  actualizarEspecialidad,
  eliminarEspecialidad,
  listarEspecialidades,
  buscarEspecialidad,
  listarEspecialidadesPorProfesion,
} = require("../../controllers/Mantenimiento/especialidadController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//especialidades
const router = Router();

router.post(
  "/newEspecialidad",
  [
    //validarJWT,

    check("nombreEspecialidad")
      .notEmpty()
      .withMessage("El nombre de la especialidad es obligatorio"),

    check("codProfesion").notEmpty(),

    validarCampos,
  ],
  crearEspecialidad
);

// Actualizar especialidades
router.put("/:codEspecialidad", actualizarEspecialidad);

// Eliminar especialidades
router.delete("/:codEspecialidad", eliminarEspecialidad);

// Listar especialidades
router.get("/latest", listarEspecialidades);

// Buscar especialidades
router.get("/findTerm", buscarEspecialidad);

router.get("/profesion/:id", listarEspecialidadesPorProfesion);

module.exports = router;
