const Rol = require("../../models/permisos/roles");
const { normalizarPermisosAcciones } = require("../../utils/permisosAccion");

// ====== Crear rol ======

const crearRol = async (req, res) => {
  try {
    const {
      nombreRol,
      descripcionRol,
      rutasPermitidas,
      permisosAcciones = [],
      estado,
    } = req.body;
    const { uid, nombreUsuario } = req.user;

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
      permisosAcciones: normalizarPermisosAcciones(permisosAcciones),
      estado,
      createdBy: uid,
      usuarioRegistro: nombreUsuario,
      fechaRegistro: new Date(),
    });

    await nuevoRol.save();

    return res.status(201).json({ ok: true, rol: nuevoRol });
  } catch (error) {
    console.log("Error al crear el rol:", error);
    return res.status(500).json({ ok: false, msg: "Error al crear el rol", error });
  }
};

// ====== Actualizar rol ======

const actualizarRol = async (req, res) => {
  try {
    const { codRol } = req.params;
    const { uid, nombreUsuario } = req.user;
    // ====== Código de rol inmutable; ROL002 es una identidad de seguridad ======
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        Object.keys(req.body).some(k => k === '_id' || k === 'codRol' || k.startsWith('$') || k.includes('.'))) {
      return res.status(422).json({ ok: false, msg: 'No se puede cambiar el código o la identidad del rol' });
    }
    if (codRol === 'ROL002' && Object.prototype.hasOwnProperty.call(req.body, 'estado') && req.body.estado !== true) {
      return res.status(403).json({ ok: false,
        msg: 'El rol global no puede deshabilitarse desde el mantenimiento ordinario' });
    }

    const datosActualizacion = {
      ...req.body,
      ...(Object.prototype.hasOwnProperty.call(req.body, "permisosAcciones")
        ? {
            permisosAcciones: normalizarPermisosAcciones(
              req.body.permisosAcciones,
            ),
          }
        : {}),
      updatedBy: uid,
      usuarioActualizacion: nombreUsuario,
      fechaActualizacion: new Date(),
    };

    const actualizado = await Rol.findOneAndUpdate(
      { codRol },
      { $set: datosActualizacion },
      { new: true },
    ).populate("rutasPermitidas");

    if (!actualizado) {
      return res.status(404).json({ ok: false, msg: "Rol no encontrado" });
    }

    return res.json({ ok: true, rol: actualizado });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, msg: "Error al actualizar el rol", error });
  }
};

// ====== Eliminar rol ======

const eliminarRol = async (req, res) => {
  try {
    const { codRol } = req.params;
    if (codRol === 'ROL002') return res.status(403).json({ ok: false,
      msg: 'No se puede eliminar el rol global SuperAdmin' });
    const eliminado = await Rol.findOneAndDelete({ codRol });

    if (!eliminado) {
      return res.status(404).json({ ok: false, msg: "Rol no encontrado" });
    }

    return res.json({ ok: true, msg: "Rol eliminado" });
  } catch (error) {
    return res.status(500).json({ ok: false, msg: "Error al eliminar el rol", error });
  }
};

// ====== Listar roles ======

const listarRoles = async (req, res) => {
  try {
    const roles = await Rol.find().populate("rutasPermitidas");
    return res.json({ ok: true, roles });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, msg: "Error al listar los roles", error });
  }
};

// ====== Buscar roles ======

const buscarRol = async (req, res) => {
  try {
    const termino = req.query.search || "";
    const roles = await Rol.find({
      $or: [
        { nombreRol: { $regex: termino, $options: "i" } },
        { codRol: { $regex: termino, $options: "i" } },
      ],
    }).populate("rutasPermitidas");

    return res.json({ ok: true, roles });
  } catch (error) {
    return res.status(500).json({ ok: false, msg: "Error al buscar roles", error });
  }
};

module.exports = {
  crearRol,
  actualizarRol,
  eliminarRol,
  listarRoles,
  buscarRol,
};
