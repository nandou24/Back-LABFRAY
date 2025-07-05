const { response } = require("express");
const Profesion = require("../../models/Profesiones");

const crearProfesion = async (req, res = response) => {
  //debemos generar un número de historia clínica año-mes-correlativo-inicial de ape pater - inicial ape mat
  const profesion = req.body;

  const nombreProfesion = profesion.nombreProfesion.toUpperCase();
  //   //Para crear HC
  //   const fecha = new Date();
  //   const anio = fecha.getFullYear();
  //   const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");

  try {
    // verificar el email si es que existe
    const profesionBuscada = await Profesion.findOne({ nombreProfesion });

    if (profesionBuscada) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una profesión con ese nombre",
      });
    }

    //creando codigo
    // Buscar el último recursoHumano creado
    const ultimaProfesion = await Profesion.findOne({}, { codProfesion: 1 })
      .sort({ codProfesion: -1 })
      .lean();

    // Obtener el correlativo
    let correlativo = 1;

    if (ultimaProfesion) {
      const ultimoCorrelativo = parseInt(ultimaProfesion.codProfesion, 10);
      correlativo = ultimoCorrelativo + 1;
    }

    // Crear el número de historia clínica sin guiones
    const codigo = `${String(correlativo).padStart(3, "0")}`;

    // Crear el paciente con el número de historia clínica
    // Crear usuario con el modelo
    const nuevaProfesion = new Profesion({
      ...profesion,
      codProfesion: codigo, // Agregar el código generado
    });

    await nuevaProfesion.save();
    // console.log(dbUser, "pasoo registro");
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      //uid: nuevaProfesion.id,
      //token: token,
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

    // Verificar si otra ruta ya tiene esa url
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

// Eliminar una ruta
const eliminarProfesion = async (req, res) => {
  try {
    const { codProfesion } = req.params;
    const eliminada = await Profesion.findOneAndDelete({ codProfesion });
    if (!eliminada) {
      return res
        .status(404)
        .json({ ok: false, msg: "Profesión no encontrada" });
    }
    res.json({ ok: true, msg: "Profesión eliminada" });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al eliminar la Profesión", error });
  }
};

// Listar todas las profeisiones
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
