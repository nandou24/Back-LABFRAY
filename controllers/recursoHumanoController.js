const { response } = require("express");
const RecurHumano = require("../models/RecHumano");
const bcrypt = require("bcryptjs");
const { generarJWT } = require("../helpers/jwt");
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

  //Para crear HC
  const fecha = new Date();
  const anio = fecha.getFullYear();
  const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");

  try {
    //   console.log(name, email, password, rol, "holaaa");

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

    if (cantidad == 0) {
      recHumanos = await RecurHumano.find().populate("datosLogueo.rol").lean();
    } else {
      recHumanos = await RecurHumano.find()
        .populate("datosLogueo.rol")

        //.sort({createdAt: -1})
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

const encontrarTerminoSolicitante = async (req, res = response) => {
  const termino = req.query.search;

  if (!termino || termino.trim() === "") {
    return res.status(400).json({
      ok: false,
      msg: "Debe proporcionar un término de búsqueda válido",
    });
  }

  try {
    const regex = new RegExp(termino, "i");
    const palabras = termino.trim().split(/\s+/); // 🔹 Divide el término en palabras

    const recHumanos = await RecurHumano.find(
      {
        $and: [
          { esSolicitante: true },
          {
            $or: [
              { codRecHumano: regex },
              { nombreRecHumano: regex }, // Búsqueda en el campo "nombre"
              { apePatRecHumano: regex }, // Búsqueda en el campo "apellido paterno"
              { apeMatRecHumano: regex }, // Búsqueda en el campo "apellido materno"
              { "profesionSolicitante.nroColegiatura": regex }, // Búsqueda en el campo "nro documento"
              {
                $expr: {
                  $regexMatch: {
                    input: {
                      $concat: [
                        "$nombreRecHumano",
                        " ",
                        "$apePatRecHumano",
                        " ",
                        "$apeMatRecHumano",
                      ],
                    },
                    regex: regex,
                  },
                },
              },
              {
                $expr: {
                  $regexMatch: {
                    input: {
                      $concat: [
                        "$apePatRecHumano",
                        " ",
                        "$apeMatRecHumano",
                        " ",
                        "$nombreRecHumano",
                      ],
                    },
                    regex: regex,
                  },
                },
              },
              // Agrega más campos si es necesario
              // 🔹 Buscar si todas las palabras aparecen en diferentes campos
              ...palabras.map((palabra) => ({
                $or: [
                  { nombreRecHumano: { $regex: palabra, $options: "i" } },
                  { apePatRecHumano: { $regex: palabra, $options: "i" } },
                  { apeMatRecHumano: { $regex: palabra, $options: "i" } },
                ],
              })),
            ],
          },
        ],
      }, // Filtro
      {
        codRecHumano: 1,
        nombreRecHumano: 1,
        apePatRecHumano: 1,
        apeMatRecHumano: 1,
        profesionSolicitante: 1,
        especialidadesRecurso: 1,
      } // Solo los campos necesarios
    ).lean();

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
  delete datosActualizados._id; //quita los _id generados por el mongo y que no se pueden modificar
  delete datosActualizados.phones._id;
  delete datosActualizados.profesionesRecurso._id;
  delete datosActualizados.especialidadesRecurso._id;
  if (datosActualizados.profesionSolicitante) {
    delete datosActualizados.profesionSolicitante._id;
  }

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
      datosActualizados
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
  encontrarTerminoSolicitante,
};
