const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearProgramacion,
  listarProgramaciones,
  obtenerProgramacion,
  actualizarProgramacion,
  actualizarEstadoProgramacion,
  iniciarAtencionProgramacion,
  regularizarDocumentoProgramacion,
} = require("../../controllers/Gestion/programacionPacienteEmpresaController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");
const { validarImportacionProgramaciones } = require("../../controllers/Gestion/validacionMasivaProgramacionController");
const { registrarImportacionProgramaciones } = require("../../controllers/Gestion/registroMasivoProgramacionController");

const router = Router();

const validarProgramacion = [
  check("empresaId", "El ID de empresa es obligatorio").isMongoId(),
  check("rucEmpresa", "El RUC de empresa es obligatorio").trim().notEmpty(),
  check("razonSocialEmpresa", "La razón social es obligatoria")
    .trim()
    .notEmpty(),
  check("tipoDoc", "El tipo de documento no es válido")
    .optional({ nullable: true })
    .isIn(["DNI", "CE", "PASAPORTE"]),
  check("nroDoc").optional({ nullable: true }).custom((numero, { req }) => {
    const documento = String(numero ?? "").trim();
    if (!documento) return true;
    const tipo = req.body.tipoDoc;
    const formato = {
      DNI: /^\d{8}$/,
      CE: /^[A-Za-z0-9]{1,13}$/,
      PASAPORTE: /^[A-Za-z0-9]{1,16}$/,
    };
    if (!formato[tipo]?.test(documento)) {
      throw new Error("El número no corresponde al tipo de documento seleccionado");
    }
    return true;
  }),
  check("nombreCliente", "El nombre del paciente es obligatorio")
    .trim()
    .notEmpty(),
  check("apePatCliente", "El apellido paterno es obligatorio")
    .trim()
    .notEmpty(),
  check("protocoloId", "El ID de protocolo es obligatorio").trim().notEmpty(),
  check("codProtocolo", "El código de protocolo es obligatorio")
    .trim()
    .notEmpty(),
  check("nombreProtocolo", "El nombre de protocolo es obligatorio")
    .trim()
    .notEmpty(),
  check("serviciosProgramados", "Debe incluir al menos un servicio").isArray({
    min: 1,
  }),
  check("fechaProgramada", "La fecha programada no es válida").isISO8601(),
  check("sede", "La sede no es válida")
    .optional()
    .isIn(["Callao", "Comas", "NoIndica"]),
  check("tipoEvaluacion", "El tipo de evaluación no es válido")
    .optional()
    .isIn([
      "ETAs",
      "Ocupacional",
      "PreOcupacional",
      "Retiro",
      "Toxicológico",
      "Otro",
    ]),
  check("tipoAtencion", "El tipo de atención no es válido")
    .optional()
    .isIn(["Regular", "Preferencial", "VIP"]),
  check("prioridad", "La prioridad no es válida")
    .optional()
    .isIn(["Normal", "Alta"]),
  validarCampos,
];

// ====== Validar importación masiva sin guardar ======
router.post(
  "/validar-importacion",
  [
    validarJWT,
    check("filas", "Se requieren entre 1 y 1,000 filas").isArray({ min: 1, max: 1000 }),
    validarCampos,
  ],
  validarImportacionProgramaciones,
);

// ====== Registrar lote validado, con transacción e idempotencia ======
router.post(
  '/registrar-importacion',
  [validarJWT, check('filas').isArray({ min: 1, max: 100 }), validarCampos],
  registrarImportacionProgramaciones,
);

router.post("/", [validarJWT, ...validarProgramacion], crearProgramacion);
router.get("/", validarJWT, listarProgramaciones);
router.get(
  "/:id",
  [validarJWT, check("id", "ID inválido").isMongoId(), validarCampos],
  obtenerProgramacion,
);
router.put(
  "/:id",
  [
    validarJWT,
    check("id", "ID inválido").isMongoId(),
    check("tipoDoc", "El tipo de documento no es válido")
      .optional({ nullable: true })
      .isIn(["DNI", "CE", "PASAPORTE"]),
    check("nroDoc").optional({ nullable: true }).custom((numero, { req }) => {
      const documento = String(numero ?? "").trim();
      if (!documento) return true;
      const formato = {
        DNI: /^\d{8}$/,
        CE: /^[A-Za-z0-9]{1,13}$/,
        PASAPORTE: /^[A-Za-z0-9]{1,16}$/,
      };
      if (!formato[req.body.tipoDoc]?.test(documento)) {
        throw new Error("Documento inválido para el tipo seleccionado");
      }
      return true;
    }),
    check("sede", "La sede no es válida")
      .optional()
      .isIn(["Callao", "Comas", "NoIndica"]),
    check("tipoEvaluacion", "El tipo de evaluación no es válido")
      .optional()
      .isIn([
        "ETAs",
        "Ocupacional",
        "PreOcupacional",
        "Retiro",
        "Toxicológico",
        "Otro",
      ]),
    check("tipoAtencion", "El tipo de atención no es válido")
      .optional()
      .isIn(["Regular", "Preferencial", "VIP"]),
    check("prioridad", "La prioridad no es válida")
      .optional()
      .isIn(["Normal", "Alta"]),
    validarCampos,
  ],
  actualizarProgramacion,
);
router.put(
  "/:id/estado",
  [
    validarJWT,
    check("id", "ID inválido").isMongoId(),
    check("estadoProgramacion", "El estado de programación no es válido").isIn([
      "PROGRAMADO",
      "EN ATENCION",
      "PENDIENTE DE COMPLETAR",
      "ATENDIDO",
      "NO ASISTIO",
      "CANCELADO",
    ]),
    validarCampos,
  ],
  actualizarEstadoProgramacion,
);
// ==========================================
// INICIAR ATENCIÓN
// ==========================================

router.post(
  "/:id/iniciar-atencion",
  [validarJWT, check("id", "ID inválido").isMongoId(), validarCampos],
  iniciarAtencionProgramacion,
);

// ====== Regularizar documento de paciente vinculado ======
router.put(
  '/:id/regularizar-documento',
  [
    validarJWT,
    check('id', 'ID inválido').isMongoId(),
    check('tipoDoc', 'Tipo de documento inválido').isIn(['DNI', 'CE', 'PASAPORTE']),
    check('nroDoc', 'Número de documento obligatorio').isString().notEmpty(),
    check('motivo', 'Indique el motivo (mínimo 10 caracteres)').isString().trim().isLength({ min: 10 }),
    validarCampos,
  ],
  regularizarDocumentoProgramacion,
);

module.exports = router;
