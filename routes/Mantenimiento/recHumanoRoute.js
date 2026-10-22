const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearRecursoHumano,
  mostrarUltimosRecurHumanos,
  encontrarTermino,
  actualizarRecursoHumano,
  obtenerSolicitantes,
  obtenerProfesionalesConsultas,
  obtenerProfesionalesQueAtiendenConsultas,
  obtenerFirmantesLaboratorio,
  obtenerCandidatosFirmantesLaboratorio,
  configurarFirmanteLaboratorio,
  guardarImagenFirmaLaboratorio,
  verImagenFirmaLaboratorio,
} = require("../../controllers/Mantenimiento/recursoHumanoController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");
const { validarPermisoAccion } = require("../../middlewares/validar-permiso-accion");
const { PERMISOS_ACCION } = require("../../utils/permisosAccion");
const multer = require("multer");
const subirFirma = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024, files: 1 } });

//Rutas
const router = Router();

// ====== Consultar y configurar firmantes de laboratorio ======
router.get(
  "/firmantes-laboratorio/candidatos",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_GESTIONAR_FIRMANTES),
  obtenerCandidatosFirmantesLaboratorio,
);
router.get("/firmantes-laboratorio", validarJWT, obtenerFirmantesLaboratorio);
router.put(
  "/firmantes-laboratorio/:codRecHumano",
  validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_GESTIONAR_FIRMANTES),
  configurarFirmanteLaboratorio,
);

// ====== Firma PNG protegida ======
router.put("/firmantes-laboratorio/:codRecHumano/imagen", validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_GESTIONAR_FIRMANTES),
  subirFirma.single("firma"), guardarImagenFirmaLaboratorio);
router.get("/firmantes-laboratorio/:codRecHumano/imagen", validarJWT,
  validarPermisoAccion(PERMISOS_ACCION.RESULTADOS_GESTIONAR_FIRMANTES),
  verImagenFirmaLaboratorio);

//POST
//controlador de esa ruta
//!Estructura: URL --> VALIDACIONES --> CONTROLADOR --> RESPUESTA

//! crear un nuevo favorito
router.post(
  "/newRecHumano",
  [
    validarJWT,

    check("tipoDoc").notEmpty().withMessage("Tipo documento es obligatorio"),

    check("nroDoc").notEmpty().withMessage("Número de doc es obligatorio"),

    check("nombreRecHumano").notEmpty().withMessage("Nombre es obligatorio"),

    check("apePatRecHumano")
      .notEmpty()
      .withMessage("Apellido Paterno es obligatorio"),

    check("fechaNacimiento")
      .notEmpty()
      .withMessage("Fecha de nacimiento es obligatorio"),

    check("sexoRecHumano").notEmpty().withMessage("Sexo es obligatorio"),

    check("departamentoRecHumano")
      .notEmpty()
      .withMessage("Departamento es obligatorio"),

    check("provinciaRecHumano")
      .notEmpty()
      .withMessage("Provincia es obligatorio"),

    check("distritoRecHumano")
      .notEmpty()
      .withMessage("Distrito es obligatorio"),

    //check('phones')
    //.notEmpty().withMessage('Al menos un teléfono es obligatorio'),

    validarCampos,
  ],
  crearRecursoHumano
);

//POST
//! Listar últimos 30 recursos humanos
router.get(
  "/latest",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  mostrarUltimosRecurHumanos
);

//! Listar últimos solicitantes
router.get(
  "/latestSolicitantes",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  obtenerSolicitantes
);

//GET
//! Buscar recurso humano
router.get(
  "/findTerm",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  encontrarTermino
);

//GET
//! Buscar profesionales que atienden consultas
router.get(
  "/findPersonalSaludParaConsultas",
  [
    //check('token')
    //.notEmpty().withMessage('Es token es obligatorio'),
  ],
  obtenerProfesionalesConsultas
);

// ! Buscar profesionales que atienden consultas por término
router.get(
  "/traerProfesionalesQueAtiendenConsultas",
  obtenerProfesionalesQueAtiendenConsultas
);

//POST
//! Actualizar recurso humano
router.put(
  "/:codRecHumano/updateRecHumano",
  [validarJWT],
  actualizarRecursoHumano
);
//para exportar rutas
module.exports = router;
