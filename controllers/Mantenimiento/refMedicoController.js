const { response } = require("express");
const RefMedico = require("../../models/Mantenimiento/RefMedico");

const crearRefMedico = async (req, res = response) => {
  try {
    const { tipoDoc, nroDoc } = req.body;
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
    // Verificar si ya existe
    const refMedico = await RefMedico.findOne({ tipoDoc, nroDoc });
    if (refMedico) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un médico referente con ese documento de identidad",
      });
    }
    // Buscar el último código generado
    const ultimoRefMedico = await RefMedico.findOne({}, { codRefMedico: 1 })
      .sort({ codRefMedico: -1 })
      .lean();
    let correlativo = 1;
    if (ultimoRefMedico) {
      const ultimoCorrelativo = parseInt(
        ultimoRefMedico.codRefMedico.substring(2),
        10
      );
      correlativo = ultimoCorrelativo + 1;
    }
    const codigo = `RM${String(correlativo).padStart(4, "0")}`;
    const nuevoRefMedico = new RefMedico({
      ...req.body,
      codRefMedico: codigo,
      createdBy: uid, // uid del usuario que creó el médico referente
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó el médico referente
      fechaRegistro: new Date(), // Fecha de registro
    });
    await nuevoRefMedico.save();
    return res.status(201).json({
      ok: true,
      uid: nuevoRefMedico.id,
    });
  } catch (error) {
    console.error("❌ Error al registrar el médico referente:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimosRefMedicos = async (req, res = response) => {
  try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);
    let refMedicos;
    if (cantidad == 0) {
      refMedicos = await RefMedico.find();
    } else {
      refMedicos = await RefMedico.find().limit(limite);
    }
    return res.json({
      ok: true,
      refMedicos,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const mostrarUltimosRefMedicosParaCotizacion = async (req, res = response) => {
  try {
    let refMedicos;
    const campos =
      "apePatRefMedico apeMatRefMedico nombreRefMedico profesionesRefMedico _id";

    refMedicos = await RefMedico.find({}, campos)
      .populate({
        path: "profesionesRefMedico.profesionRef",
        select: "nombreProfesion", // Ajusta según tu modelo real
      })
      .populate({
        path: "profesionesRefMedico.especialidades.especialidadRef",
        select: "nombreEspecialidad", // Ajusta según tu modelo real
      });

    console.log("RefMedicos encontrados:", refMedicos);

    return res.json({
      ok: true,
      refMedicos,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTerminoRefMedico = async (req, res = response) => {
  const termino = req.query.search;
  try {
    let refMedicos = await RefMedico.find({
      $or: [
        { nombreRefMedico: { $regex: termino, $options: "i" } },
        { apePatRefMedico: { $regex: termino, $options: "i" } },
        { apeMatRefMedico: { $regex: termino, $options: "i" } },
        { nroDoc: { $regex: termino, $options: "i" } },
      ],
    });

    // Extraer especialidades como string
    refMedicos = refMedicos.map((medico) => {
      let especialidades = "";
      if (Array.isArray(medico.especialidadesRefMedico)) {
        especialidades = medico.especialidadesRefMedico
          .map((esp) => esp.especialidad)
          .filter(Boolean)
          .join(", ");
      }
      return {
        ...medico._doc,
        especialidades: especialidades,
      };
    });

    return res.json({
      ok: true,
      refMedicos,
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

  if (!id) {
    return res.status(400).json({
      ok: false,
      msg: "Debe proporcionar un ID del solicitante válido",
    });
  }

  try {
    const solicitante = await RefMedico.findById(id, {
      apePatRefMedico: 1,
      apeMatRefMedico: 1,
      nombreRefMedico: 1,
    });
    // const paciente = await Paciente.findById(id);
    if (!solicitante) {
      return res.status(404).json({
        ok: false,
        msg: "Solicitante no encontrado",
      });
    }
    console.log("Solicitante encontrado:", solicitante);
    return res.json({
      ok: true,
      solicitante,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const actualizarRefMedico = async (req, res = response) => {
  const referenciId = req.params._id;
  const codigo = req.params.codRefMedico;
  const datosActualizados = req.body;
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  const tipoDoc = datosActualizados.tipoDoc;
  const nroDoc = datosActualizados.nroDoc;

  const existeRefMedico = await RefMedico.findOne({
    tipoDoc,
    nroDoc,
    codRefMedico: { $ne: codigo },
  });
  if (existeRefMedico) {
    return res.status(400).json({
      ok: false,
      msg: "Ya existe un médico referente con ese documento",
    });
  }

  try {
    const refMedico = await RefMedico.findOneAndUpdate(
      { codRefMedico: codigo },
      { 
        $set: datosActualizados,
        updatedBy: uid, // uid del usuario que actualiza
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true }
    );
    if (!refMedico) {
      return res.status(404).json({
        ok: false,
        msg: "Médico referente no encontrado con ese código",
      });
    }
    return res.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.error("Error al actualizar el médico referente: ", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};

module.exports = {
  crearRefMedico,
  mostrarUltimosRefMedicos,
  encontrarTerminoRefMedico,
  actualizarRefMedico,
  mostrarUltimosRefMedicosParaCotizacion,
  encontrarTerminoporId,
};
