const { Router } = require("express");
const { body, param } = require("express-validator");

const {
  crearServicio,
  mostrarUltimosServicios,
  encontrarTermino,
  encontrarTipoExamen,
  actualizarServicio,
  mostrarServiciosFavoritos,
  obtenerServiciosExpandidos,
  obtenerItemsLaboratorioPorServicio,
  mostrarServiciosFavoritosEmpresa,
} = require("../../controllers/Mantenimiento/servicioController");

const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

// ====== Tipos permitidos ======

const TIPOS_SERVICIO = [
  "Laboratorio",
  "Ecografía",
  "Rayos X",
  "Consulta",
  "Procedimiento",
];

const TIPOS_EXAMEN = [
  "LABORATORIO",
  "ECOGRAFIA",
  "RAYOS_X",
  "CONSULTA",
  "PROCEDIMIENTO",
];

const MODALIDADES_INSTANCIAS = [
  "UNICA",
  "MUESTRAS_INDEPENDIENTES",
  "REPETICIONES_MISMA_MUESTRA",
];

// ====== Validaciones servicio ======

const validacionesServicio = () => [
  body("claseServicio")
    .notEmpty()
    .withMessage("Clase de servicio es obligatoria")
    .isIn(["INDIVIDUAL", "PAQUETE"])
    .withMessage("Clase de servicio no válida"),

  body("tipoServicio").custom((value, { req }) => {
    if (req.body.claseServicio === "PAQUETE") {
      return true;
    }

    if (!value) {
      throw new Error("Tipo de servicio es obligatorio");
    }

    if (!TIPOS_SERVICIO.includes(value)) {
      throw new Error("Tipo de servicio no válido");
    }

    return true;
  }),

  body("nombreServicio")
    .trim()
    .notEmpty()
    .withMessage("Nombre de servicio es obligatorio"),

  body("precioServicio")
    .exists({ checkNull: true })
    .withMessage("Precio de servicio es obligatorio")
    .bail()
    .isFloat({ min: 0 })
    .withMessage("Precio de servicio no válido"),

  body("estadoServicio")
    .exists({ checkNull: true })
    .withMessage("Estado del servicio es obligatorio")
    .bail()
    .isBoolean()
    .withMessage("Estado del servicio debe ser booleano"),

  body("favoritoServicio")
    .optional()
    .isBoolean()
    .withMessage("Favorito debe ser booleano"),

  body("favoritoServicioEmpresa")
    .optional()
    .isBoolean()
    .withMessage("Favorito empresa debe ser booleano"),

  body("requiereSeleccionProfesional")
    .optional()
    .isBoolean()
    .withMessage("Requiere selección profesional debe ser booleano"),

  // ====== Profesiones ======

  body("profesionesAsociadas")
    .optional()
    .isArray()
    .withMessage("Profesiones asociadas debe ser un arreglo"),

  body("profesionesAsociadas.*.profesionId")
    .isMongoId()
    .withMessage("Profesión asociada no válida"),

  body("profesionesAsociadas.*.especialidadId")
    .optional({ nullable: true })
    .isMongoId()
    .withMessage("Especialidad asociada no válida"),

  // ====== Componentes clínicos ======

  body("examenesServicio")
    .optional()
    .isArray()
    .withMessage("Componentes clínicos debe ser un arreglo"),

  body("examenesServicio.*.tipoExamen")
    .optional({ nullable: true })
    .isIn(TIPOS_EXAMEN)
    .withMessage("Tipo de componente clínico no válido"),

  body("examenesServicio.*.referenciaId")
    .optional({ nullable: true })
    .isMongoId()
    .withMessage("Referencia clínica no válida"),

  body("examenesServicio.*.codExamen")
    .trim()
    .notEmpty()
    .withMessage("Código del componente es obligatorio"),

  body("examenesServicio.*.nombreExamen")
    .trim()
    .notEmpty()
    .withMessage("Nombre del componente es obligatorio"),

  body("examenesServicio.*.numeroInstancias")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Número de instancias no válido"),

  body("examenesServicio.*.modalidadInstancias")
    .optional()
    .isIn(MODALIDADES_INSTANCIAS)
    .withMessage("Modalidad de instancias no válida"),

  body("examenesServicio.*.etiquetasInstancias")
    .optional()
    .isArray()
    .withMessage("Etiquetas de instancias debe ser un arreglo"),

  // ====== Paquetes ======

  body("serviciosIncluidos")
    .optional()
    .isArray()
    .withMessage("Servicios incluidos debe ser un arreglo"),

  body("serviciosIncluidos.*.servicioId")
    .isMongoId()
    .withMessage("Servicio incluido no válido"),

  body("serviciosIncluidos.*.cantidad")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Cantidad del servicio incluido no válida"),
];

// ====== Crear servicio ======

router.post(
  "/newServicio",
  [validarJWT, ...validacionesServicio(), validarCampos],
  crearServicio,
);

// ====== Listar servicios ======

router.get("/latest", mostrarUltimosServicios);

router.get("/latestFavorites", mostrarServiciosFavoritos);

router.get("/latestFavoritesEmpresa", mostrarServiciosFavoritosEmpresa);

// ====== Buscar servicio ======

router.get("/findTerm", encontrarTermino);

// ====== Buscar componentes clínicos ======

router.get("/tipoExamen", encontrarTipoExamen);

// ====== Actualizar servicio ======

router.put(
  "/:codServicio/updateServicio",
  [
    validarJWT,

    param("codServicio")
      .trim()
      .notEmpty()
      .withMessage("Código de servicio es obligatorio"),

    ...validacionesServicio(),

    validarCampos,
  ],
  actualizarServicio,
);

// ====== Expandir servicios ======

router.get("/expandir", obtenerServiciosExpandidos);

// ====== Obtener pruebas laboratorio por servicios ======

router.get("/pruebaLab-items", obtenerItemsLaboratorioPorServicio);

module.exports = router;
