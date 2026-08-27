const { Schema, model } = require("mongoose");

const ArchivoPacienteSchema = Schema(
  {
    pacienteId: {
      type: Schema.Types.ObjectId,
      ref: "pacientesCollection",
      required: true,
      index: true,
    },

    tipoArchivo: {
      type: String,
      required: true,
      enum: [
        "FOTO_PERFIL",
        "DOCUMENTO_IDENTIDAD_ANVERSO",
        "DOCUMENTO_IDENTIDAD_REVERSO",
        "SOLICITUD_MEDICA",
      ],
    },

    origenArchivo: {
      type: String,
      required: true,
      enum: ["CAMARA", "ARCHIVO_SUBIDO"],
    },

    // ==========================================
    // ALMACENAMIENTO
    // ==========================================

    storageProvider: {
      type: String,
      enum: ["AWS_S3"],
      default: "AWS_S3",
      required: true,
    },

    storageBucket: {
      type: String,
      required: true,
    },

    storageKey: {
      type: String,
      required: true,
      unique: true,
    },

    storageVersionId: {
      type: String,
    },

    etag: {
      type: String,
    },

    // ==========================================
    // DATOS DEL ARCHIVO
    // ==========================================

    mimeType: {
      type: String,
      required: true,
      enum: ["image/jpeg", "image/png", "image/webp"],
    },

    tamanioBytes: {
      type: Number,
      required: true,
      min: 1,
    },

    // ==========================================
    // CONTROL DEL ARCHIVO
    // ==========================================

    estadoArchivo: {
      type: String,
      enum: ["ACTIVO", "REEMPLAZADO", "ELIMINADO"],
      default: "ACTIVO",
      required: true,
    },

    fechaCaptura: {
      type: Date,
      default: Date.now,
    },

    // Si la foto/documento se registró durante
    // una programación empresarial
    programacionEmpresaId: {
      type: Schema.Types.ObjectId,
      ref: "programacionPacienteEmpresaCollection",
      required: false,
    },

    // ==========================================
    // AUDITORÍA
    // ==========================================

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Usuario",
      required: false,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Usuario",
      required: false,
    },
  },
  {
    timestamps: true,
    collection: "archivoPacienteCollection",
  },
);

// Para obtener rápidamente el archivo activo
// de determinado tipo de un paciente
ArchivoPacienteSchema.index({
  pacienteId: 1,
  tipoArchivo: 1,
  estadoArchivo: 1,
});

module.exports = model("ArchivoPaciente", ArchivoPacienteSchema);
