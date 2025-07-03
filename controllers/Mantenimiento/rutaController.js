const Ruta = require("../../models/permisos/rutas");

// Crear una nueva ruta
const crearRuta = async (req, res) => {
  try {
    const {
      nombreRuta,
      nombreMostrar,
      descripcionRuta,
      urlRuta,
      iconoRuta,
      estado,
    } = req.body;

    console.log("Datos recibidos:", req.body);

    const existe = await Ruta.findOne({ urlRuta });
    if (existe) {
      return res
        .status(400)
        .json({ ok: false, msg: "Ya existe una ruta con esa url" });
    }

    const existeNombre = await Ruta.findOne({ nombreMostrar });
    if (existeNombre) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una ruta con ese nombre para mostrar",
      });
    }

    const nuevaRuta = new Ruta({
      nombreRuta,
      nombreMostrar,
      descripcionRuta,
      urlRuta,
      iconoRuta,
      estado,
    });

    // Generar código de ruta autoincremental, el formato será "RUTA000"
    const ultimoRuta = await Ruta.findOne({}, { codRuta: 1 })
      .sort({ codRuta: -1 })
      .lean();

    let correlativo = 1;
    if (ultimoRuta) {
      const ultimoCorrelativo = parseInt(ultimoRuta.codRuta.slice(2, 5));
      correlativo = ultimoCorrelativo + 1;
    }
    const codigo = `RU${String(correlativo).padStart(3, "0")}`;
    nuevaRuta.codRuta = codigo;

    console.log("Nueva ruta a guardar:", nuevaRuta);

    await nuevaRuta.save();
    res.status(201).json({ ok: true, ruta: nuevaRuta });
  } catch (error) {
    res.status(500).json({ ok: false, msg: "Error al crear la ruta", error });
    console.log("Error al crear la ruta:", error);
  }
};

// Actualizar una ruta existente
const actualizarRuta = async (req, res) => {
  try {
    const { codRuta, urlRuta, nombreMostrar } = req.params;
    // Verificar si otra ruta ya tiene esa url
    const existeUrl = await Ruta.findOne({
      urlRuta,
      codRuta: { $ne: codRuta },
    });
    if (existeUrl) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una ruta con esa URL en otro registro",
      });
    }
    // Verificar si otra ruta ya tiene ese nombreMostrar
    const existeNombre = await Ruta.findOne({
      nombreMostrar,
      codRuta: { $ne: codRuta },
    });
    if (existeNombre) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una ruta con ese nombre para mostrar en otro registro",
      });
    }

    const actualizada = await Ruta.findOneAndUpdate({ codRuta }, req.body, {
      new: true,
    });
    if (!actualizada) {
      return res
        .status(404)
        .json({ ok: false, msg: "Código de ruta no encontrada" });
    }
    res.json({ ok: true, ruta: actualizada });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al actualizar la ruta", error });
  }
};

// Eliminar una ruta
const eliminarRuta = async (req, res) => {
  try {
    const { codRuta } = req.params;
    const eliminada = await Ruta.findOneAndDelete({ codRuta });
    if (!eliminada) {
      return res.status(404).json({ ok: false, msg: "Ruta no encontrada" });
    }
    res.json({ ok: true, msg: "Ruta eliminada" });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al eliminar la ruta", error });
  }
};

// Listar todas las rutas
const listarRutas = async (req, res) => {
  try {
    const rutas = await Ruta.find();
    res.json({ ok: true, rutas });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, msg: "Error al listar las rutas", error });
  }
};

// Buscar rutas por término
const buscarRuta = async (req, res) => {
  try {
    const termino = req.query.search || "";
    const rutas = await Ruta.find({
      $or: [
        { nombreRuta: { $regex: termino, $options: "i" } },
        { nombreMostrar: { $regex: termino, $options: "i" } },
        { urlRuta: { $regex: termino, $options: "i" } },
      ],
    });
    res.json({ ok: true, rutas });
  } catch (error) {
    res.status(500).json({ ok: false, msg: "Error al buscar rutas", error });
  }
};

module.exports = {
  crearRuta,
  actualizarRuta,
  eliminarRuta,
  listarRutas,
  buscarRuta,
};
