const { response } = require("express");
const Especialidad = require("../../models/Mantenimiento/Especialidades");
const Profesion = require("../../models/Mantenimiento/Profesiones");

const crearEspecialidad = async (req, res = response) => {
  const especialidad = req.body;
  const nombreEspecialidad = especialidad.nombreEspecialidad.toUpperCase();
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  try {
    // verificar si ya existe una especialidad con ese nombre
    const especialidadBuscada = await Especialidad.findOne({
      nombreEspecialidad,
    });

    if (especialidadBuscada) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una especialidad con ese nombre",
      });
    }

    // Buscar la profesión referida por su código
    const profesion = await Profesion.findOne({
      codProfesion: especialidad.codProfesion,
    });
    if (!profesion) {
      return res
        .status(404)
        .json({ ok: false, msg: "Profesión no encontrada" });
    }

    // Buscar el último código generado
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
        ultimaEspecialidad.codEspecialidad.substring(3),
        10
      );
      console.log("Último correlativo:", ultimoCorrelativo);
      correlativo = ultimoCorrelativo + 1;
    }

    // Crear el código de especialidad con formato ESP001
    const codigo = `ESP${String(correlativo).padStart(3, "0")}`;

    // Crear la nueva especialidad
    const nuevaEspecialidad = new Especialidad({
      ...especialidad,
      codEspecialidad: codigo, // Agregar el código generado
      profesionRef: profesion._id,
      createdBy: uid, // uid del usuario que creó la especialidad
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó la especialidad
      fechaRegistro: new Date(), // Fecha de registro
    });

    await nuevaEspecialidad.save();

    return res.status(201).json({
      ok: true,
      especialidad: nuevaEspecialidad,
    });
  } catch (error) {
    console.error("❌ Error al registrar la especialidad:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const actualizarEspecialidad = async (req, res) => {
  try {
    const { codEspecialidad } = req.params;
    const datosActualizados = req.body;
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

    // Verificar si otra especialidad ya tiene ese nombre
    datosActualizados.nombreEspecialidad =
      datosActualizados.nombreEspecialidad.toUpperCase();

    const existeEspecialidad = await Especialidad.findOne({
      nombreEspecialidad: datosActualizados.nombreEspecialidad,
      codProfesion: datosActualizados.codProfesion,
      codEspecialidad: { $ne: codEspecialidad },
    });
    if (existeEspecialidad) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una especialidad con ese nombre y profesión",
      });
    }

    const actualizada = await Especialidad.findOneAndUpdate(
      { codEspecialidad },
      {
        $set: datosActualizados,
        updatedBy: uid, // uid del usuario que actualiza
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true }
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

// Eliminar una especialidad
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
      .json({ ok: false, msg: "Error al eliminar la especialidad", error });
  }
};

// Listar todas las especialidades
const listarEspecialidades = async (req, res) => {
  console.log("Listando especialidades...");
  try {
    const especialidades = await Especialidad.find().populate(
      "profesionRef", //campo de referencia
      "codProfesion nombreProfesion" // Solo traer los campos necesarios
    );

    // Si alguna especialidad no tiene profesión asociada, lo marcamos
    const especialidadesConAviso = especialidades.map((e) => {
      if (!e.profesionRef) {
        return {
          ...e.toObject(),
          profesionRef: {
            codProfesion: "---",
            nombreProfesion: "NO DISPONIBLE",
          },
          referenciaRota: true,
        };
      }
      return e;
    });

    console.log("Especialidades encontradas:", especialidadesConAviso);
    res.json({ ok: true, especialidades: especialidadesConAviso });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al listar las especialidades", error });
  }
};

// Buscar especialidad por término
const buscarEspecialidad = async (req, res) => {
  try {
    const termino = req.query.search || "";
    const especialidades = await Especialidad.find({
      $or: [
        { nombreEspecialidad: { $regex: termino, $options: "i" } },
        { codEspecialidad: { $regex: termino, $options: "i" } },
      ],
    }).populate("codProfesion");

    res.json({ ok: true, especialidades });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al buscar especialidades", error });
  }
};

// Listar especialidades por profesión
const listarEspecialidadesPorProfesion = async (req, res) => {
  try {
    const idCodProfesion = req.params.id;
    const especialidades = await Especialidad.find({
      profesionRef: idCodProfesion,
    }).sort({ nombreEspecialidad: 1 });
    res.json({ ok: true, especialidades });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: "Error al listar especialidades por profesión",
      error,
    });
  }
};

module.exports = {
  crearEspecialidad,
  actualizarEspecialidad,
  eliminarEspecialidad,
  listarEspecialidades,
  buscarEspecialidad,
  listarEspecialidadesPorProfesion,
};
