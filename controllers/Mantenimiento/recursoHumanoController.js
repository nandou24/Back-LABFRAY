const { response } = require("express");
const RecurHumano = require("../../models/Mantenimiento/RecHumano");
const bcrypt = require("bcryptjs");
const { generarJWT } = require("../../helpers/jwt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Profesion = require("../../models/Mantenimiento/Profesiones");
const Especialidad = require("../../models/Mantenimiento/Especialidades");
const FirmaProfesionalLaboratorio = require("../../models/Mantenimiento/FirmaProfesionalLaboratorio");
const crypto = require("crypto");

const SERVICIOS_FIRMABLES = ["Laboratorio", "Ecografía", "Rayos X", "Consulta", "Procedimiento"];


// ====== Proteger habilitación de firmantes en altas y ediciones generales ======
const retirarCamposFirmaProtegidos = (datos = {}) => {
  return Object.fromEntries(
    Object.entries(datos).filter(
      ([clave]) =>
        clave !== "firmaLaboratorio" &&
        !clave.startsWith("firmaLaboratorio.") &&
        !clave.startsWith("$"),
    ),
  );
};

const crearRecursoHumano = async (req, res = response) => {
  //debemos generar un número de historia clínica año-mes-correlativo-inicial de ape pater - inicial ape mat
  const {
    tipoDoc,
    nroDoc,
    nombreCliente,
    apePatCliente,
    apeMatCliente,
    fechaNacimiento,
    sexoCliente,
    departamentoCliente,
    provinciaCliente,
    distritoCliente,
    direcCliente,
    mailCliente,
    phones,
    gradoInstruccion,
    profesionesRecurso,
    profesionSolicitante,
    especialidadesRecurso,
    usuarioSistema,
    datosLogueo, // Aquí se espera que contenga el passwordHash
  } = req.body;

  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  console.log("Datos del recurso humano:", req.body);

  //Para crear HC
  const fecha = new Date();
  const anio = fecha.getFullYear();
  const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");

  try {
    // verificar el email si es que existe
    const recursoHumano = await RecurHumano.findOne({ tipoDoc, nroDoc });

    if (recursoHumano) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un usuario con ese documento de identidad",
      });
    }

    //creando codigo
    // Buscar el último recursoHumano creado
    const ultimoRecursoHumano = await RecurHumano.findOne(
      {},
      { codRecHumano: 1 }
    )
      .sort({ codRecHumano: -1 })
      .lean();

    // Obtener el correlativo
    let correlativo = 1;

    if (ultimoRecursoHumano) {
      const ultimoCorrelativo = parseInt(
        ultimoRecursoHumano.codRecHumano.substring(2),
        10
      );
      correlativo = ultimoCorrelativo + 1;
    }

    // Crear el número de historia clínica sin guiones
    const codigo = `RH${String(correlativo).padStart(4, "0")}`;

    if (usuarioSistema && datosLogueo?.passwordHash) {
      const salt = await bcrypt.genSalt(10);
      datosLogueo.passwordHash = await bcrypt.hash(
        datosLogueo.passwordHash,
        salt
      );
    }

    // Crear el paciente con el número de historia clínica
    // Crear usuario con el modelo
    const nuevoRecursoHumano = new RecurHumano({
      ...retirarCamposFirmaProtegidos(req.body),
      datosLogueo: datosLogueo,
      codRecHumano: codigo, // Agregar el código generado
      createdBy: uid, // uid del usuario que creó el recurso humano
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó el recurso humano
      fechaRegistro: new Date(), // Fecha de registro
    });

    await nuevoRecursoHumano.save();
    // console.log(dbUser, "pasoo registro");
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      uid: nuevoRecursoHumano.id,
      //token: token,
    });
  } catch (error) {
    console.error("❌ Error al registrar el recurso humano:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimosRecurHumanos = async (req, res = response) => {
  try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);
    let recHumanos;

    // Si no se especifica cantidad, mostrar todos los recursos humanos
    if (cantidad == 0) {
      recHumanos = await RecurHumano.find()
        .populate("datosLogueo.rol")
        .sort({ createdAt: -1 })
        .lean();
      // Si se especifica una cantidad, limitar la consulta
    } else {
      recHumanos = await RecurHumano.find()
        .populate("datosLogueo.rol")
        .sort({ createdAt: -1 })
        .limit(limite)
        .lean();
    }

    // Eliminar el campo passwordHash de cada recurso humano (si existe)
    const recHumanosSinPassword = recHumanos.map((rh) => {
      if (rh.datosLogueo?.passwordHash) {
        delete rh.datosLogueo.passwordHash;
      }
      return rh;
    });

    return res.json({
      ok: true,
      recHumanos: recHumanosSinPassword,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const obtenerSolicitantes = async (req, res = response) => {
  try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);

    // Filtrar solo los recursos humanos donde `esSolicitante` es `true`
    const recHumanos = await RecurHumano.find(
      { esSolicitante: true }, // Filtro
      {
        codRecHumano: 1,
        nombreRecHumano: 1,
        apePatRecHumano: 1,
        apeMatRecHumano: 1,
        profesionSolicitante: 1,
        especialidadesRecurso: 1,
      } // Solo los campos necesarios
    )
      .limit(limite)
      .lean();

    res.status(200).json({
      ok: true,
      recHumanos,
    });
  } catch (error) {
    console.error("Error al obtener los solicitantes:", error);
    res.status(500).json({
      ok: false,
      msg: "Error al obtener los solicitantes",
    });
  }
};

const obtenerProfesionalesConsultas = async (req, res = response) => {
  try {
    const { profesion, especialidad } = req.query;

    // Validación: debe llegar al menos uno
    if (!profesion && !especialidad) {
      return res.status(400).json({
        ok: false,
        msg: "Debe proporcionar al menos 'profesion' o 'especialidad' como parámetro.",
      });
    }

    const filtro = {
      atiendeConsultas: true,
      profesionesRecurso: {
        $elemMatch: especialidad
          ? { "especialidades.nombreEspecialidad": especialidad }
          : {
              profesion: profesion,
              $or: [
                { especialidades: { $exists: false } },
                { especialidades: { $size: 0 } },
              ],
            },
      },
    };

    const medicos = await RecurHumano.find(filtro, {
      codRecHumano: 1,
      nombreRecHumano: 1,
      apePatRecHumano: 1,
      apeMatRecHumano: 1,
      profesionesRecurso: 1,
    });

    const resultado = medicos.map((medico) => {
      // Tomar la profesión principal
      const profesion = medico.profesionesRecurso.find((prof) => {
        if (especialidad) {
          return prof.especialidades?.some(
            (esp) => esp.nombreEspecialidad === especialidad
          );
        } else {
          return prof.profesion === profesion;
        }
      });

      const especialidadEncontrada = profesion?.especialidades?.find(
        (esp) => esp.nombreEspecialidad === especialidad
      );

      return {
        _id: medico._id,
        codRecHumano: medico.codRecHumano,
        nombreCompletoPersonal: `${medico.nombreRecHumano} ${medico.apePatRecHumano} ${medico.apeMatRecHumano}`,
        nroColegiatura: profesion?.nroColegiatura || "",
        colegiatura: profesion?.nroColegiatura || "",
        especialidad: especialidadEncontrada?.nombreEspecialidad || null,
        rne: especialidadEncontrada?.rne || null,
      };
    });

    return res.status(200).json({
      ok: true,
      recHumanos: resultado,
    });
  } catch (error) {
    console.error("Error al obtener los solicitantes:", error);
    res.status(500).json({
      ok: false,
      msg: "Error al obtener los solicitantes",
    });
  }
};

const obtenerProfesionalesQueAtiendenConsultas = async (
  req,
  res = response
) => {
  try {
    const recHumanos = await RecurHumano.find(
      { atiendeConsultas: true },
      {
        codRecHumano: 1,
        nombreRecHumano: 1,
        apePatRecHumano: 1,
        apeMatRecHumano: 1,
        profesionesRecurso: 1,
        especialidadesRecurso: 1,
      }
    ).lean();

    return res.status(200).json({
      ok: true,
      recHumanos: recHumanos,
    });
  } catch (error) {
    console.error(
      "Error al obtener profesionales que atienden consultas:",
      error
    );
    return res.status(500).json({
      ok: false,
      msg: "Error al obtener profesionales que atienden consultas",
    });
  }
};

const encontrarTermino = async (req, res = response) => {
  const termino = req.query.search;

  try {
    const recHumanos = await RecurHumano.find({
      //nroDoc: { $regex: termino, $options: 'i'}

      $or: [
        { nombreRecHumano: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nombre"
        { apePatRecHumano: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "apellido paterno"
        { apeMatRecHumano: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "apellido materno"
        { nroDoc: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nro documento"
        // Agrega más campos si es necesario
      ],
    }).populate("datosLogueo.rol");
    return res.json({
      ok: true,
      recHumanos, //! favoritos: favoritos
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const actualizarRecursoHumano = async (req, res = response) => {
  const codigo = req.params.codRecHumano; //recupera la hc
  const datosActualizados = retirarCamposFirmaProtegidos(req.body); //recupera los datos a grabar
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  try {
    // Solo encripta si el campo passwordHash viene con datos nuevos
    if (
      datosActualizados.usuarioSistema &&
      datosActualizados.datosLogueo?.passwordHash
    ) {
      const salt = await bcrypt.genSalt(10);
      datosActualizados.datosLogueo.passwordHash = await bcrypt.hash(
        datosActualizados.datosLogueo.passwordHash,
        salt
      );
    }

    const recHumano = await RecurHumano.findOneAndUpdate(
      { codRecHumano: codigo },
      { 
        $set: datosActualizados,
        updatedBy: uid, // uid del usuario que actualiza
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true }
    );
    console.log(recHumano);

    if (!recHumano) {
      return res.status(404).json({
        ok: false,
        msg: "Recurso humano no encontrado con ese código",
      });
    }

    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.error("Error al actualizar el recurso: ", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};

// ====== Preparar datos públicos de firmante ======
const construirFichaFirmanteLaboratorio = (recurso) => {
  const profesionSeleccionada = (recurso.profesionesRecurso ?? []).find(
    (profesion) =>
      String(profesion._id) ===
      String(recurso.firmaLaboratorio?.profesionRecursoId ?? ""),
  );

  if (
    !recurso.firmaLaboratorio?.habilitado ||
    !profesionSeleccionada?.nroColegiatura?.trim() ||
    !profesionSeleccionada.profesionRef?.estadoProfesion
  ) {
    return null;
  }

  return {
    recursoHumanoId: String(recurso._id),
    codRecHumano: recurso.codRecHumano,
    nombreCompleto: [
      recurso.nombreRecHumano,
      recurso.apePatRecHumano,
      recurso.apeMatRecHumano,
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),
    profesionRecursoId: String(profesionSeleccionada._id),
    serviciosAutorizados: recurso.firmaLaboratorio?.serviciosAutorizados ?? [],
    predeterminadoLaboratorio: recurso.firmaLaboratorio?.predeterminadoLaboratorio === true,
    imagenFirmaDisponible: recurso.imagenFirmaDisponible === true,
    profesion: profesionSeleccionada.profesionRef.nombreProfesion,
    nroColegiatura: profesionSeleccionada.nroColegiatura,
    especialidades: (profesionSeleccionada.especialidades ?? [])
      .map((item) => ({
        especialidadId: String(item.especialidadRef?._id ?? item.especialidadRef ?? ""),
        rne: item.rne ?? "",
      })),
  };
};

// ====== Listar candidatos con profesiones y colegiaturas ======
const obtenerCandidatosFirmantesLaboratorio = async (req, res = response) => {
  try {
    const recursos = await RecurHumano.find({
      "profesionesRecurso.nroColegiatura": { $exists: true, $nin: [null, ""] },
    })
      .select(
        "codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano " +
        "profesionesRecurso firmaLaboratorio",
      )
      .populate("profesionesRecurso.profesionRef", "nombreProfesion estadoProfesion")
      .sort({ apePatRecHumano: 1, apeMatRecHumano: 1, nombreRecHumano: 1 })
      .limit(200)
      .lean();

    const imagenes = await FirmaProfesionalLaboratorio.distinct("recursoHumanoId", {
      recursoHumanoId: { $in: recursos.map((item) => item._id) },
    });
    const conImagen = new Set(imagenes.map(String));
    const candidatos = recursos.map((recurso) => ({
      imagenFirmaDisponible: conImagen.has(String(recurso._id)),
      serviciosAutorizados: recurso.firmaLaboratorio?.serviciosAutorizados ?? [],
      predeterminadoLaboratorio: recurso.firmaLaboratorio?.predeterminadoLaboratorio === true,
      referenciaAutorizacion: recurso.firmaLaboratorio?.referenciaAutorizacion ?? "",
      presentaciones: recurso.firmaLaboratorio?.presentaciones ?? [],
      recursoHumanoId: String(recurso._id),
      codRecHumano: recurso.codRecHumano,
      nombreCompleto: [
        recurso.nombreRecHumano,
        recurso.apePatRecHumano,
        recurso.apeMatRecHumano,
      ].filter(Boolean).join(" ").trim(),
      habilitado: recurso.firmaLaboratorio?.habilitado === true,
      profesionRecursoIdHabilitada: recurso.firmaLaboratorio?.profesionRecursoId
        ? String(recurso.firmaLaboratorio.profesionRecursoId)
        : null,
      profesiones: (recurso.profesionesRecurso ?? [])
        .filter(
          (profesion) =>
            Boolean(String(profesion.nroColegiatura ?? "").trim()) &&
            profesion.profesionRef?.estadoProfesion !== false &&
            Boolean(profesion.profesionRef?.nombreProfesion),
        )
        .map((profesion) => ({
          profesionRecursoId: String(profesion._id),
          profesion: profesion.profesionRef.nombreProfesion,
          nroColegiatura: profesion.nroColegiatura,
        })),
    })).filter((candidato) => candidato.profesiones.length > 0);

    return res.json({ ok: true, candidatos });
  } catch (error) {
    console.error("Error al consultar candidatos firmantes:", error);
    return res.status(500).json({
      ok: false,
      msg: "No se pudieron consultar los candidatos firmantes",
    });
  }
};

// ====== Listar profesionales habilitados para firmar ======
const obtenerFirmantesLaboratorio = async (req, res = response) => {
  try {
    const recursos = await RecurHumano.find({ "firmaLaboratorio.habilitado": true })
      .select(
        "codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano " +
        "profesionesRecurso firmaLaboratorio",
      )
      .populate("profesionesRecurso.profesionRef", "nombreProfesion estadoProfesion")
      .lean();

    const imagenes = await FirmaProfesionalLaboratorio.distinct("recursoHumanoId", {
      recursoHumanoId: { $in: recursos.map((item) => item._id) },
    });
    const conImagen = new Set(imagenes.map(String));
    const firmantes = recursos
      .map((item) => ({ ...item, imagenFirmaDisponible: conImagen.has(String(item._id)) }))
      .map(construirFichaFirmanteLaboratorio)
      .filter(Boolean)
      .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, "es"));

    return res.json({ ok: true, firmantes });
  } catch (error) {
    console.error("Error al consultar firmantes de laboratorio:", error);
    return res.status(500).json({
      ok: false,
      msg: "No se pudieron consultar los firmantes",
    });
  }
};

// ====== Normalizar presentación registrada ======
const normalizarPresentacionesFirma = async (recurso, entradas, habilitado) => {
  if (!Array.isArray(entradas) || entradas.length > 6) {
    const error = new Error('Configure un máximo de 6 presentaciones de firma');
    error.statusCode = 400;
    throw error;
  }
  const ids = new Set();
  const presentaciones = [];
  for (const item of entradas) {
    const perfilId = String(item?.perfilId ?? '').trim();
    if (!/^[a-zA-Z0-9_-]{5,80}$/.test(perfilId) || ids.has(perfilId)) {
      const error = new Error('Una presentación de firma tiene identificador inválido o repetido');
      error.statusCode = 400;
      throw error;
    }
    ids.add(perfilId);
    const profesion = (recurso.profesionesRecurso ?? []).find(
      (p) => String(p._id) === String(item.profesionRecursoId),
    );
    if (!profesion || !String(profesion.nroColegiatura ?? '').trim()) {
      const error = new Error('Cada firma requiere una profesión registrada y colegiatura');
      error.statusCode = 422;
      throw error;
    }
    const maestro = await Profesion.findById(profesion.profesionRef)
      .select('nombreProfesion estadoProfesion').lean();
    if (!maestro || maestro.estadoProfesion === false) {
      const error = new Error('La profesión seleccionada no está activa');
      error.statusCode = 422;
      throw error;
    }
    let especialidadId = null;
    if (item.especialidadId) {
      const especialidad = (profesion.especialidades ?? []).find(
        (esp) => String(esp._id) === String(item.especialidadId),
      );
      if (!especialidad) {
        const error = new Error('La especialidad no corresponde a la profesión del firmante');
        error.statusCode = 422;
        throw error;
      }
      const maestroEspecialidad = await Especialidad.findById(especialidad.especialidadRef)
        .select('nombreEspecialidad estadoEspecialidad').lean();
      if (!maestroEspecialidad || maestroEspecialidad.estadoEspecialidad === false) {
        const error = new Error('La especialidad seleccionada no está activa');
        error.statusCode = 422;
        throw error;
      }
      especialidadId = especialidad._id;
    }
    const servicios = [...new Set((Array.isArray(item.serviciosAutorizados) ?
      item.serviciosAutorizados : []).map((v) => String(v)))];
    if (!servicios.length || servicios.some((v) => !SERVICIOS_FIRMABLES.includes(v))) {
      const error = new Error('Seleccione servicios autorizados válidos para cada firma');
      error.statusCode = 422;
      throw error;
    }
    const tratamiento = String(item.tratamiento ?? '').trim();
    const siglaColegiatura = String(item.siglaColegiatura ?? '').trim();
    const siglaEspecialidad = String(item.siglaEspecialidad ?? '').trim();
    if (tratamiento.length > 18 || siglaColegiatura.length > 24 ||
        siglaEspecialidad.length > 24 || String(item.etiqueta ?? '').length > 80) {
      const error = new Error('Uno de los campos de presentación supera la longitud permitida');
      error.statusCode = 422;
      throw error;
    }
    presentaciones.push({
      perfilId,
      etiqueta: String(item.etiqueta || 'Firma profesional').trim(),
      tratamiento,
      profesionRecursoId: profesion._id,
      especialidadId,
      mostrarProfesion: item.mostrarProfesion !== false,
      mostrarEspecialidad: item.mostrarEspecialidad !== false,
      mostrarColegiatura: item.mostrarColegiatura !== false,
      mostrarRne: item.mostrarRne !== false,
      siglaColegiatura: siglaColegiatura || 'Colegiatura',
      siglaEspecialidad: siglaEspecialidad || 'RNE',
      serviciosAutorizados: servicios,
      esPrincipal: item.esPrincipal === true,
    });
  }
  if (habilitado && !presentaciones.length) {
    const error = new Error('Registre al menos una presentación de firma');
    error.statusCode = 422;
    throw error;
  }
  if (habilitado && presentaciones.filter((p) => p.esPrincipal).length !== 1) {
    const error = new Error('Seleccione exactamente una presentación principal');
    error.statusCode = 422;
    throw error;
  }
  return presentaciones;
};

// ====== Configurar habilitación y presentaciones de firma ======
const configurarFirmanteLaboratorio = async (req, res = response) => {
  try {
    const { codRecHumano } = req.params;
    const { habilitado, predeterminadoLaboratorio, referenciaAutorizacion } = req.body ?? {};
    if (typeof habilitado !== 'boolean') {
      return res.status(400).json({ ok: false, msg: 'habilitado debe ser booleano' });
    }
    const recurso = await RecurHumano.findOne({ codRecHumano });
    if (!recurso) return res.status(404).json({ ok: false, msg: 'Recurso humano no encontrado' });

    const anterior = recurso.firmaLaboratorio ?? {};
    const presentacionesEntrada = Array.isArray(req.body?.presentaciones)
      ? req.body.presentaciones
      : [{
          perfilId: 'legacy', etiqueta: 'Firma principal',
          profesionRecursoId: req.body?.profesionRecursoId,
          serviciosAutorizados: req.body?.serviciosAutorizados,
          esPrincipal: true,
        }];
    const presentaciones = habilitado
      ? await normalizarPresentacionesFirma(recurso, presentacionesEntrada, true)
      : (Array.isArray(anterior.presentaciones) ? anterior.presentaciones : []);
    const principal = presentaciones.find((item) => item.esPrincipal);
    const servicios = [...new Set(presentaciones.flatMap((item) => item.serviciosAutorizados))];
    const referencia = String(referenciaAutorizacion ?? '').trim();
    if (habilitado && (!referencia || referencia.length > 300)) {
      return res.status(422).json({ ok: false, msg: 'Registre la autorización expresa vigente' });
    }
    if (predeterminadoLaboratorio === true &&
        (!habilitado || !principal?.serviciosAutorizados.includes('Laboratorio'))) {
      return res.status(422).json({ ok: false,
        msg: 'La firma principal debe estar autorizada para Laboratorio' });
    }
    const ahora = new Date();
    recurso.firmaLaboratorio = {
      habilitado,
      profesionRecursoId: principal?.profesionRecursoId ?? anterior.profesionRecursoId ?? null,
      serviciosAutorizados: habilitado ? servicios : [],
      predeterminadoLaboratorio: habilitado && predeterminadoLaboratorio === true,
      referenciaAutorizacion: habilitado ? referencia : '',
      presentaciones,
      fechaActualizacion: ahora,
      actualizadoPor: req.user.uid,
      usuarioActualizacion: req.user.nombreUsuario ?? null,
    };
    recurso.updatedBy = req.user.uid;
    recurso.usuarioActualizacion = req.user.nombreUsuario ?? null;
    recurso.fechaActualizacion = ahora;
    if (habilitado && predeterminadoLaboratorio === true) {
      await RecurHumano.updateMany({ _id: { $ne: recurso._id },
        'firmaLaboratorio.predeterminadoLaboratorio': true }, {
        $set: { 'firmaLaboratorio.predeterminadoLaboratorio': false },
      });
    }
    await recurso.save();
    return res.json({ ok: true, msg: 'Configuración de firmas guardada',
      presentaciones: recurso.firmaLaboratorio.presentaciones,
      codRecHumano: recurso.codRecHumano });
  } catch (error) {
    console.error('Error configurando firmantes:', error);
    return res.status(error.statusCode ?? 500).json({ ok: false,
      msg: error.statusCode ? error.message : 'No se pudo configurar el firmante' });
  }
};

// ====== Cargar firma PNG transparente con permiso administrativo ======
const guardarImagenFirmaLaboratorio = async (req, res = response) => {
  try {
    const recurso = await RecurHumano.findOne({ codRecHumano: req.params.codRecHumano })
      .select("_id firmaLaboratorio codRecHumano");
    if (!recurso) return res.status(404).json({ ok: false, msg: "Recurso humano no encontrado" });
    if (!recurso.firmaLaboratorio?.habilitado ||
        !String(recurso.firmaLaboratorio.referenciaAutorizacion ?? "").trim()) {
      return res.status(409).json({ ok: false, msg: "Debe habilitar y documentar autorización antes de cargar la firma" });
    }
    const archivo = req.file?.buffer;
    if (!archivo || archivo.length < 40 || archivo.length > 300 * 1024 ||
        archivo.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        archivo.toString("ascii", 12, 16) !== "IHDR") {
      return res.status(422).json({ ok: false, msg: "Seleccione un PNG válido de máximo 300 KB" });
    }
    const ancho = archivo.readUInt32BE(16);
    const alto = archivo.readUInt32BE(20);
    const tipoColor = archivo[25];
    if (!ancho || ancho > 1600 || !alto || alto > 800 ||
        ![4, 6].includes(tipoColor)) {
      return res.status(422).json({ ok: false,
        msg: "La firma debe tener canal alfa transparente y dimensiones máximas 1600 x 800" });
    }
    const perfilId = String(req.body?.perfilId ?? 'legacy').trim();
    const presentaciones = recurso.firmaLaboratorio?.presentaciones ?? [];
    const existePerfil = presentaciones.some((p) => p.perfilId === perfilId) ||
      (perfilId === 'legacy' && presentaciones.length === 0);
    if (!existePerfil) return res.status(422).json({ ok: false,
      msg: 'Guarde primero la configuración del perfil de firma' });
    const hashSha256 = crypto.createHash('sha256').update(archivo).digest('hex');
    const registro = await FirmaProfesionalLaboratorio.findOne({ recursoHumanoId: recurso._id })
      .select('+imagen +imagenesPorPerfil');
    const firma = registro || new FirmaProfesionalLaboratorio({ recursoHumanoId: recurso._id,
      actualizadoPor: req.user.uid });
    if (perfilId === 'legacy') {
      firma.imagen = archivo;
      firma.hashSha256 = hashSha256;
    } else {
      const existentes = firma.imagenesPorPerfil ?? [];
      const existente = existentes.find((item) => item.perfilId === perfilId);
      if (existente) {
        existente.imagen = archivo;
        existente.hashSha256 = hashSha256;
        existente.fechaActualizacion = new Date();
      } else {
        existentes.push({ perfilId, imagen: archivo, hashSha256, fechaActualizacion: new Date() });
        firma.imagenesPorPerfil = existentes;
      }
    }
    firma.actualizadoPor = req.user.uid;
    firma.usuarioActualizacion = req.user.nombreUsuario ?? null;
    firma.fechaActualizacion = new Date();
    await firma.save();
    return res.json({ ok: true, msg: "Imagen de firma guardada", hashSha256 });
  } catch (error) {
    console.error("Error guardando imagen de firma:", error);
    return res.status(500).json({ ok: false, msg: "No se pudo guardar la imagen de firma" });
  }
};

// ====== Normalizar PNG almacenado por Mongoose / BSON ======
const obtenerBufferFirma = (imagen) => {
  if (Buffer.isBuffer(imagen)) return imagen;
  if (imagen?._bsontype === "Binary" && typeof imagen.value === "function") {
    return Buffer.from(imagen.value(true));
  }
  if (ArrayBuffer.isView(imagen)) {
    return Buffer.from(imagen.buffer, imagen.byteOffset, imagen.byteLength);
  }
  if (imagen?.type === "Buffer" && Array.isArray(imagen.data)) {
    return Buffer.from(imagen.data);
  }
  return null;
};

// ====== Vista privada de la firma para administración ======
const verImagenFirmaLaboratorio = async (req, res = response) => {
  try {
    const recurso = await RecurHumano.findOne({ codRecHumano: req.params.codRecHumano })
      .select("_id").lean();
    if (!recurso) {
      return res.status(404).json({ ok: false, codigo: "RECURSO_NO_ENCONTRADO",
        msg: "No se encontró el recurso humano" });
    }

    // ====== Obtener documento hidratado para conservar Buffer ======
    const perfilId = String(req.query?.perfilId ?? 'legacy').trim();
    const firma = await FirmaProfesionalLaboratorio.findOne({ recursoHumanoId: recurso._id })
      .select('+imagen +imagenesPorPerfil hashSha256');
    const seleccion = perfilId === 'legacy' ? null :
      firma?.imagenesPorPerfil?.find((item) => item.perfilId === perfilId);
    const imagenGuardada = perfilId === 'legacy' ? firma?.imagen : seleccion?.imagen;
    const hashGuardado = perfilId === 'legacy' ? firma?.hashSha256 : seleccion?.hashSha256;
    if (!imagenGuardada) {
      return res.status(404).json({ ok: false, codigo: "FIRMA_SIN_IMAGEN",
        msg: "El profesional no tiene una imagen de firma registrada" });
    }

    const imagen = obtenerBufferFirma(imagenGuardada);
    const esPng = imagen?.length >= 40 &&
      imagen.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" &&
      imagen.toString("ascii", 12, 16) === "IHDR";
    if (!esPng) {
      console.error("Firma PNG inválida para recurso", recurso._id);
      return res.status(422).json({ ok: false, codigo: "FIRMA_IMAGEN_INVALIDA",
        msg: "La imagen almacenada no contiene un PNG válido" });
    }

    const hashActual = crypto.createHash("sha256").update(imagen).digest("hex");
    if (hashGuardado && hashActual !== hashGuardado) {
      console.error("Integridad de firma no coincide para recurso", recurso._id);
      return res.status(422).json({ ok: false, codigo: "FIRMA_INTEGRIDAD_INVALIDA",
        msg: "La integridad de la imagen de firma no pudo verificarse" });
    }

    res.set({
      "Content-Type": "image/png",
      "Content-Length": String(imagen.length),
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    });
    return res.status(200).send(imagen);
  } catch (error) {
    console.error("Error consultando imagen de firma:", error);
    return res.status(500).json({ ok: false, codigo: "ERROR_RECUPERACION_FIRMA",
      msg: "No se pudo recuperar la firma desde MongoDB" });
  }
};

module.exports = {
  crearRecursoHumano,
  mostrarUltimosRecurHumanos,
  encontrarTermino,
  actualizarRecursoHumano,
  obtenerSolicitantes,
  obtenerProfesionalesQueAtiendenConsultas,
  obtenerProfesionalesConsultas,
  obtenerFirmantesLaboratorio,
  obtenerCandidatosFirmantesLaboratorio,
  configurarFirmanteLaboratorio,
  guardarImagenFirmaLaboratorio,
  verImagenFirmaLaboratorio,
};
