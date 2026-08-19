const { Router } = require("express");
const { check } = require("express-validator");
const {
  crearProgramacion,
  listarProgramaciones,
  obtenerProgramacion,
  actualizarProgramacion,
  actualizarEstadoProgramacion,
} = require("../../controllers/Gestion/programacionPacienteEmpresaController");
const { validarCampos } = require("../../middlewares/validar-campo");
const { validarJWT } = require("../../middlewares/validar-token");

const router = Router();

const validarProgramacion = [
  check("empresaId", "El ID de empresa es obligatorio").isMongoId(),
  check("rucEmpresa", "El RUC de empresa es obligatorio").trim().notEmpty(),
  check("razonSocialEmpresa", "La razón social es obligatoria").trim().notEmpty(),
  check("tipoDoc", "El tipo de documento no es válido").isIn(["DNI", "CE", "PASAPORTE"]),
  check("nroDoc", "El número de documento es obligatorio").trim().notEmpty(),
  check("nombreCliente", "El nombre del paciente es obligatorio").trim().notEmpty(),
  check("apePatCliente", "El apellido paterno es obligatorio").trim().notEmpty(),
  check("protocoloId", "El ID de protocolo es obligatorio").trim().notEmpty(),
  check("codProtocolo", "El código de protocolo es obligatorio").trim().notEmpty(),
  check("nombreProtocolo", "El nombre de protocolo es obligatorio").trim().notEmpty(),
  check("serviciosProgramados", "Debe incluir al menos un servicio").isArray({ min: 1 }),
  check("fechaProgramada", "La fecha programada no es válida").isISO8601(),
  validarCampos,
];

router.post("/", [validarJWT, ...validarProgramacion], crearProgramacion);
router.get("/", validarJWT, listarProgramaciones);
router.get("/:id", [validarJWT, check("id", "ID inválido").isMongoId(), validarCampos], obtenerProgramacion);
router.put("/:id", [validarJWT, check("id", "ID inválido").isMongoId(), validarCampos], actualizarProgramacion);
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

module.exports = router;