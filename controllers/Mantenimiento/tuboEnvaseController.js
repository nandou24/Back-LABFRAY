const { response } = require("express");
const mongoose = require("mongoose");

const TuboEnvase = require("../../models/Mantenimiento/TuboEnvase");

// ==========================================================
// GENERAR CÓDIGO DE TUBO / ENVASE
// TE001, TE002, TE003...
// ==========================================================
const generarCodigoTuboEnvase = async () => {
  const registros = await TuboEnvase.find({
    codTuboEnvase: /^TE\d+$/,
  })
    .select("codTuboEnvase")
    .lean();

  let mayorNumero = 0;

  for (const registro of registros) {
    const numero = parseInt(registro.codTuboEnvase.replace("TE", ""), 10);

    if (!isNaN(numero) && numero > mayorNumero) {
      mayorNumero = numero;
    }
  }

  return `TE${String(mayorNumero + 1).padStart(3, "0")}`;
};

// ==========================================================
// CREAR TUBO / ENVASE
// ==========================================================
const crearTuboEnvase = async (req, res = response) => {
  try {
    const { uid, nombreUsuario } = req.user;

    const {
      nombreTuboEnvase,
      descripcionTuboEnvase = "",
      color = "",
      aditivo = "",
      capacidad = null,
      unidadCapacidad = null,
    } = req.body;

    if (!nombreTuboEnvase?.trim()) {
      return res.status(400).json({
        ok: false,
        msg: "El nombre del tubo/envase es obligatorio",
      });
    }

    const nombreNormalizado = nombreTuboEnvase.trim().toUpperCase();

    const duplicado = await TuboEnvase.findOne({
      nombreTuboEnvase: nombreNormalizado,
    });

    if (duplicado) {
      return res.status(409).json({
        ok: false,
        codigo: "TUBO_ENVASE_DUPLICADO",
        msg: "Ya existe un tubo/envase con ese nombre",
      });
    }

    if (
      capacidad !== null &&
      capacidad !== "" &&
      (isNaN(Number(capacidad)) || Number(capacidad) < 0)
    ) {
      return res.status(400).json({
        ok: false,
        msg: "La capacidad indicada no es válida",
      });
    }

    const codTuboEnvase = await generarCodigoTuboEnvase();

    const tuboEnvase = new TuboEnvase({
      codTuboEnvase,
      nombreTuboEnvase: nombreNormalizado,

      descripcionTuboEnvase: descripcionTuboEnvase?.trim() || "",

      color: color?.trim() || "",
      aditivo: aditivo?.trim() || "",

      capacidad:
        capacidad === null || capacidad === "" ? null : Number(capacidad),

      unidadCapacidad: unidadCapacidad?.trim() || null,

      estadoTuboEnvase: "ACTIVO",

      createdBy: uid,
      usuarioRegistro: nombreUsuario,
    });

    await tuboEnvase.save();

    return res.status(201).json({
      ok: true,
      msg: "Tubo/envase registrado correctamente",
      tuboEnvase,
    });
  } catch (error) {
    console.error("Error al crear tubo/envase:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        ok: false,
        codigo: "TUBO_ENVASE_DUPLICADO",
        msg: "Ya existe un tubo/envase con esos datos",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al registrar el tubo/envase",
    });
  }
};

// ==========================================================
// OBTENER TUBOS / ENVASES
// ?estado=ACTIVO
// ?estado=INACTIVO
// ==========================================================
const obtenerTubosEnvases = async (req, res = response) => {
  try {
    const { estado } = req.query;

    const filtro = {};

    if (estado) {
      const estadoNormalizado = estado.toUpperCase();

      if (!["ACTIVO", "INACTIVO"].includes(estadoNormalizado)) {
        return res.status(400).json({
          ok: false,
          msg: "El estado indicado no es válido",
        });
      }

      filtro.estadoTuboEnvase = estadoNormalizado;
    }

    const tubosEnvases = await TuboEnvase.find(filtro)
      .sort({
        nombreTuboEnvase: 1,
      })
      .lean();

    return res.status(200).json({
      ok: true,
      total: tubosEnvases.length,
      tubosEnvases,
    });
  } catch (error) {
    console.error("Error al obtener tubos/envases:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al obtener los tubos/envases",
    });
  }
};

// ==========================================================
// OBTENER TUBO / ENVASE POR ID
// ==========================================================
const obtenerTuboEnvasePorId = async (req, res = response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID del tubo/envase no es válido",
      });
    }

    const tuboEnvase = await TuboEnvase.findById(id).lean();

    if (!tuboEnvase) {
      return res.status(404).json({
        ok: false,
        msg: "Tubo/envase no encontrado",
      });
    }

    return res.status(200).json({
      ok: true,
      tuboEnvase,
    });
  } catch (error) {
    console.error("Error al obtener tubo/envase:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al obtener el tubo/envase",
    });
  }
};

// ==========================================================
// ACTUALIZAR TUBO / ENVASE
// ==========================================================
const actualizarTuboEnvase = async (req, res = response) => {
  try {
    const { id } = req.params;
    const { uid, nombreUsuario } = req.user;

    const {
      nombreTuboEnvase,
      descripcionTuboEnvase = "",
      color = "",
      aditivo = "",
      capacidad = null,
      unidadCapacidad = null,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID del tubo/envase no es válido",
      });
    }

    if (!nombreTuboEnvase?.trim()) {
      return res.status(400).json({
        ok: false,
        msg: "El nombre del tubo/envase es obligatorio",
      });
    }

    if (
      capacidad !== null &&
      capacidad !== "" &&
      (isNaN(Number(capacidad)) || Number(capacidad) < 0)
    ) {
      return res.status(400).json({
        ok: false,
        msg: "La capacidad indicada no es válida",
      });
    }

    const tuboEnvase = await TuboEnvase.findById(id);

    if (!tuboEnvase) {
      return res.status(404).json({
        ok: false,
        msg: "Tubo/envase no encontrado",
      });
    }

    const nombreNormalizado = nombreTuboEnvase.trim().toUpperCase();

    const duplicado = await TuboEnvase.findOne({
      _id: { $ne: id },
      nombreTuboEnvase: nombreNormalizado,
    });

    if (duplicado) {
      return res.status(409).json({
        ok: false,
        codigo: "TUBO_ENVASE_DUPLICADO",
        msg: "Ya existe otro tubo/envase con ese nombre",
      });
    }

    tuboEnvase.nombreTuboEnvase = nombreNormalizado;

    tuboEnvase.descripcionTuboEnvase = descripcionTuboEnvase?.trim() || "";

    tuboEnvase.color = color?.trim() || "";

    tuboEnvase.aditivo = aditivo?.trim() || "";

    tuboEnvase.capacidad =
      capacidad === null || capacidad === "" ? null : Number(capacidad);

    tuboEnvase.unidadCapacidad = unidadCapacidad?.trim() || null;

    tuboEnvase.updatedBy = uid;
    tuboEnvase.usuarioActualizacion = nombreUsuario;
    tuboEnvase.fechaActualizacion = new Date();

    await tuboEnvase.save();

    return res.status(200).json({
      ok: true,
      msg: "Tubo/envase actualizado correctamente",
      tuboEnvase,
    });
  } catch (error) {
    console.error("Error al actualizar tubo/envase:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        ok: false,
        codigo: "TUBO_ENVASE_DUPLICADO",
        msg: "Ya existe un tubo/envase con esos datos",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al actualizar el tubo/envase",
    });
  }
};

// ==========================================================
// CAMBIAR ESTADO
// ==========================================================
const cambiarEstadoTuboEnvase = async (req, res = response) => {
  try {
    const { id } = req.params;
    const { uid, nombreUsuario } = req.user;

    const { estadoTuboEnvase } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID del tubo/envase no es válido",
      });
    }

    const estadoNormalizado = estadoTuboEnvase?.toUpperCase();

    if (!["ACTIVO", "INACTIVO"].includes(estadoNormalizado)) {
      return res.status(400).json({
        ok: false,
        msg: "El estado debe ser ACTIVO o INACTIVO",
      });
    }

    const tuboEnvase = await TuboEnvase.findById(id);

    if (!tuboEnvase) {
      return res.status(404).json({
        ok: false,
        msg: "Tubo/envase no encontrado",
      });
    }

    tuboEnvase.estadoTuboEnvase = estadoNormalizado;

    tuboEnvase.updatedBy = uid;
    tuboEnvase.usuarioActualizacion = nombreUsuario;
    tuboEnvase.fechaActualizacion = new Date();

    await tuboEnvase.save();

    return res.status(200).json({
      ok: true,
      msg: `Tubo/envase ${
        estadoNormalizado === "ACTIVO" ? "activado" : "inactivado"
      } correctamente`,
      tuboEnvase,
    });
  } catch (error) {
    console.error("Error al cambiar estado del tubo/envase:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al cambiar el estado del tubo/envase",
    });
  }
};

// ==========================================================
// EXPORTACIONES
// ==========================================================
module.exports = {
  generarCodigoTuboEnvase,
  crearTuboEnvase,
  obtenerTubosEnvases,
  obtenerTuboEnvasePorId,
  actualizarTuboEnvase,
  cambiarEstadoTuboEnvase,
};
