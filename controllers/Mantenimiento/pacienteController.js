const { response } = require("express");
const Paciente = require("../../models/Mantenimiento/Paciente");
const Cotizacion = require("../../models/CotizacionPaciente");
const mongoose = require("mongoose");

const crearPaciente = async (req, res = response) => {
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
  } = req.body;

  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  //Para crear HC
  const fecha = new Date();
  const anio = fecha.getFullYear();
  const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");

  try {
    //   console.log(name, email, password, rol, "holaaa");

    // verificar el email si es que existe
    const paciente = await Paciente.findOne({ tipoDoc, nroDoc });

    if (paciente) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un usuario con ese documento de identidad",
      });
    }

    //creando codigo HC
    // Buscar el último paciente creado en el año actual
    const ultimoPaciente = await Paciente.findOne({
      hc: new RegExp(`^${anio}${mes}`),
    }).sort({ hc: -1 });

    // Obtener el correlativo
    let correlativo = 1;
    if (ultimoPaciente) {
      const ultimoCorrelativo = parseInt(ultimoPaciente.hc.slice(7, 11));
      correlativo = ultimoCorrelativo + 1;
    }

    // Correlativo con seis dígitos, maximo 999 999
    const correlativoStr = correlativo.toString().padStart(4, "0");

    // Generar las iniciales de los apellidos
    const inicialApePat = apePatCliente.charAt(0).toUpperCase();
    const inicialApeMat = apeMatCliente.charAt(0).toUpperCase();

    // Crear el número de historia clínica sin guiones
    const historiaClinica = `${anio}${mes}-${correlativoStr}${inicialApePat}${inicialApeMat}`;

    // Crear el paciente con el número de historia clínica
    // Crear usuario con el modelo
    const nuevoPaciente = new Paciente({
      ...req.body,
      hc: historiaClinica, // Agregar el número de historia clínica generado
      createdBy: uid, // uid del usuario que creó el paciente
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó el paciente
      fechaRegistro: new Date(), // Fecha de registro
    });

    //console.log(nuevoPaciente, "nuevo paciente");

    await nuevoPaciente.save();
    // console.log(dbUser, "pasoo registro");
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      uid: nuevoPaciente.id,
      //token: token,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimosPacientes = async (req, res = response) => {
  try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);

    const pacientes = await Paciente.find()
      .sort({ createdAt: -1 })
      .limit(limite);

    return res.json({
      ok: true,
      pacientes,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const mostrarUltimosPacientesCotizacion = async (req, res = response) => {
  try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);

    const pacientes = await Paciente.find(
      {}, // Filtro
      {
        hc: 1,
        nombreCliente: 1,
        apePatCliente: 1,
        apeMatCliente: 1,
        tipoDoc: 1,
        nroDoc: 1,
      } // Solo los campos necesarios
    )
      .sort({ createdAt: -1 })
      .limit(limite)
      .lean();

    return res.json({
      ok: true,
      pacientes,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTermino = async (req, res = response) => {
  const termino = req.query.search;

  if (!termino || termino.trim() === "") {
    return res.status(400).json({
      ok: false,
      msg: "Debe proporcionar un término de búsqueda válido",
    });
  }

  try {
    const regex = new RegExp(termino, "i");
    const pacientes = await Paciente.find({
      //nroDoc: { $regex: termino, $options: 'i'}

      $or: [
        { nombreCliente: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nombre"
        { apePatCliente: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "apellido paterno"
        { apeMatCliente: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "apellido materno"
        { nroDoc: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nro documento"
        {
          $expr: {
            $regexMatch: {
              input: {
                $concat: [
                  "$apePatCliente",
                  " ",
                  "$apeMatCliente",
                  " ",
                  "$nombreCliente",
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
                  "$nombreCliente",
                  " ",
                  "$apePatCliente",
                  " ",
                  "$apeMatCliente",
                ],
              },
              regex: regex,
            },
          },
        },

        // Agrega más campos si es necesario
      ],
    });
    return res.json({
      ok: true,
      pacientes, //! favoritos: favoritos
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTerminoporId = async (req, res = response) => {
  const id = req.query.search;

  //console.log("ID de paciente buscado:", id);

  if (!id) {
    return res.status(400).json({
      ok: false,
      msg: "Debe proporcionar un ID de paciente válido",
    });
  }

  try {
    const paciente = await Paciente.findById(id, {
      fechaNacimiento: 1,
      sexoCliente: 1,
    });
    // const paciente = await Paciente.findById(id);
    if (!paciente) {
      return res.status(404).json({
        ok: false,
        msg: "Paciente no encontrado",
      });
    }
    console.log("Paciente encontrado:", paciente);
    return res.json({
      ok: true,
      paciente,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTerminoCotizaicon = async (req, res = response) => {
  const termino = req.query.search;

  if (!termino || termino.trim() === "") {
    return res.status(400).json({
      ok: false,
      msg: "Debe proporcionar un término de búsqueda válido",
    });
  }

  try {
    const regex = new RegExp(termino, "i");
    const pacientes = await Paciente.find(
      {
        //nroDoc: { $regex: termino, $options: 'i'}

        $or: [
          { nombreCliente: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nombre"
          { apePatCliente: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "apellido paterno"
          { apeMatCliente: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "apellido materno"
          { nroDoc: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nro documento"
          {
            $expr: {
              $regexMatch: {
                input: {
                  $concat: [
                    "$apePatCliente",
                    " ",
                    "$apeMatCliente",
                    " ",
                    "$nombreCliente",
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
                    "$nombreCliente",
                    " ",
                    "$apePatCliente",
                    " ",
                    "$apeMatCliente",
                  ],
                },
                regex: regex,
              },
            },
          },

          // Agrega más campos si es necesario
        ],
      },
      {
        hc: 1,
        nombreCliente: 1,
        apePatCliente: 1,
        apeMatCliente: 1,
        tipoDoc: 1,
        nroDoc: 1,
      }
    ).lean();
    return res.json({
      ok: true,
      pacientes, //! favoritos: favoritos
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const actualizarPaciente = async (req, res = response) => {
  const { tipoDoc, nroDoc, ...datosActualizables } = req.body;
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
  console.log("Datos a actualizar:", datosActualizables);

  try {
    const paciente = await Paciente.findOneAndUpdate(
      { _id: datosActualizables._id },
      {
        $set: datosActualizables,
        updatedBy: uid, // uid del usuario que actualiza el paciente
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza el paciente
        fechaActualizacion: new Date(), // Fecha de actualización
      }
    );

    if (!paciente) {
      return res.status(404).json({
        ok: false,
        msg: "Paciente no encontrado con ese número de historia",
      });
    }

    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.error("Error al actualizar el paciente: ", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};

const registrarPacienteSinnHC = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const tipoDoc = req.body.tipoDoc;
    const nroDoc = req.body.nroDoc;
    const apePatCliente = req.body.apePatCliente || "";
    const apeMatCliente = req.body.apeMatCliente || "";
    const nombreCliente = req.body.nombreCliente || ""; // Asegurarse de que no sea undefined

    const paciente = await Paciente.findOne({ tipoDoc, nroDoc });

    if (paciente) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un usuario con ese documento de identidad",
      });
    }

    //Para crear HC
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");

    //creando codigo HC
    // Buscar el último paciente creado en el año actual
    const ultimoPaciente = await Paciente.findOne({
      hc: new RegExp(`^${anio}${mes}`),
    }).sort({ hc: -1 });

    // Obtener el correlativo
    let correlativo = 1;
    if (ultimoPaciente) {
      const ultimoCorrelativo = parseInt(ultimoPaciente.hc.slice(7, 11));
      correlativo = ultimoCorrelativo + 1;
    }

    // Correlativo con seis dígitos, maximo 999 999
    const correlativoStr = correlativo.toString().padStart(4, "0");

    // Generar las iniciales de los apellidos
    const inicialApePat = apePatCliente.charAt(0).toUpperCase();
    const inicialApeMat = apeMatCliente.charAt(0).toUpperCase();

    // Crear el número de historia clínica sin guiones
    const historiaClinica = `${anio}${mes}-${correlativoStr}${inicialApePat}${inicialApeMat}`;

    const nuevoPaciente = new Paciente({
      ...req.body,
      hc: historiaClinica, // Agregar el número de historia clínica generado
    });

    await nuevoPaciente.save({ session });

    // Obtener el código de cotización desde el body o req
    const codCotizacion = req.body.codCotizacion;

    // Buscar la cotización y actualizar el último historial
    const cotizacion = await Cotizacion.findOne({ codCotizacion }).session(
      session
    );

    if (!cotizacion) {
      throw new Error("Cotización no encontrada");
    }

    if (!cotizacion.historial || cotizacion.historial.length === 0) {
      throw new Error("La cotización no tiene historial");
    }

    // Obtener el índice del último historial
    const lastIndex = cotizacion.historial.length - 1;

    // Actualizar la hc en el último historial
    cotizacion.historial[lastIndex].hc = historiaClinica;
    cotizacion.historial[lastIndex].tipoDoc = tipoDoc;
    cotizacion.historial[lastIndex].nroDoc = nroDoc;
    cotizacion.historial[lastIndex].nombreCompleto =
      apePatCliente + " " + apeMatCliente + " " + nombreCliente;

    // No es necesario crear una nueva cotización, solo actualizar la existente
    // Ya se actualizó el campo hc en el historial correspondiente arriba
    // Guardar la cotización actualizada
    await cotizacion.save({ session }); //actualizará porq viene después de un cotizacion.findone

    await session.commitTransaction();
    session.endSession();

    return res.json({
      ok: true,
      msg: "Paciente registrado y cotización actualizada.",
      hc: historiaClinica,
      paciente: nuevoPaciente,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

module.exports = {
  crearPaciente,
  mostrarUltimosPacientes,
  encontrarTermino,
  actualizarPaciente,
  encontrarTerminoCotizaicon,
  mostrarUltimosPacientesCotizacion,
  registrarPacienteSinnHC,
  encontrarTerminoporId,
};
