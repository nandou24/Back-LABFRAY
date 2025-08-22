const { Router } = require("express");
const { check } = require("express-validator");

const {
  crearCotizacionEmpresa,
  mostrarUltimasCotizacionesEmpresa,
  encontrarTerminoEmpresa,
  crearNuevaVersionCotiEmpresa,
  mostrarUltimasCotizacionesEmpresaPorPagar,
  mostrarUltimasCotizacionesEmpresaPagadas,
  obtenerCotizacionEmpresaPorCodigo,
} = require("../../controllers/Gestion/cotizacionEmpresaController");

const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// Crear nueva cotización empresarial
router.post(
  "/",
  [
    validarJWT,
    check("historial", "El historial es obligatorio").not().isEmpty(),
    check("historial.0.empresaId", "El ID de la empresa es obligatorio")
      .not()
      .isEmpty(),
    check("historial.0.ruc", "El RUC es obligatorio").not().isEmpty(),
    check("historial.0.razonSocial", "La razón social es obligatoria")
      .not()
      .isEmpty(),
    check("historial.0.formaPago", "La forma de pago es obligatoria")
      .not()
      .isEmpty(),
    check(
      "historial.0.serviciosCotizacion",
      "Los servicios de cotización son obligatorios"
    ).isArray({ min: 1 }),
    validarCampos,
  ],
  crearCotizacionEmpresa
);

// Mostrar últimas cotizaciones empresariales (últimos 7 días)
router.get("/ultimas", validarJWT, mostrarUltimasCotizacionesEmpresa);

// Mostrar cotizaciones empresariales por pagar
router.get("/por-pagar", validarJWT, mostrarUltimasCotizacionesEmpresaPorPagar);

// Mostrar cotizaciones empresariales pagadas
router.get("/pagadas", validarJWT, mostrarUltimasCotizacionesEmpresaPagadas);

// Buscar cotizaciones empresariales por término
router.get("/buscar", validarJWT, encontrarTerminoEmpresa);

// Obtener cotización empresarial por código
router.get("/:codCotizacion", validarJWT, obtenerCotizacionEmpresaPorCodigo);

// Crear nueva versión de cotización empresarial
router.put(
  "/nueva-version",
  [
    validarJWT,
    check("codCotizacion", "El código de cotización es obligatorio")
      .not()
      .isEmpty(),
    check("historial", "El historial es obligatorio").not().isEmpty(),
    check("historial.0.empresaId", "El ID de la empresa es obligatorio")
      .not()
      .isEmpty(),
    check("historial.0.ruc", "El RUC es obligatorio").not().isEmpty(),
    check("historial.0.razonSocial", "La razón social es obligatoria")
      .not()
      .isEmpty(),
    validarCampos,
  ],
  crearNuevaVersionCotiEmpresa
);

module.exports = router;
