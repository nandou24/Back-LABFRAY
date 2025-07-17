const { response } = require("express");
const Profesion = require("../../models/Profesiones");

const crearProfesion = async (req, res = response) => {
  const profesion = req.body;
  const nombreProfesion = profesion.nombreProfesion.toUpperCase();

  try {
    // verificar si ya existe una profesión con ese nombre
    const profesionBuscada = await Profesion.findOne({ nombreProfesion });

    if (profesionBuscada) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una profesión con ese nombre",
      });
    }

    //creando codigo
    // Buscar el última profesión creado
    const ultimaProfesion = await Profesion.findOne({}, { codProfesion: 1 })
      .sort({ codProfesion: -1 })
      .lean();

    // Obtener el correlativo
    let correlativo = 1;

    if (ultimaProfesion) {
      const ultimoCorrelativo = parseInt(ultimaProfesion.codProfesion, 10);
      correlativo = ultimoCorrelativo + 1;
    }

    const codigo = `${String(correlativo).padStart(3, "0")}`;

    const nuevaProfesion = new Profesion({
      ...profesion,
      codProfesion: codigo, // Agregar el código generado
    });

    await nuevaProfesion.save();
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.error("❌ Error al registrar la profesión:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const actualizarProfesion = async (req, res) => {
  try {
    const { codProfesion, nombreProfesion } = req.params;

    const datosActualizados = req.body;

    const existeProfesion = await Profesion.findOne({
      nombreProfesion,
      codProfesion: { $ne: codProfesion },
    });
    if (existeProfesion) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una profesion con ese nombre",
      });
    }

    const actualizada = await Profesion.findOneAndUpdate(
      { codProfesion },
      { $set: datosActualizados }
    );

    if (!actualizada) {
      return res
        .status(404)
        .json({ ok: false, msg: "Código de profesión no encontrado" });
    }
    res.json({ ok: true, profesion: actualizada });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al actualizar la profesion", error });
  }
};

const eliminarProfesion = async (req, res) => {
  try {
    const { codProfesion } = req.params;
    const eliminada = await Profesion.findOneAndDelete({ codProfesion });
    if (!eliminada) {
      return res
        .status(404)
        .json({ ok: false, msg: "Profesión no encontrada" });
    }
    res.json({ ok: true, msg: "RuProfesiónta eliminada" });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al eliminar la Profesión", error });
  }
};

const listarProfesion = async (req, res) => {
  try {
    const profesiones = await Profesion.find();
    res.json({ ok: true, profesiones });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al listar las profesiones", error });
  }
};

// Buscar profesión por término
const buscarProfesion = async (req, res) => {
  try {
    const termino = req.query.search || "";
    const profesiones = await Profesion.find({
      $or: [{ nombreProfesion: { $regex: termino, $options: "i" } }],
    });
    res.json({ ok: true, profesiones });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al buscar profesiones", error });
  }
};

module.exports = {
  crearProfesion,
  actualizarProfesion,
  eliminarProfesion,
  listarProfesion,
  buscarProfesion,
};
