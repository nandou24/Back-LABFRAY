const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearRuta,
  actualizarRuta,
  eliminarRuta,
  listarRutas,
  buscarRuta,
} = require("../../controllers/Mantenimiento/rutaController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// Crear ruta
router.post(
  "/newRuta",
  [
    validarJWT,
    check("nombreRuta")
      .notEmpty()
      .withMessage("El nombre de la ruta es obligatorio"),
    check("urlRuta").notEmpty().withMessage("La URL de la ruta es obligatoria"),
    check("estado").notEmpty().withMessage("El estado es obligatorio"),
    validarCampos,
  ],
  crearRuta
);

// Actualizar ruta
router.put("/:codRuta", [validarJWT], actualizarRuta);

// Eliminar ruta
router.delete("/:codRuta", [validarJWT], eliminarRuta);

// Listar rutas
router.get("/latest", listarRutas);

// Buscar rutas
router.get("/findTerm", buscarRuta);

module.exports = router;
