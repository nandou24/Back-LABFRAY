const crypto = require('crypto');
const RecurHumano = require('../../models/Mantenimiento/RecHumano');
const Profesion = require('../../models/Mantenimiento/Profesiones');
const FirmaProfesionalLaboratorio = require('../../models/Mantenimiento/FirmaProfesionalLaboratorio');
const FirmaProfesionalLaboratorioVersion = require('../../models/Mantenimiento/FirmaProfesionalLaboratorioVersion');

// ====== Resolver PNG conservando su integridad ======
const obtenerBufferFirma = (imagen) => {
  if (Buffer.isBuffer(imagen)) return imagen;
  if (imagen?._bsontype === 'Binary' && typeof imagen.value === 'function') {
    return Buffer.from(imagen.value(true));
  }
  if (ArrayBuffer.isView(imagen)) {
    return Buffer.from(imagen.buffer, imagen.byteOffset, imagen.byteLength);
  }
  return null;
};

const esPng = (imagen) =>
  imagen?.length >= 40 &&
  imagen.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' &&
  imagen.toString('ascii', 12, 16) === 'IHDR';

// ====== Resolver profesional autorizado para Laboratorio ======
const resolverResponsableInformeLaboratorio = async ({ validadoPor, session, fecha, liberadoPor, usuarioLiberacion }) => {
  const filtroBase = {
    'firmaLaboratorio.habilitado': true,
    'firmaLaboratorio.serviciosAutorizados': 'Laboratorio',
  };

  const opcionesPopulate = [
    { path: 'profesionesRecurso.profesionRef', select: 'nombreProfesion estadoProfesion' },
    { path: 'profesionesRecurso.especialidades.especialidadRef', select: 'nombreEspecialidad estadoEspecialidad' },
  ];

  const predeterminado = await RecurHumano.findOne({
    ...filtroBase,
    'firmaLaboratorio.predeterminadoLaboratorio': true,
  }).populate(opcionesPopulate).session(session);

  const profesional = predeterminado || (validadoPor
    ? await RecurHumano.findOne({ ...filtroBase, codRecHumano: String(validadoPor) })
      .populate(opcionesPopulate).session(session)
    : null);

  if (!profesional) return null; // ====== No alterar resultados históricos sin firmante ======

  const config = profesional.firmaLaboratorio;
  const autorizacion = String(config?.referenciaAutorizacion ?? '').trim();
  const perfiles = Array.isArray(config?.presentaciones) ? config.presentaciones : [];
  const perfilesLaboratorio = perfiles.filter(
    (item) => (item.serviciosAutorizados ?? []).includes('Laboratorio'),
  );
  const perfil = perfilesLaboratorio.find((item) => item.esPrincipal === true) ??
    (perfilesLaboratorio.length === 1 ? perfilesLaboratorio[0] : null);
  if (perfiles.length && !perfil) {
    const err = new Error('Configure una presentación inequívoca para los informes de Laboratorio');
    err.statusCode = 409;
    throw err;
  }
  const errorConfiguracionFirma = (codigo, mensaje) => {
    const error = new Error(mensaje);
    error.statusCode = 409;
    error.codigo = codigo;
    return error;
  };

  if (!autorizacion) {
    throw errorConfiguracionFirma('FIRMA_AUTORIZACION_FALTANTE',
      'El firmante predeterminado no tiene una referencia de autorización guardada en Recursos Humanos');
  }

  // ====== Conservar compatibilidad con credenciales previas ======
  const profesiones = Array.isArray(profesional.profesionesRecurso)
    ? profesional.profesionesRecurso : [];
  const idPerfil = String(perfil?.profesionRecursoId ?? '');
  const idConfiguracion = String(config?.profesionRecursoId ?? '');
  const buscarProfesion = (id) => id && profesiones.find((item) => String(item._id) === id);
  let profesion = buscarProfesion(idPerfil) || buscarProfesion(idConfiguracion);

  // ====== Recuperar enlace tras actualización legacy de RR. HH. ======
  if (!profesion && perfilesLaboratorio.length === 1 && profesiones.length === 1) {
    const unicaProfesion = profesiones[0];
    if (String(unicaProfesion?.nroColegiatura ?? '').trim()) {
      profesion = unicaProfesion;
      console.warn('Firma RH: recuperada profesión única tras regeneración de id de subdocumento', {
        recursoHumanoId: String(profesional._id),
        perfilId: String(perfil?.perfilId ?? 'legacy'),
      });
    }
  }

  if (!profesion) {
    throw errorConfiguracionFirma('FIRMA_PROFESION_DESVINCULADA',
      'No coincide la profesión registrada en Recursos Humanos con la firma autorizada. Vuelva a seleccionar la profesión desde Firma de informes, guarde y reintente. No es necesario volver a subir el PNG');
  }

  const nroColegiatura = String(profesion.nroColegiatura ?? '').trim();
  if (!nroColegiatura) {
    throw errorConfiguracionFirma('FIRMA_COLEGIATURA_FALTANTE',
      'La profesión seleccionada para firmar no tiene colegiatura registrada en Recursos Humanos');
  }

  // ====== Verificar el maestro sin depender exclusivamente de populate ======
  const profesionMaestraId = profesion.profesionRef?._id ?? profesion.profesionRef;
  const profesionMaestra = profesion.profesionRef?.nombreProfesion
    ? profesion.profesionRef
    : (profesionMaestraId
      ? await Profesion.findById(profesionMaestraId)
          .select('nombreProfesion estadoProfesion').session(session)
      : null);
  if (!profesionMaestra?.nombreProfesion) {
    throw errorConfiguracionFirma('FIRMA_MAESTRO_PROFESION_FALTANTE',
      'No se encontró el maestro de profesión asociado a la firma. Revise la profesión registrada en Recursos Humanos');
  }
  if (profesionMaestra.estadoProfesion === false) {
    throw errorConfiguracionFirma('FIRMA_PROFESION_INACTIVA',
      'La profesión asociada a la firma está inactiva en el maestro de profesiones');
  }

  const firma = await FirmaProfesionalLaboratorio.findOne({
    recursoHumanoId: profesional._id,
  }).select('+imagen +imagenesPorPerfil hashSha256').session(session);
  const perfilId = String(perfil?.perfilId ?? 'legacy');
  const firmaPerfil = perfilId !== 'legacy'
    ? (firma?.imagenesPorPerfil ?? []).find((imagen) => imagen.perfilId === perfilId)
    : null;
  const png = obtenerBufferFirma(perfilId === 'legacy' ? firma?.imagen : firmaPerfil?.imagen);
  const hashAlmacenado = perfilId === 'legacy' ? firma?.hashSha256 : firmaPerfil?.hashSha256;
  const hash = png ? crypto.createHash('sha256').update(png).digest('hex') : '';
  if (!esPng(png) || hash !== hashAlmacenado) {
    const err = new Error('La firma autorizada falta o no supera la verificación de integridad');
    err.statusCode = 409;
    throw err;
  }

  // ====== Conservar una copia inmutable de cada PNG utilizado ======
  const archivo = await FirmaProfesionalLaboratorioVersion.findOneAndUpdate(
    { recursoHumanoId: profesional._id, hashSha256: hash },
    { $setOnInsert: { recursoHumanoId: profesional._id, hashSha256: hash, imagen: png } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session },
  );

  const especialidad = perfil?.especialidadId
    ? (profesion.especialidades ?? []).find((item) =>
        String(item._id) === String(perfil.especialidadId) &&
        item?.especialidadRef?.nombreEspecialidad && item.especialidadRef.estadoEspecialidad !== false,
      )
    : null;

  return {
    recursoHumanoId: profesional._id,
    firmaArchivoId: archivo._id,
    hashFirma: hash,
    perfilId,
    tratamiento: String(perfil?.tratamiento ?? '').trim(),
    mostrarProfesion: perfil?.mostrarProfesion !== false,
    mostrarEspecialidad: perfil?.mostrarEspecialidad !== false,
    mostrarColegiatura: perfil?.mostrarColegiatura !== false,
    mostrarRne: perfil?.mostrarRne !== false,
    siglaColegiatura: String(perfil?.siglaColegiatura || 'Colegiatura'),
    siglaEspecialidad: String(perfil?.siglaEspecialidad || 'RNE'),
    nombreCompleto: [profesional.nombreRecHumano, profesional.apePatRecHumano, profesional.apeMatRecHumano]
      .filter(Boolean).join(' ').trim(),
    nombres: profesional.nombreRecHumano || null,
    apellidoPaterno: profesional.apePatRecHumano || null,
    apellidoMaterno: profesional.apeMatRecHumano || null,
    sexo: profesional.sexoRecHumano || null,
    profesion: profesionMaestra.nombreProfesion,
    especialidad: especialidad?.especialidadRef?.nombreEspecialidad || null,
    nroColegiatura: String(profesion.nroColegiatura).trim(),
    rne: especialidad?.rne ? String(especialidad.rne).trim() : null,
    origenAsignacion: predeterminado ? 'PREDETERMINADO_AUTORIZADO' : 'VALIDADOR_AUTORIZADO',
    referenciaAutorizacion: autorizacion,
    fechaDesignacion: fecha,
    liberadoPor: String(liberadoPor ?? ''),
    usuarioLiberacion: usuarioLiberacion ?? null,
  };
};

module.exports = { resolverResponsableInformeLaboratorio, obtenerBufferFirma, esPng };
