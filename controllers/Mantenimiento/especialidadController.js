const { response } = require("express");
const Especialidad = require("../../models/Especialidades");

const crearEspecialidad = async (req, res = response) => {
  //debemos generar un número de historia clínica año-mes-correlativo-inicial de ape pater - inicial ape mat
  const especialidad = req.body;

  const nombreEspecialidad = especialidad.nombreEspecialidad.toUpperCase();
  //   //Para crear HC
  //   const fecha = new Date();
  //   const anio = fecha.getFullYear();
  //   const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");

  try {
    // verificar el email si es que existe
    const especialidadBuscada = await Especialidad.findOne({
      nombreEspecialidad,
    });

    if (especialidadBuscada) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una especialidad con ese nombre",
      });
    }

    //creando codigo
    // Buscar el último recursoHumano creado
    const ultimaEspecialidad = await Especialidad.findOne(
      {},
      { codEspecialidad: 1 }
    )
      .sort({ codEspecialidad: -1 })
      .lean();

    // Obtener el correlativo
    let correlativo = 1;

    if (ultimaEspecialidad) {
      const ultimoCorrelativo = parseInt(
        ultimaEspecialidad.codEspecialidad,
        10
      );
      correlativo = ultimoCorrelativo + 1;
    }

    // Crear el número de historia clínica sin guiones
    const codigo = `${String(correlativo).padStart(3, "0")}`;

    // Crear el paciente con el número de historia clínica
    // Crear usuario con el modelo
    const nuevaEspecialidad = new Especialidad({
      ...especialidad,
      codEspecialidad: codigo, // Agregar el código generado
    });

    await nuevaEspecialidad.save();
    // console.log(dbUser, "pasoo registro");
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

const actualizarEspecialidad = async (req, res) => {
  try {
    const { codEspecialidad, nombreEspecialidad } = req.params;

    const datosActualizados = req.body;

    // Verificar si otra ruta ya tiene esa url
    const existeEspecialidad = await Especialidad.findOne({
      nombreEspecialidad,
      codEspecialidad: { $ne: codEspecialidad },
    });
    if (existeEspecialidad) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una especialidad con ese nombre",
      });
    }

    const actualizada = await Especialidad.findOneAndUpdate(
      { codEspecialidad },
      { $set: datosActualizados }
    );

    if (!actualizada) {
      return res
        .status(404)
        .json({ ok: false, msg: "Código de especialidad no encontrado" });
    }
    res.json({ ok: true, especialidad: actualizada });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al actualizar la especialidad", error });
  }
};

// Eliminar una ruta
const eliminarEspecialidad = async (req, res) => {
  try {
    const { codEspecialidad } = req.params;
    const eliminada = await Especialidad.findOneAndDelete({ codEspecialidad });
    if (!eliminada) {
      return res
        .status(404)
        .json({ ok: false, msg: "Especialidad no encontrada" });
    }
    res.json({ ok: true, msg: "Especialidad eliminada" });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al eliminar la Especialidad", error });
  }
};

// Listar todas las profeisiones
const listarEspecialida = async (req, res) => {
  try {
    const especialidades = await Especialidad.find();
    res.json({ ok: true, especialidades });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al listar las especialidades", error });
  }
};

// Buscar profesión por término
const buscarEspecialidad = async (req, res) => {
  try {
    const termino = req.query.search || "";
    const especialidades = await Especialidad.find({
      $or: [{ nombreEspecialidad: { $regex: termino, $options: "i" } }],
    });
    res.json({ ok: true, especialidades });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al buscar especialidades", error });
  }
};

module.exports = {
  crearEspecialidad,
  actualizarEspecialidad,
  eliminarEspecialidad,
  listarEspecialida,
  buscarEspecialidad,
};
