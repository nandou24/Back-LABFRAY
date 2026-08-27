const { response } = require("express");
const mongoose = require("mongoose");
const Paciente = require("../../models/Mantenimiento/Paciente");
const ArchivoPaciente = require("../../models/Mantenimiento/ArchivoPaciente");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");
const { subirArchivo, eliminarArchivo } = require("../../utils/aws/s3Storage");

// ==========================================
// SUBIR FOTO DE PERFIL DEL PACIENTE
// ==========================================

const subirFotoPerfilPaciente = async (req, res = response) => {
  let archivoSubidoS3 = null;
  let session = null;
  let mongoConfirmado = false;

  try {
    const { pacienteId } = req.params;
    const { programacionEmpresaId } = req.body;
    const { uid } = req.user;

    // ==========================================
    // 1. VALIDAR PACIENTE ID
    // ==========================================

    if (!mongoose.Types.ObjectId.isValid(pacienteId)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID del paciente no es válido",
      });
    }

    // ==========================================
    // 2. VALIDAR ARCHIVO
    // ==========================================

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        msg: "Debe enviar una fotografía",
      });
    }

    // ==========================================
    // 3. VERIFICAR EXISTENCIA DEL PACIENTE
    // ==========================================

    const paciente = await Paciente.findById(pacienteId).select("_id").lean();

    if (!paciente) {
      return res.status(404).json({
        ok: false,
        msg: "Paciente no encontrado",
      });
    }

    // ==========================================
    // 4. VALIDAR PROGRAMACIÓN SI FUE ENVIADA
    // ==========================================

    if (programacionEmpresaId) {
      if (!mongoose.Types.ObjectId.isValid(programacionEmpresaId)) {
        return res.status(400).json({
          ok: false,
          msg: "El ID de programación no es válido",
        });
      }

      const programacion = await ProgramacionPacienteEmpresa.findById(
        programacionEmpresaId,
      )
        .select("_id pacienteId")
        .lean();

      if (!programacion) {
        return res.status(404).json({
          ok: false,
          msg: "Programación empresarial no encontrada",
        });
      }

      // Si la programación ya tiene pacienteId,
      // debe corresponder al paciente enviado.

      if (
        programacion.pacienteId &&
        programacion.pacienteId.toString() !== pacienteId
      ) {
        return res.status(409).json({
          ok: false,
          msg: "La programación no corresponde al paciente indicado",
        });
      }
    }

    // ==========================================
    // 5. SUBIR ARCHIVO A AMAZON S3
    // ==========================================

    archivoSubidoS3 = await subirArchivo({
      pacienteId,
      categoriaStorage: "perfil",
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    // ==========================================
    // 6. INICIAR TRANSACCIÓN MONGO
    // ==========================================

    session = await mongoose.startSession();

    session.startTransaction();

    // ==========================================
    // 7. REEMPLAZAR FOTO ACTIVA ANTERIOR
    // ==========================================

    await ArchivoPaciente.updateMany(
      {
        pacienteId,
        tipoArchivo: "FOTO_PERFIL",
        estadoArchivo: "ACTIVO",
      },
      {
        $set: {
          estadoArchivo: "REEMPLAZADO",
          updatedBy: uid,
        },
      },
      {
        session,
      },
    );

    // ==========================================
    // 8. CREAR REGISTRO DE NUEVA FOTO
    // ==========================================

    const nuevaFoto = new ArchivoPaciente({
      pacienteId,
      tipoArchivo: "FOTO_PERFIL",
      origenArchivo: "CAMARA",
      storageProvider: "AWS_S3",
      storageBucket: process.env.AWS_S3_BUCKET,
      storageKey: archivoSubidoS3.key,
      storageVersionId: archivoSubidoS3.versionId,
      etag: archivoSubidoS3.etag,
      mimeType: req.file.mimetype,
      tamanioBytes: req.file.size,
      estadoArchivo: "ACTIVO",
      programacionEmpresaId: programacionEmpresaId || undefined,
      createdBy: uid,
    });

    await nuevaFoto.save({
      session,
    });

    // ==========================================
    // 9. CONFIRMAR TRANSACCIÓN
    // ==========================================

    await session.commitTransaction();

    mongoConfirmado = true;

    // ==========================================
    // 10. RESPUESTA
    // ==========================================

    return res.status(201).json({
      ok: true,

      msg: "Fotografía del paciente registrada correctamente",

      archivo: {
        _id: nuevaFoto._id,
        tipoArchivo: nuevaFoto.tipoArchivo,
        mimeType: nuevaFoto.mimeType,
        tamanioBytes: nuevaFoto.tamanioBytes,
        fechaCaptura: nuevaFoto.fechaCaptura,
      },
    });
  } catch (error) {
    // ==========================================
    // ABORTAR TRANSACCIÓN MONGO
    // ==========================================

    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }

    // ==========================================
    // ROLLBACK DEL ARCHIVO EN S3
    // ==========================================

    if (archivoSubidoS3 && !mongoConfirmado) {
      try {
        await eliminarArchivo(archivoSubidoS3.key, archivoSubidoS3.versionId);

        console.log("Rollback S3 realizado correctamente");
      } catch (errorS3) {
        console.error("Error al realizar rollback del archivo en S3:", errorS3);
      }
    }

    console.error("Error al registrar fotografía del paciente:", error);

    return res.status(500).json({
      ok: false,

      msg: "Error al registrar la fotografía del paciente",
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

module.exports = {
  subirFotoPerfilPaciente,
};
