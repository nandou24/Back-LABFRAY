const { response } = require("express");
const Paciente = require("../../models/Mantenimiento/Paciente");
const Cotizacion = require("../../models/Gestion/CotizacionPaciente");
const mongoose = require("mongoose");

// ==========================================
// GENERAR HISTORIA CLÍNICA
// ==========================================

const generarHistoriaClinica = async (apePatCliente, session) => {
  if (!session) {
    throw new Error(
      "Se requiere una sesión de MongoDB para generar la historia clínica",
    );
  }

  if (!apePatCliente) {
    throw new Error(
      "El apellido paterno es obligatorio para generar la historia clínica",
    );
  }

  const fecha = new Date();
  const anio = fecha.getFullYear();
  const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");
  const prefijo = `${anio}${mes}-`;
  const ultimoPaciente = await Paciente.findOne({
    hc: {
      $regex: `^${prefijo}`,
    },
  })
    .sort({
      hc: -1,
    })
    .session(session)
    .lean();

  let correlativo = 1;

  if (ultimoPaciente?.hc) {
    const partes = ultimoPaciente.hc.split("-");

    if (partes.length > 1) {
      const ultimoCorrelativo = parseInt(partes[1].substring(0, 4), 10);

      if (!Number.isNaN(ultimoCorrelativo)) {
        correlativo = ultimoCorrelativo + 1;
      }
    }
  }

  const correlativoStr = correlativo.toString().padStart(4, "0");
  const inicialApePat = apePatCliente.charAt(0).toUpperCase();

  return `${anio}${mes}-${correlativoStr}${inicialApePat}`;
};

// ==========================================
// REGISTRAR PACIENTE CON HC
// ==========================================

const registrarPaciente = async ({
  datosPaciente,
  estadoIdentificacion,
  session,
  uid,
  nombreUsuario,
}) => {
  if (!session) {
    throw new Error(
      "Se requiere una sesión de MongoDB para registrar al paciente",
    );
  }

  if (!["PENDIENTE", "REGISTRADA"].includes(estadoIdentificacion)) {
    throw new Error("Estado de identificación del paciente no válido");
  }

  const { tipoDoc, nroDoc, apePatCliente } = datosPaciente;

  // ==========================================
  // VALIDAR DOCUMENTO CUANDO EXISTE
  // ==========================================

  if (tipoDoc && nroDoc) {
    const pacienteExistente = await Paciente.findOne({
      tipoDoc,
      nroDoc,
    })
      .session(session)
      .lean();

    if (pacienteExistente) {
      const error = new Error(
        "Ya existe un paciente con ese documento de identidad",
      );

      error.name = "PacienteDuplicadoError";

      throw error;
    }
  }

  // ==========================================
  // GENERAR HC
  // ==========================================

  const hc = await generarHistoriaClinica(apePatCliente, session);

  // ==========================================
  // CREAR PACIENTE
  // ==========================================

  const nuevoPaciente = new Paciente({
    ...datosPaciente,
    hc,
    estadoIdentificacion,
    createdBy: uid,
    usuarioRegistro: nombreUsuario,
    fechaRegistro: new Date(),
  });

  await nuevoPaciente.save({
    session,
  });

  return nuevoPaciente;
};

const crearPaciente = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { uid, nombreUsuario } = req.user;

    // ==========================================
    // REGISTRAR PACIENTE
    // ==========================================

    const nuevoPaciente = await registrarPaciente({
      datosPaciente: req.body,

      estadoIdentificacion: "REGISTRADA",

      session,
      uid,
      nombreUsuario,
    });

    // ==========================================
    // CONFIRMAR TRANSACCIÓN
    // ==========================================

    await session.commitTransaction();

    return res.status(201).json({
      ok: true,
      uid: nuevoPaciente.id,

      paciente: nuevoPaciente,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    // ==========================================
    // PACIENTE DUPLICADO
    // ==========================================

    if (error.name === "PacienteDuplicadoError") {
      return res.status(409).json({
        ok: false,
        msg: error.message,
      });
    }

    console.error("Error al registrar paciente:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar el paciente",
    });
  } finally {
    await session.endSession();
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
      }, // Solo los campos necesarios
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
      phones: 1,
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
      },
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
  // ====== Impedir cambio del estado de identificación por edición genérica ======
  delete datosActualizables.estadoIdentificacion;
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
      },
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

// ====== Actualizar datos complementarios sin alterar identidad ======
const actualizarDatosComplementarios = async (req, res = response) => {
  try {
    const pacienteId = String(req.params?.id ?? "").trim();
    if (!mongoose.Types.ObjectId.isValid(pacienteId)) {
      return res.status(400).json({ ok: false, msg: "ID de paciente no válido" });
    }

    const datos = req.body;
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
      return res.status(400).json({ ok: false, msg: "Datos complementarios no válidos" });
    }

    const camposPermitidos = new Set(["sexoCliente", "fechaNacimiento", "phones"]);
    const campos = Object.keys(datos);
    if (!campos.length || campos.some((campo) => !camposPermitidos.has(campo))) {
      return res.status(400).json({
        ok: false,
        msg: "Solo se pueden actualizar sexo, fecha de nacimiento y teléfonos",
      });
    }

    const cambios = {};

    if (Object.prototype.hasOwnProperty.call(datos, "sexoCliente")) {
      const sexo = datos.sexoCliente == null || datos.sexoCliente === ""
        ? null : String(datos.sexoCliente).trim();
      if (sexo !== null && !["Masculino", "Femenino"].includes(sexo)) {
        return res.status(400).json({ ok: false, msg: "Sexo del paciente no válido" });
      }
      cambios.sexoCliente = sexo;
    }

    if (Object.prototype.hasOwnProperty.call(datos, "fechaNacimiento")) {
      const valor = datos.fechaNacimiento;
      if (valor == null || valor === "") {
        cambios.fechaNacimiento = null;
      } else {
        if (typeof valor !== "string" && !(valor instanceof Date)) {
          return res.status(400).json({ ok: false, msg: "Fecha de nacimiento no válida" });
        }
        const fecha = new Date(valor);
        if (Number.isNaN(fecha.getTime()) || fecha > new Date()) {
          return res.status(400).json({ ok: false, msg: "Fecha de nacimiento no válida" });
        }
        cambios.fechaNacimiento = fecha;
      }
    }

    if (Object.prototype.hasOwnProperty.call(datos, "phones")) {
      if (!Array.isArray(datos.phones) || datos.phones.length > 20 ||
          datos.phones.some((telefono) =>
            !telefono || typeof telefono !== "object" || Array.isArray(telefono) ||
            typeof telefono.phoneNumber !== "string" || !telefono.phoneNumber.trim() ||
            typeof telefono.descriptionPhone !== "string" || !telefono.descriptionPhone.trim())) {
        return res.status(400).json({ ok: false, msg: "Teléfonos del paciente no válidos" });
      }
      cambios.phones = datos.phones.map((telefono) => ({
        phoneNumber: telefono.phoneNumber.trim(),
        descriptionPhone: telefono.descriptionPhone.trim(),
      }));
    }

    const paciente = await Paciente.findByIdAndUpdate(
      pacienteId,
      { $set: {
        ...cambios,
        updatedBy: req.user.uid,
        usuarioActualizacion: req.user.nombreUsuario,
        fechaActualizacion: new Date(),
      } },
      { new: true, runValidators: true },
    );

    if (!paciente) {
      return res.status(404).json({ ok: false, msg: "Paciente no encontrado" });
    }

    return res.json({ ok: true, paciente });
  } catch (error) {
    console.error("Error al actualizar datos complementarios:", error);
    return res.status(error.name === "ValidationError" ? 400 : 500).json({
      ok: false,
      msg: "No se pudieron actualizar los datos complementarios",
    });
  }
};

module.exports = {
  crearPaciente,
  mostrarUltimosPacientes,
  encontrarTermino,
  actualizarPaciente,
  actualizarDatosComplementarios,
  encontrarTerminoCotizaicon,
  mostrarUltimosPacientesCotizacion,
  encontrarTerminoporId,
  generarHistoriaClinica,
  registrarPaciente,
};
