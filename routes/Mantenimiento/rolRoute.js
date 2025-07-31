const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearRol,
  actualizarRol,
  eliminarRol,
  listarRoles,
  buscarRol,
} = require("../../controllers/Mantenimiento/rolController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// Crear rol
router.post(
  "/newRol",
  [
    validarJWT,
    check("nombreRol")
      .notEmpty()
      .withMessage("El nombre del rol es obligatorio"),
    check("estado").notEmpty().withMessage("El estado es obligatorio"),
    validarCampos,
  ],
  crearRol
);

// Actualizar rol
router.put("/:codRol", [validarJWT], actualizarRol);

// Eliminar rol
router.delete("/:codRol", [validarJWT], eliminarRol);

// Listar roles
router.get("/latest", listarRoles);

// Buscar roles
router.get("/findTerm", buscarRol);

module.exports = router;
