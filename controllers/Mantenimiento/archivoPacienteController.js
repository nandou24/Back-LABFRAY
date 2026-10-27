const { response } = require("express");
const mongoose = require("mongoose");
const Paciente = require("../../models/Mantenimiento/Paciente");
const ArchivoPaciente = require("../../models/Mantenimiento/ArchivoPaciente");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const FotoEvaluacionTemporal = require("../../models/Gestion/FotoEvaluacionTemporal");
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../../utils/aws/s3Client');
const { subirArchivo, subirArchivoStorage, eliminarArchivo, generarUrlTemporal } = require("../../utils/aws/s3Storage");

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
    const { uid, nombreUsuario } = req.user;

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
          usuarioActualizacion: nombreUsuario ?? null,
          fechaActualizacion: new Date(),
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
      usuarioRegistro: nombreUsuario ?? null,
      fechaRegistro: new Date(),
    });

    await nuevaFoto.save({
      session,
    });

    // ==========================================
    // 9. CONFIRMAR TRANSACCIÓN
    // ==========================================

    await session.commitTransaction();

    mongoConfirmado = true;

    // ====== Registro verificable por bucket y clave S3 ======
    console.info('FOTO_PERFIL registrada en S3:', nuevaFoto.storageBucket, nuevaFoto.storageKey);

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
        storageBucket: nuevaFoto.storageBucket,
        storageKey: nuevaFoto.storageKey,
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

// ====== Registrar fotografía de evaluación sin alterar foto de perfil ======
const subirFotoEvaluacionPaciente = async (req, res = response) => {
  let archivoS3 = null;
  let sesion = null;
  let confirmado = false;
  try {
    const pacienteId = String(req.params.pacienteId || '');
    const programacionId = String(req.body.programacionEmpresaId || '');
    if (!mongoose.Types.ObjectId.isValid(pacienteId) ||
        !mongoose.Types.ObjectId.isValid(programacionId)) {
      return res.status(400).json({ ok: false, msg: 'Paciente y programación válidos son obligatorios' });
    }
    if (!req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(400).json({ ok: false, msg: 'Debes enviar una fotografía JPEG, PNG o WEBP' });
    }
    const [paciente, programacion] = await Promise.all([
      Paciente.findById(pacienteId).select('_id').lean(),
      ProgramacionPacienteEmpresa.findById(programacionId).select('_id pacienteId').lean(),
    ]);
    if (!paciente || !programacion) {
      return res.status(404).json({ ok: false, msg: 'No se encontró el paciente o la programación' });
    }
    if (!programacion.pacienteId || String(programacion.pacienteId) !== pacienteId) {
      return res.status(409).json({ ok: false, msg: 'La programación no está vinculada a este paciente' });
    }
    const solicitudes = await SolicitudAtencion.find({ programacionEmpresaId: programacion._id })
      .select('_id').lean();
    if (!solicitudes.length) {
      return res.status(409).json({ ok: false, msg: 'La programación aún no tiene solicitudes vinculadas' });
    }

    archivoS3 = await subirArchivo({
      pacienteId,
      categoriaStorage: `evaluaciones/${programacionId}`,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    sesion = await mongoose.startSession();
    sesion.startTransaction();
    await ArchivoPaciente.updateMany({
      pacienteId: paciente._id,
      programacionEmpresaId: programacion._id,
      tipoArchivo: 'FOTO_EVALUACION',
      estadoArchivo: 'ACTIVO',
    }, {
      $set: {
        estadoArchivo: 'REEMPLAZADO',
        updatedBy: req.user.uid,
        usuarioActualizacion: req.user.nombreUsuario ?? null,
        fechaActualizacion: new Date(),
      },
    }, { session: sesion });

    const registro = new ArchivoPaciente({
      pacienteId: paciente._id,
      programacionEmpresaId: programacion._id,
      solicitudAtencionIds: solicitudes.map(x => x._id),
      tipoArchivo: 'FOTO_EVALUACION',
      origenArchivo: 'CAMARA',
      storageProvider: 'AWS_S3',
      storageBucket: process.env.AWS_S3_BUCKET,
      storageKey: archivoS3.key,
      storageVersionId: archivoS3.versionId ?? undefined,
      etag: archivoS3.etag ?? undefined,
      mimeType: req.file.mimetype,
      tamanioBytes: req.file.size,
      estadoArchivo: 'ACTIVO',
      createdBy: req.user.uid,
      usuarioRegistro: req.user.nombreUsuario ?? null,
      fechaRegistro: new Date(),
    });
    await registro.save({ session: sesion });
    await sesion.commitTransaction();
    confirmado = true;
    console.info('FOTO_EVALUACION registrada:', registro.storageBucket, registro.storageKey);
    return res.status(201).json({
      ok: true,
      msg: 'Fotografía de evaluación registrada',
      archivo: {
        _id: registro._id,
        tipoArchivo: registro.tipoArchivo,
        storageBucket: registro.storageBucket,
        storageKey: registro.storageKey,
        programacionEmpresaId: registro.programacionEmpresaId,
        solicitudAtencionIds: registro.solicitudAtencionIds,
      },
    });
  } catch (error) {
    if (sesion?.inTransaction()) await sesion.abortTransaction();
    if (archivoS3 && !confirmado) {
      try { await eliminarArchivo(archivoS3.key, archivoS3.versionId); }
      catch (rollbackError) { console.error('Rollback S3:', rollbackError); }
    }
    console.error('Error guardando FOTO_EVALUACION:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo guardar fotografía de evaluación' });
  } finally {
    if (sesion) await sesion.endSession();
  }
};

// ====== MC.2: guardar foto temporal sin crear paciente ni HC ======
const subirFotoEvaluacionTemporal = async (req, res = response) => {
  let archivoS3 = null;
  let session = null;
  let confirmado = false;
  try {
    const programacionId = String(req.params.programacionEmpresaId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(programacionId)) {
      return res.status(400).json({ ok: false, msg: 'Programación inválida' });
    }
    if (!req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(400).json({ ok: false, msg: 'Fotografía JPEG, PNG o WEBP requerida' });
    }

    const programacion = await ProgramacionPacienteEmpresa.findById(programacionId)
      .select('_id pacienteId hc nroDoc tipoDoc estadoProgramacion').lean();
    if (!programacion) {
      return res.status(404).json({ ok: false, msg: 'Programación no encontrada' });
    }
    if (programacion.estadoProgramacion !== 'EN ATENCION' ||
        programacion.pacienteId || programacion.hc || programacion.nroDoc || programacion.tipoDoc) {
      return res.status(409).json({ ok: false, codigo: 'IDENTIDAD_NO_TEMPORAL',
        msg: 'Solo se admite una fotografía temporal para una atención iniciada sin documento ni HC' });
    }
    const solicitudes = await SolicitudAtencion.find({ programacionEmpresaId: programacion._id })
      .select('_id').lean();
    if (!solicitudes.length) {
      return res.status(409).json({ ok: false, msg: 'La atención aún no tiene solicitudes vinculadas' });
    }

    // ====== Prefijo independiente del paciente maestro ======
    archivoS3 = await subirArchivoStorage({
      keyPrefix: `evaluaciones-temporales/${programacionId}`,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    session = await mongoose.startSession();
    session.startTransaction();
    // ====== Registrar sucesión sin borrar el objeto S3 anterior ======
    const anterior = await FotoEvaluacionTemporal.findOne({
      programacionEmpresaId: programacion._id, estadoArchivo: 'ACTIVO',
    }).session(session).select('_id');
    const foto = new FotoEvaluacionTemporal({
      programacionEmpresaId: programacion._id,
      solicitudAtencionIds: solicitudes.map(item => item._id),
      storageBucket: process.env.AWS_S3_BUCKET,
      storageKey: archivoS3.key,
      storageVersionId: archivoS3.versionId ?? null,
      etag: archivoS3.etag ?? null,
      mimeType: req.file.mimetype,
      tamanioBytes: req.file.size,
      reemplazaA: anterior?._id ?? null,
      createdBy: String(req.user?.uid || ''),
      usuarioRegistro: req.user?.nombreUsuario ?? null,
    });
    if (anterior) {
      const cambio = await FotoEvaluacionTemporal.updateOne({
        _id: anterior._id, programacionEmpresaId: programacion._id, estadoArchivo: 'ACTIVO',
      }, { $set: {
        estadoArchivo: 'REEMPLAZADO', reemplazadoPor: foto._id,
        fechaReemplazo: new Date(),
        reemplazadoPorUsuario: String(req.user?.uid || ''),
        reemplazadoPorNombre: req.user?.nombreUsuario ?? null,
      } }, { session });
      if (cambio.modifiedCount !== 1) {
        const conflicto = new Error('La fotografía activa cambió durante el reemplazo');
        conflicto.status = 409;
        throw conflicto;
      }
    }
    await foto.save({ session });
    await session.commitTransaction();
    confirmado = true;

    return res.status(201).json({ ok: true, msg: 'Fotografía temporal guardada en la programación',
      archivo: { _id: foto._id, storageKey: foto.storageKey,
        programacionEmpresaId: foto.programacionEmpresaId, solicitudAtencionIds: foto.solicitudAtencionIds,
        fechaCaptura: foto.fechaCaptura },
    });
  } catch (error) {
    if (session?.inTransaction()) await session.abortTransaction();
    if (archivoS3 && !confirmado) {
      try { await eliminarArchivo(archivoS3.key, archivoS3.versionId); }
      catch (errorRollback) { console.error('Rollback foto temporal S3:', errorRollback); }
    }
    console.error('Error guardando fotografía temporal:', error);
    if (error?.status === 409 || error?.code === 11000) {
      return res.status(409).json({ ok: false, codigo: 'FOTO_ACTIVA_MODIFICADA',
        msg: 'La fotografía cambió; actualiza el historial e inténtalo nuevamente' });
    }
    return res.status(500).json({ ok: false, msg: 'No se pudo guardar la fotografía temporal' });
  } finally {
    if (session) await session.endSession();
  }
};

// ====== MC.3.2: historial de fotografías de una programación ======
const listarHistorialFotosTemporales = async (req, res = response) => {
  try {
    const id = String(req.params.programacionEmpresaId || '');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, msg: 'Programación inválida' });
    }
    const programacion = await ProgramacionPacienteEmpresa.findById(id).select('_id').lean();
    if (!programacion) return res.status(404).json({ ok: false, msg: 'Programación no encontrada' });
    const fotos = await FotoEvaluacionTemporal.find({ programacionEmpresaId: programacion._id })
      .select('_id estadoArchivo fechaCaptura createdAt createdBy usuarioRegistro reemplazaA reemplazadoPor fechaReemplazo reemplazadoPorUsuario reemplazadoPorNombre')
      .sort({ createdAt: -1, _id: -1 }).lean();
    return res.status(200).set('Cache-Control', 'no-store').json({
      ok: true, fotos,
    });
  } catch (error) {
    console.error('Error consultando historial de fotos temporales:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo consultar el historial fotográfico' });
  }
};

// ====== Imagen histórica por ID, vinculada a su propia programación ======
const obtenerImagenHistoricaTemporal = async (req, res = response) => {
  try {
    const id = String(req.params.programacionEmpresaId || '');
    const fotoId = String(req.params.fotoId || '');
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(fotoId)) {
      return res.status(400).json({ ok: false, msg: 'Identificadores inválidos' });
    }
    const programacion = await ProgramacionPacienteEmpresa.findById(id).select('_id').lean();
    if (!programacion) return res.status(404).json({ ok: false, msg: 'Programación no encontrada' });
    const foto = await FotoEvaluacionTemporal.findOne({
      _id: fotoId, programacionEmpresaId: programacion._id,
      estadoArchivo: { $in: ['ACTIVO', 'REEMPLAZADO'] },
    }).select('storageBucket storageKey mimeType').lean();
    if (!foto) return res.status(404).json({ ok: false, msg: 'Fotografía no encontrada en esta programación' });
    const objeto = await s3Client.send(new GetObjectCommand({
      Bucket: foto.storageBucket || process.env.AWS_S3_BUCKET, Key: foto.storageKey,
    }));
    const partes = [];
    for await (const parte of objeto.Body) partes.push(Buffer.from(parte));
    res.set({
      'Content-Type': foto.mimeType || objeto.ContentType || 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    return res.status(200).send(Buffer.concat(partes));
  } catch (error) {
    console.error('Error leyendo fotografía histórica temporal:', error?.name, error?.message);
    if (error?.name === 'NoSuchKey') return res.status(404).json({ ok: false, msg: 'Objeto S3 no encontrado' });
    if (error?.name === 'AccessDenied') return res.status(403).json({ ok: false, msg: 'Sin permiso de lectura de fotografías temporales en S3' });
    return res.status(500).json({ ok: false, msg: 'No se pudo recuperar la fotografía histórica' });
  }
};

// ====== Resolver paciente para identificación fotográfica ======
const resolverPacienteIdentificacion = async ({ pacienteId, hc, programacionEmpresaId }) => {
  const hcNormalizada = String(hc ?? '').trim();
  const idNormalizado = String(pacienteId ?? '').trim();
  const programacionId = String(programacionEmpresaId ?? '').trim();

  // ====== Resolver por datos maestros sin vincular historias ajenas ======
  const porHc = hcNormalizada
    ? await Paciente.findOne({ hc: hcNormalizada }).select('_id hc').lean()
    : null;
  const porId = mongoose.Types.ObjectId.isValid(idNormalizado)
    ? await Paciente.findById(idNormalizado).select('_id hc').lean()
    : null;

  let porProgramacion = null;
  if (mongoose.Types.ObjectId.isValid(programacionId)) {
    const programacion = await ProgramacionPacienteEmpresa.findById(programacionId)
      .select('pacienteId').lean();
    if (programacion?.pacienteId) {
      porProgramacion = await Paciente.findById(programacion.pacienteId).select('_id hc').lean();
    }
  }

  const candidatos = [porHc, porId, porProgramacion].filter(Boolean);
  if (candidatos.length === 0) return { paciente: null, inconsistente: false };
  const primero = String(candidatos[0]._id);
  const inconsistente = candidatos.some((item) => String(item._id) !== primero) ||
    (hcNormalizada && candidatos.some((item) => item.hc !== hcNormalizada));
  return { paciente: inconsistente ? null : candidatos[0], inconsistente };
};

// ====== Resolver foto por evaluación, con respaldo de fotos antiguas ======
const buscarFotoEvaluacion = async (req) => {
  const { hc, programacionEmpresaId, solicitudAtencionId } = req.query;
  const pacienteId = req.params.pacienteId ?? req.query.pacienteId;
  let programacionId = String(programacionEmpresaId || '').trim();
  const solicitudId = String(solicitudAtencionId || '').trim();
  if (solicitudId) {
    if (!mongoose.Types.ObjectId.isValid(solicitudId)) {
      return { error: 'SOLICITUD_INVALIDA', status: 400 };
    }
    const solicitud = await SolicitudAtencion.findById(solicitudId)
      .select('programacionEmpresaId').lean();
    if (!solicitud) return { error: 'SOLICITUD_NO_ENCONTRADA', status: 404 };
    const desdeSolicitud = String(solicitud.programacionEmpresaId || '');
    if (programacionId && programacionId !== desdeSolicitud) {
      return { error: 'VINCULOS_INCONSISTENTES', status: 409 };
    }
    programacionId = desdeSolicitud;
  }
  if (programacionId && !mongoose.Types.ObjectId.isValid(programacionId)) {
    return { error: 'PROGRAMACION_INVALIDA', status: 400 };
  }

  // ====== La foto temporal solo es consultable por su evaluación sin HC ======
  if (programacionId) {
    const programacion = await ProgramacionPacienteEmpresa.findById(programacionId)
      .select('pacienteId hc nroDoc tipoDoc estadoProgramacion').lean();
    if (!programacion) return { error: 'PROGRAMACION_NO_ENCONTRADA', status: 404 };
    const temporal = !programacion.pacienteId && !programacion.hc &&
      !programacion.nroDoc && !programacion.tipoDoc &&
      programacion.estadoProgramacion === 'EN ATENCION';
    if (temporal) {
      if (pacienteId || hc) return { error: 'IDENTIDAD_INCONSISTENTE', status: 409 };
      const foto = await FotoEvaluacionTemporal.findOne({
        programacionEmpresaId: programacionId, estadoArchivo: 'ACTIVO',
      }).sort({ fechaCaptura: -1, createdAt: -1 })
        .select('storageBucket storageKey storageVersionId fechaCaptura mimeType tipoArchivo').lean();
      return foto ? { disponible: true, foto } : { disponible: false, motivo: 'SIN_FOTOGRAFIA' };
    }
  }
  const { paciente, inconsistente } = await resolverPacienteIdentificacion({
    pacienteId, hc, programacionEmpresaId: programacionId,
  });
  if (inconsistente) return { error: 'IDENTIDAD_INCONSISTENTE', status: 409 };
  if (!paciente || !programacionId) return { disponible: false, motivo: 'SIN_EVALUACION_VINCULADA' };

  // ====== Compatibilidad: fotos antiguas FOTO_PERFIL con programación ======
  const foto = await ArchivoPaciente.findOne({
    pacienteId: paciente._id,
    programacionEmpresaId: programacionId,
    tipoArchivo: { $in: ['FOTO_EVALUACION', 'FOTO_PERFIL'] },
    estadoArchivo: 'ACTIVO',
  })
    .sort({ fechaCaptura: -1, createdAt: -1 })
    .select('storageBucket storageKey storageVersionId fechaCaptura mimeType tipoArchivo')
    .lean();
  if (!foto) return { disponible: false, motivo: 'SIN_FOTOGRAFIA' };
  return { disponible: true, foto };
};

// ====== Información de la foto sin exponer el objeto de S3 ======
const obtenerFotoIdentificacionPaciente = async (req, res = response) => {
  try {
    const resultado = await buscarFotoEvaluacion(req);
    if (resultado.error) {
      return res.status(resultado.status).set('Cache-Control', 'no-store').json({
        ok: false, codigo: resultado.error, msg: 'No se pudo resolver la evaluación fotográfica',
      });
    }
    if (!resultado.disponible) {
      return res.status(200).set('Cache-Control', 'no-store').json({
        ok: true, disponible: false, motivo: resultado.motivo, urlTemporal: null,
      });
    }
    return res.status(200).set('Cache-Control', 'no-store').json({
      ok: true,
      disponible: true,
      tipoArchivo: resultado.foto.tipoArchivo,
      fechaCaptura: resultado.foto.fechaCaptura ?? null,
      urlTemporal: null,
    });
  } catch (error) {
    console.error('Error consultando foto de evaluación:', error);
    return res.status(500).json({ ok: false, msg: 'Error consultando foto de evaluación' });
  }
};

// ====== Descargar foto vía backend autenticado para evitar fallos de URL ======
const obtenerImagenEvaluacionPaciente = async (req, res = response) => {
  try {
    const resultado = await buscarFotoEvaluacion(req);
    if (resultado.error) {
      return res.status(resultado.status).json({ ok: false, codigo: resultado.error,
        msg: 'Vínculos de evaluación inconsistentes' });
    }
    if (!resultado.disponible) {
      return res.status(404).json({ ok: false, codigo: resultado.motivo,
        msg: 'Esta evaluación no tiene fotografía registrada' });
    }
    const foto = resultado.foto;
    const objeto = await s3Client.send(new GetObjectCommand({
      Bucket: foto.storageBucket || process.env.AWS_S3_BUCKET,
      Key: foto.storageKey,
      // ====== Clave UUID única: no solicitar una versión S3 específica ======
    }));
    const partes = [];
    for await (const parte of objeto.Body) partes.push(Buffer.from(parte));
    res.set({
      'Content-Type': foto.mimeType || objeto.ContentType || 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    return res.status(200).send(Buffer.concat(partes));
  } catch (error) {
    const codigo = error?.name || error?.Code || 'ERROR_DESCONOCIDO';
    console.error('Error leyendo foto de evaluación desde S3:', codigo, error?.message);
    if (codigo === 'AccessDenied' || codigo === 'Forbidden') {
      return res.status(403).json({ ok: false, codigo: 'S3_GETOBJECT_DENEGADO',
        msg: 'La credencial AWS necesita s3:GetObject para pacientes/*' });
    }
    if (codigo === 'NoSuchKey' || codigo === 'NotFound') {
      return res.status(404).json({ ok: false, codigo: 'S3_OBJETO_NO_ENCONTRADO',
        msg: 'La foto está registrada en MongoDB pero no existe en S3' });
    }
    return res.status(500).json({ ok: false, codigo: 'ERROR_LECTURA_FOTOGRAFIA',
      msg: 'No se pudo descargar la fotografía de evaluación' });
  }
};

// ====== Consulta antigua, reservada para perfil personal ======
const obtenerFotoPerfilPaciente = async (req, res = response) => {
  try {
    const pacienteId = req.params.pacienteId;
    if (!mongoose.Types.ObjectId.isValid(pacienteId)) {
      return res.status(400).json({ ok: false, msg: 'Paciente inválido' });
    }
    const foto = await ArchivoPaciente.findOne({
      pacienteId, tipoArchivo: 'FOTO_PERFIL', estadoArchivo: 'ACTIVO',
      programacionEmpresaId: { $exists: false },
    }).sort({ fechaCaptura: -1 }).lean();
    return res.json({ ok: true, disponible: !!foto,
      urlTemporal: foto ? await generarUrlTemporal(foto.storageKey, 300, foto.storageVersionId) : null });
  } catch (error) {
    console.error('Error consultando perfil:', error);
    return res.status(500).json({ ok: false, msg: 'Error consultando foto de perfil' });
  }
};

module.exports = {
  subirFotoPerfilPaciente,
  subirFotoEvaluacionPaciente,
  subirFotoEvaluacionTemporal,
  listarHistorialFotosTemporales,
  obtenerImagenHistoricaTemporal,
  obtenerFotoPerfilPaciente,
  obtenerFotoIdentificacionPaciente,
  obtenerImagenEvaluacionPaciente,
};
