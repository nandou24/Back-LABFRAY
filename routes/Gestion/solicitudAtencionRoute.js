const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearSolicitud,
  obtenerPorRangoFechas,
} = require("../../controllers/Gestion/solicitudAtencionController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// Crear rol
router.post(
  "/newSolicitud",
  [
    validarJWT,
    check("cotizacionId")
      .notEmpty()
      .withMessage("El id de cotización obligatorio"),
    check("tipo").notEmpty().withMessage("El tipo de servicio es obligatorio"),
    check("servicios").notEmpty().withMessage("Debe incluir servicios"),
    check("hc").notEmpty().withMessage("La HC es obligatorio"),
    check("tipoDocumento")
      .notEmpty()
      .withMessage("El tipo de documento es obligatorio"),
    check("nroDocumento")
      .notEmpty()
      .withMessage("El número de documento es obligatorio"),
    check("nombreCompleto")
      .notEmpty()
      .withMessage("El nombre del paciente es obligatorio"),
    check("codUsuarioEmisor")
      .notEmpty()
      .withMessage("El codigo del usuario emisor es obligatorio"),
    check("usuarioEmisor")
      .notEmpty()
      .withMessage("El nombre del usuario emirsor es obligatorio"),
    check("estado")
      .notEmpty()
      .withMessage("El estado de la solicitud es obligatorio"),
    validarCampos,
  ],
  crearSolicitud
);

// // Actualizar rol
// router.put("/:codRol", actualizarRol);

// // Eliminar rol
// router.delete("/:codRol", eliminarRol);

// Buscar roles
router.get("/findByRangoFechas", obtenerPorRangoFechas);

module.exports = router;
