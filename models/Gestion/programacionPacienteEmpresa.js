const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const ServicioProgramadoSchema = new Schema(
	{
		servicioId: { type: Schema.Types.ObjectId, ref: "servicioCollection", required: true },
		codServicio: { type: String, required: true, trim: true },
		nombreServicio: { type: String, required: true, trim: true },
	},
	{ _id: false },
);

const PendienteProgramacionSchema = new Schema(
	{
		tipo: {
			type: String,
			required: true,
			enum: ["MUESTRA", "EVALUACION", "DOCUMENTO", "OTRO"],
		},
		servicioId: { type: Schema.Types.ObjectId, ref: "servicioCollection" },
		codServicio: { type: String, trim: true },
		nombreServicio: { type: String, trim: true },
		descripcion: { type: String, required: true, trim: true },
		fechaRegistro: { type: Date, default: Date.now },
		fechaResolucion: { type: Date, default: null },
		resuelto: { type: Boolean, default: false },
	},
	{ _id: false },
);

const ProgramacionPacienteEmpresaSchema = new Schema(
	{
		codProgramacion: { type: String, required: true, unique: true, trim: true },
		empresaId: {
			type: Schema.Types.ObjectId,
			ref: "empresasCollection",
			required: true,
		},
		rucEmpresa: { type: String, required: true, trim: true },
		razonSocialEmpresa: { type: String, required: true, trim: true },
		nombreComercialEmpresa: { type: String, trim: true },
		tipoDoc: { type: String, required: true, enum: ["DNI", "CE", "PASAPORTE"] },
		nroDoc: { type: String, required: true, trim: true },
		nombreCliente: {
			type: String,
			required: true,
			trim: true,
			set: (value) => value.toUpperCase(),
		},
		apePatCliente: {
			type: String,
			required: true,
			trim: true,
			set: (value) => value.toUpperCase(),
		},
		apeMatCliente: { type: String, trim: true, set: (value) => value.toUpperCase() },
		puesto: { type: String, trim: true },
		area: { type: String, trim: true },
		pacienteId: { type: Schema.Types.ObjectId, ref: "pacientesCollection", default: null },
		hc: { type: String, default: null, trim: true },
		protocoloId: { type: Schema.Types.ObjectId, required: true },
		codProtocolo: { type: String, required: true, trim: true },
		nombreProtocolo: { type: String, required: true, trim: true },
		serviciosProgramados: { type: [ServicioProgramadoSchema], required: true },
		fechaProgramada: { type: Date, required: true },
		turno: { type: String, enum: ["MAÑANA", "TARDE", "NOCHE"] },
		horaProgramada: { type: String, trim: true },
		estadoProgramacion: {
			type: String,
			required: true,
			default: "PROGRAMADO",
			enum: [
				"PROGRAMADO",
				"EN ATENCION",
				"PENDIENTE DE COMPLETAR",
				"ATENDIDO",
				"NO ASISTIO",
				"CANCELADO",
			],
		},
		pendientes: { type: [PendienteProgramacionSchema], default: [] },
		fechaInicioAtencion: { type: Date, default: null },
		fechaUltimaAtencion: { type: Date, default: null },
		fechaFinalizacion: { type: Date, default: null },
		observaciones: { type: String, trim: true },
		origenRegistro: {
			type: String,
			enum: ["MANUAL", "IMPORTACION_EXCEL"],
			default: "MANUAL",
		},
		createdBy: { type: String, required: true },
		usuarioRegistro: { type: String },
		updatedBy: { type: String },
		usuarioActualizacion: { type: String },
		fechaActualizacion: { type: Date },
	},
	{ timestamps: true },
);

// ProgramacionPacienteEmpresaSchema.index({ empresaId: 1, fechaProgramada: 1 });
// ProgramacionPacienteEmpresaSchema.index({ nroDoc: 1, fechaProgramada: 1 });
// ProgramacionPacienteEmpresaSchema.index({ estadoProgramacion: 1, fechaProgramada: 1 });

module.exports = mongoose.model(
	"programacionPacienteEmpresaCollection",
	ProgramacionPacienteEmpresaSchema,
);
