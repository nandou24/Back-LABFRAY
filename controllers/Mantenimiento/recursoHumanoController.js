const { response } = require("express");
const RecurHumano = require("../../models/Mantenimiento/RecHumano");
const bcrypt = require("bcryptjs");
const { generarJWT } = require("../../helpers/jwt");
const jwt = require("jsonwebtoken");

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
      ...req.body,
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
  const datosActualizados = req.body; //recupera los datos a grabar
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

module.exports = {
  crearRecursoHumano,
  mostrarUltimosRecurHumanos,
  encontrarTermino,
  actualizarRecursoHumano,
  obtenerSolicitantes,
  obtenerProfesionalesQueAtiendenConsultas,
  obtenerProfesionalesConsultas,
};
