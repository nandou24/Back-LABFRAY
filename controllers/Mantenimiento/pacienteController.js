const { response } = require("express");
const Paciente = require("../../models/Mantenimiento/Paciente");
const Cotizacion = require("../../models/Gestion/CotizacionPaciente");
const mongoose = require("mongoose");

// ====== Normalización y validación de datos editables ======
const camposMaestro = new Set([
  'nombreCliente', 'apePatCliente', 'apeMatCliente', 'fechaNacimiento',
  'sexoCliente', 'departamentoCliente', 'provinciaCliente', 'distritoCliente',
  'direcCliente', 'mailCliente', 'phones',
]);
const documentoValido = (tipo, nro) => {
  const tipoDoc = String(tipo ?? '').trim().toUpperCase();
  const nroDoc = String(nro ?? '').trim().toUpperCase();
  const patrones = { DNI: /^\d{8}$/, CE: /^[A-Z0-9]{1,13}$/, PASAPORTE: /^[A-Z0-9]{1,16}$/ };
  if (!patrones[tipoDoc]?.test(nroDoc)) {
    const error = new Error('Ingrese un documento válido para el tipo seleccionado.');
    error.status = 400;
    throw error;
  }
  return { tipoDoc: tipoDoc === 'PASAPORTE' ? 'Pasaporte' : tipoDoc, nroDoc };
};
const errorValidacion = (mensaje) => {
  const error = new Error(mensaje);
  error.status = 400;
  throw error;
};
const textoSeguro = (valor) => String(valor ?? '').trim().replace(/\s+/g, ' ');
const esPresente = (obj, campo) => Object.prototype.hasOwnProperty.call(obj, campo);
const validarFecha = (valor, obligatoria = false) => {
  if (valor == null || valor === '') {
    if (obligatoria) errorValidacion('La fecha de nacimiento es obligatoria.');
    return null;
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime()) || fecha > new Date() || fecha < new Date('1900-01-01')) {
    errorValidacion('Fecha de nacimiento no válida.');
  }
  return fecha;
};
const datosLimpiosPaciente = (entrada) => {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    errorValidacion('Datos del paciente no válidos.');
  }
  const salida = {};
  for (const campo of camposMaestro) {
    if (!esPresente(entrada, campo)) continue;
    const valor = entrada[campo];
    if (['nombreCliente', 'apePatCliente', 'apeMatCliente'].includes(campo)) {
      const nombre = textoSeguro(valor).toUpperCase();
      if (nombre.length > 100 || (campo !== 'apeMatCliente' && !nombre) ||
          (nombre && !/^[\p{L}\s'’-]+$/u.test(nombre))) {
        errorValidacion('Revise los nombres y apellidos del paciente.');
      }
      salida[campo] = nombre;
    } else if (campo === 'fechaNacimiento') {
      salida[campo] = validarFecha(valor);
    } else if (campo === 'sexoCliente') {
      const sexo = textoSeguro(valor);
      if (sexo && !['Masculino', 'Femenino'].includes(sexo)) errorValidacion('Sexo no válido.');
      salida[campo] = sexo || null;
    } else if (['departamentoCliente', 'provinciaCliente', 'distritoCliente'].includes(campo)) {
      const codigo = textoSeguro(valor);
      if (codigo && !/^\d{2}$/.test(codigo)) errorValidacion('Seleccione una ubicación válida.');
      salida[campo] = codigo || null;
    } else if (campo === 'mailCliente') {
      const correo = textoSeguro(valor).toLowerCase();
      if (correo && (correo.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))) {
        errorValidacion('Correo electrónico no válido.');
      }
      salida[campo] = correo;
    } else if (campo === 'direcCliente') {
      const direccion = textoSeguro(valor);
      if (direccion.length > 250) errorValidacion('La dirección supera 250 caracteres.');
      salida[campo] = direccion;
    } else if (campo === 'phones') {
      if (!Array.isArray(valor) || valor.length > 20) errorValidacion('Lista de teléfonos no válida.');
      salida.phones = valor.map((telefono) => {
        const phoneNumber = textoSeguro(telefono?.phoneNumber);
        const descriptionPhone = textoSeguro(telefono?.descriptionPhone);
        if (!/^\d{9,11}$/.test(phoneNumber) || !descriptionPhone || descriptionPhone.length > 30) {
          errorValidacion('Revise los teléfonos ingresados.');
        }
        return { phoneNumber, descriptionPhone };
      });
    }
  }
  if (salida.distritoCliente && (!salida.provinciaCliente || !salida.departamentoCliente) &&
      esPresente(entrada, 'departamentoCliente') && esPresente(entrada, 'provinciaCliente')) {
    errorValidacion('Seleccione departamento y provincia para el distrito.');
  }
  return salida;
};
const serializarCambio = (valor) => {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (Array.isArray(valor)) {
    return JSON.stringify(valor.map(t => ({ phoneNumber: t.phoneNumber, descriptionPhone: t.descriptionPhone })));
  }
  return String(valor);
};
const leerCambios = (paciente, cambios) => Object.entries(cambios)
  .map(([campo, nuevo]) => {
    const anterior = serializarCambio(paciente[campo]);
    const siguiente = serializarCambio(nuevo);
    return anterior === siguiente ? null : { campo, valorAnterior: anterior, valorNuevo: siguiente };
  }).filter(Boolean);

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

  if (estadoIdentificacion !== 'REGISTRADA') {
    errorValidacion('El paciente maestro debe tener documento de identidad.');
  }
  const documento = documentoValido(datosPaciente?.tipoDoc, datosPaciente?.nroDoc);
  const datos = datosLimpiosPaciente(datosPaciente);
  const apePatCliente = datos.apePatCliente;
  if (!datos.nombreCliente || !apePatCliente) {
    errorValidacion('Nombres y apellido paterno son obligatorios.');
  }
  const duplicado = await Paciente.findOne({
    tipoDoc: { $regex: `^${documento.tipoDoc}$`, $options: 'i' }, nroDoc: documento.nroDoc,
  }).session(session).lean();
  if (duplicado) {
    const error = new Error('Ya existe un paciente con ese documento de identidad.');
    error.name = 'PacienteDuplicadoError';
    throw error;
  }

  // ==========================================
  // GENERAR HC
  // ==========================================

  const hc = await generarHistoriaClinica(apePatCliente, session);

  // ==========================================
  // CREAR PACIENTE
  // ==========================================

  const nuevoPaciente = new Paciente({
    ...datos,
    ...documento,
    hc,
    origenAlta: datosPaciente?.origenAlta === 'CAMPANA_EMPRESA' ? 'CAMPANA_EMPRESA' : 'GENERAL',
    estadoIdentificacion: 'REGISTRADA',
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

    // ====== Alta presencial: datos personales obligatorios ======
    if (!['Masculino', 'Femenino'].includes(req.body?.sexoCliente)) {
      errorValidacion('El sexo es obligatorio para el registro presencial.');
    }
    validarFecha(req.body?.fechaNacimiento, true);
    if (!/^\d{2}$/.test(String(req.body?.departamentoCliente ?? '')) ||
        !/^\d{2}$/.test(String(req.body?.provinciaCliente ?? ''))) {
      errorValidacion('Seleccione departamento y provincia.');
    }

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

    return res.status(error.status || (error.name === 'ValidationError' ? 400 : 500)).json({
      ok: false,
      msg: error.status ? error.message : 'Error al momento de registrar el paciente',
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

// ====== Edición del maestro con campos permitidos y auditoría ======
const actualizarPaciente = async (req, res = response) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      errorValidacion('Datos de actualización no válidos.');
    }
    const id = String(req.body?._id ?? '').trim();
    if (!mongoose.isValidObjectId(id)) errorValidacion('Paciente no válido.');
    const paciente = await Paciente.findById(id);
    if (!paciente) return res.status(404).json({ ok: false, msg: 'Paciente no encontrado.' });
    if ((esPresente(req.body, 'tipoDoc') && String(req.body.tipoDoc ?? '').trim().toUpperCase() !== String(paciente.tipoDoc ?? '').toUpperCase()) ||
        (esPresente(req.body, 'nroDoc') && String(req.body.nroDoc ?? '').trim() !== String(paciente.nroDoc ?? '').trim()) ||
        (esPresente(req.body, 'hc') && String(req.body.hc ?? '') !== String(paciente.hc ?? ''))) {
      return res.status(409).json({ ok: false, msg: 'El documento y la HC no se modifican desde este formulario.' });
    }
    const extrasPermitidos = new Set(['_id', 'tipoDoc', 'nroDoc', 'hc']);
    if (Object.keys(req.body).some(campo => !camposMaestro.has(campo) && !extrasPermitidos.has(campo))) {
      errorValidacion('Se enviaron campos no permitidos.');
    }
    const datos = datosLimpiosPaciente(req.body);
    if (!Object.keys(datos).length) errorValidacion('No hay datos para actualizar.');
    const diferencias = leerCambios(paciente, datos);
    if (!diferencias.length) return res.json({ ok: true, msg: 'No hay modificaciones.', sinCambios: true });
    for (const [campo, valor] of Object.entries(datos)) paciente.set(campo, valor);
    paciente.historialModificaciones.push({
      fecha: new Date(), uid: String(req.user.uid), nombreUsuario: req.user.nombreUsuario ?? null,
      origen: 'MANTENIMIENTO_PACIENTES', cambios: diferencias,
    });
    paciente.updatedBy = req.user.uid;
    paciente.usuarioActualizacion = req.user.nombreUsuario;
    paciente.fechaActualizacion = new Date();
    await paciente.save();
    return res.json({ ok: true, msg: 'Paciente actualizado.', cambios: diferencias.length });
  } catch (error) {
    if (!error.status) console.error('Error al actualizar paciente:', error);
    return res.status(error.status || (error.name === 'ValidationError' ? 400 : 500)).json({
      ok: false, msg: error.status ? error.message : 'No se pudo actualizar el paciente.',
    });
  }
};

// ====== Historial del maestro, solo lectura ======
const obtenerHistorialCambiosPaciente = async (req, res = response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, msg: 'Paciente no válido.' });
    }
    const paciente = await Paciente.findById(req.params.id)
      .select('hc historialModificaciones historialDocumentos').lean();
    if (!paciente) return res.status(404).json({ ok: false, msg: 'Paciente no encontrado.' });
    return res.json({ ok: true, hc: paciente.hc,
      historial: [...(paciente.historialModificaciones ?? [])].reverse().slice(0, 100),
      correccionesDocumentales: (paciente.historialDocumentos ?? []).map(c => ({
        fecha: c.fecha, tipoDocAnterior: c.tipoDoc, nroDocAnterior: c.nroDoc,
        tipoDocNuevo: c.tipoDocNuevo, nroDocNuevo: c.nroDocNuevo,
        tipoOperacion: c.tipoOperacion, uid: c.uid, nombreUsuario: c.nombreUsuario,
      })).reverse().slice(0, 100),
    });
  } catch (error) {
    console.error('Error al leer historial de paciente:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo consultar el historial.' });
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
  obtenerHistorialCambiosPaciente,
  actualizarDatosComplementarios,
  encontrarTerminoCotizaicon,
  mostrarUltimosPacientesCotizacion,
  encontrarTerminoporId,
  generarHistoriaClinica,
  registrarPaciente,
};
