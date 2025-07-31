const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearCotizacion,
  mostrarUltimasCotizaciones,
  encontrarTermino,
  mostrarUltimasCotizacionesPorPagar,
  crearNuevaVersionCotiPersona,
  mostrarUltimasCotizacionesPagadas,
  verificarHcRegistrada,
} = require("../../controllers/Gestion/cotizacionController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

//Rutas
const router = Router();

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nueva cotizacion
router.post("/newCotizacionPersona", [validarJWT], crearCotizacion);

//! crear un nuevo version
router.post(
  "/newVersionCotizacionPersona",
  [validarJWT],
  crearNuevaVersionCotiPersona
);

//POST
//! Listar últimas cotizaciones
router.get("/latest", mostrarUltimasCotizaciones);

//! Listar últimas cotizaciones por pagar
router.get("/latestPorPagar", mostrarUltimasCotizacionesPorPagar);

//! Listar últimas cotizaciones pagadas
router.get("/latestPagadas", mostrarUltimasCotizacionesPagadas);

//! Buscar servicio
router.get("/findTerm", encontrarTermino);

//GET
router.get("/findHC", verificarHcRegistrada);

module.exports = router;
