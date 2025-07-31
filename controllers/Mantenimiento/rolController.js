const Rol = require("../../models/permisos/roles");

// Crear un nuevo rol con código autogenerado tipo ROL001
const crearRol = async (req, res) => {
  try {
    const { nombreRol, descripcionRol, rutasPermitidas, estado } = req.body;
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
    // Buscar el último código generado

    const ultimoRol = await Rol.findOne({}, { codRol: 1 })
      .sort({ codRol: -1 })
      .lean();
    let correlativo = 1;
    if (ultimoRol) {
      const ultimoCorrelativo = parseInt(ultimoRol.codRol.slice(3, 6));
      correlativo = ultimoCorrelativo + 1;
    }
    const codRol = `ROL${String(correlativo).padStart(3, "0")}`;
    const nuevoRol = new Rol({
      codRol,
      nombreRol,
      descripcionRol,
      rutasPermitidas,
      estado,
      createdBy: uid, // uid del usuario que creó el rol
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó el rol
      fechaRegistro: new Date(), // Fecha de registro
    });
    await nuevoRol.save();
    res.status(201).json({ ok: true, rol: nuevoRol });
  } catch (error) {
    res.status(500).json({ ok: false, msg: "Error al crear el rol", error });
    console.log("Error al crear el rol:", error);
  }
};

// Actualizar un rol existente
const actualizarRol = async (req, res) => {
  try {
    const { codRol } = req.params;
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
    const actualizado = await Rol.findOneAndUpdate(
      { codRol }, 
      {
        $set: req.body,
        updatedBy: uid, // uid del usuario que actualiza
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true }
    );
    if (!actualizado) {
      return res.status(404).json({ ok: false, msg: "Rol no encontrado" });
    }
    res.json({ ok: true, rol: actualizado });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al actualizar el rol", error });
  }
};

// Eliminar un rol
const eliminarRol = async (req, res) => {
  try {
    const { codRol } = req.params;
    const eliminado = await Rol.findOneAndDelete({ codRol });
    if (!eliminado) {
      return res.status(404).json({ ok: false, msg: "Rol no encontrado" });
    }
    res.json({ ok: true, msg: "Rol eliminado" });
  } catch (error) {
    res.status(500).json({ ok: false, msg: "Error al eliminar el rol", error });
  }
};

// Listar todos los roles
const listarRoles = async (req, res) => {
  try {
    const roles = await Rol.find().populate("rutasPermitidas");
    res.json({ ok: true, roles });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al listar los roles", error });
  }
};

// Buscar roles por nombre o código
const buscarRol = async (req, res) => {
  try {
    const termino = req.query.search || "";
    const roles = await Rol.find({
      $or: [
        { nombreRol: { $regex: termino, $options: "i" } },
        { codRol: { $regex: termino, $options: "i" } },
      ],
    }).populate("rutasPermitidas");
    res.json({ ok: true, roles });
  } catch (error) {
    res.status(500).json({ ok: false, msg: "Error al buscar roles", error });
  }
};

module.exports = {
  crearRol,
  actualizarRol,
  eliminarRol,
  listarRoles,
  buscarRol,
};
