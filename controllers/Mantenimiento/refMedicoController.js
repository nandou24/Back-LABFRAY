const { response } = require("express");
const RefMedico = require("../../models/RefMedico");

const crearRefMedico = async (req, res = response) => {
  try {
    const { tipoDoc, nroDoc } = req.body;
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
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);
    let refMedicos;
    const campos =
      "apePatRefMedico apeMatRefMedico nombreRefMedico especialidadesRefMedico profesionSolicitante _id";
    if (cantidad == 0) {
      refMedicos = await RefMedico.find({}, campos);
    } else {
      refMedicos = await RefMedico.find({}, campos).limit(limite);
    }

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
// const mostrarUltimosRefMedicosParaCotizacion = async (req, res = response) => {

//   try {
//     const cantidad = req.query.cant;
//     const limite = parseInt(cantidad);
//     let refMedicos;
//     if (cantidad == 0) {
//       refMedicos = await RefMedico.find();
//     } else {
//       refMedicos = await RefMedico.find().limit(limite);
//     }
//     return res.json({
//       ok: true,
//       refMedicos,
//     });
//   } catch (error) {
//     console.log(error);
//     return res.status(500).json({
//       ok: false,
//       msg: "Error en la consulta",
//     });
//   }
// };

const encontrarTerminoRefMedico = async (req, res = response) => {
  const termino = req.query.search;
  try {
    const refMedicos = await RefMedico.find({
      $or: [
        { nombreRefMedico: { $regex: termino, $options: "i" } },
        { apePatRefMedico: { $regex: termino, $options: "i" } },
        { apeMatRefMedico: { $regex: termino, $options: "i" } },
        { nroDoc: { $regex: termino, $options: "i" } },
      ],
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

const actualizarRefMedico = async (req, res = response) => {
  const codigo = req.params.codRefMedico;
  const datosActualizados = req.body;
  delete datosActualizados._id;
  if (datosActualizados.phones) delete datosActualizados.phones._id;
  if (datosActualizados.profesionesRefMedico)
    delete datosActualizados.profesionesRefMedico._id;
  if (datosActualizados.especialidadesRefMedico)
    delete datosActualizados.especialidadesRefMedico._id;
  if (datosActualizados.profesionSolicitante)
    delete datosActualizados.profesionSolicitante._id;
  try {
    const refMedico = await RefMedico.findOneAndUpdate(
      { codRefMedico: codigo },
      datosActualizados
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
};
