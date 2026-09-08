const { response } = require("express");
const mongoose = require("mongoose");

const TipoMuestra = require("../../models/Mantenimiento/TipoMuestra");

// ==========================================================
// GENERAR CÓDIGO DE TIPO DE MUESTRA
// TM001, TM002, TM003...
// ==========================================================
const generarCodigoTipoMuestra = async () => {
  const tiposMuestra = await TipoMuestra.find({
    codTipoMuestra: /^TM\d+$/,
  })
    .select("codTipoMuestra")
    .lean();

  let mayorNumero = 0;

  for (const tipo of tiposMuestra) {
    const numero = parseInt(tipo.codTipoMuestra.replace("TM", ""), 10);

    if (!isNaN(numero) && numero > mayorNumero) {
      mayorNumero = numero;
    }
  }

  const siguienteNumero = mayorNumero + 1;

  return `TM${String(siguienteNumero).padStart(3, "0")}`;
};

// ==========================================================
// CREAR TIPO DE MUESTRA
// ==========================================================
const crearTipoMuestra = async (req, res = response) => {
  try {
    const { uid, nombreUsuario } = req.user;

    const { nombreTipoMuestra, descripcionTipoMuestra = "" } = req.body;

    if (!nombreTipoMuestra || !nombreTipoMuestra.trim()) {
      return res.status(400).json({
        ok: false,
        msg: "El nombre del tipo de muestra es obligatorio",
      });
    }

    const nombreNormalizado = nombreTipoMuestra.trim().toUpperCase();

    // Verificar duplicidad por nombre
    const existeTipoMuestra = await TipoMuestra.findOne({
      nombreTipoMuestra: nombreNormalizado,
    });

    if (existeTipoMuestra) {
      return res.status(409).json({
        ok: false,
        codigo: "TIPO_MUESTRA_DUPLICADO",
        msg: "Ya existe un tipo de muestra con ese nombre",
      });
    }

    const codTipoMuestra = await generarCodigoTipoMuestra();

    const tipoMuestra = new TipoMuestra({
      codTipoMuestra,
      nombreTipoMuestra: nombreNormalizado,
      descripcionTipoMuestra: descripcionTipoMuestra?.trim() || "",
      estadoTipoMuestra: "ACTIVO",

      createdBy: uid,
      usuarioRegistro: nombreUsuario,
    });

    await tipoMuestra.save();

    return res.status(201).json({
      ok: true,
      msg: "Tipo de muestra registrado correctamente",
      tipoMuestra,
    });
  } catch (error) {
    console.error("Error al crear tipo de muestra:", error);

    // Protección adicional ante índice unique
    if (error?.code === 11000) {
      return res.status(409).json({
        ok: false,
        codigo: "TIPO_MUESTRA_DUPLICADO",
        msg: "Ya existe un tipo de muestra con esos datos",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al registrar el tipo de muestra",
    });
  }
};

// ==========================================================
// OBTENER TIPOS DE MUESTRA
// Permite opcionalmente filtrar por estado:
// ?estado=ACTIVO
// ?estado=INACTIVO
// ==========================================================
const obtenerTiposMuestra = async (req, res = response) => {
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

      filtro.estadoTipoMuestra = estadoNormalizado;
    }

    const tiposMuestra = await TipoMuestra.find(filtro)
      .sort({
        nombreTipoMuestra: 1,
      })
      .lean();

    return res.status(200).json({
      ok: true,
      total: tiposMuestra.length,
      tiposMuestra,
    });
  } catch (error) {
    console.error("Error al obtener tipos de muestra:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al obtener los tipos de muestra",
    });
  }
};

// ==========================================================
// OBTENER TIPO DE MUESTRA POR ID
// ==========================================================
const obtenerTipoMuestraPorId = async (req, res = response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID del tipo de muestra no es válido",
      });
    }

    const tipoMuestra = await TipoMuestra.findById(id).lean();

    if (!tipoMuestra) {
      return res.status(404).json({
        ok: false,
        msg: "Tipo de muestra no encontrado",
      });
    }

    return res.status(200).json({
      ok: true,
      tipoMuestra,
    });
  } catch (error) {
    console.error("Error al obtener tipo de muestra:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al obtener el tipo de muestra",
    });
  }
};

// ==========================================================
// ACTUALIZAR TIPO DE MUESTRA
// ==========================================================
const actualizarTipoMuestra = async (req, res = response) => {
  try {
    const { id } = req.params;
    const { uid, nombreUsuario } = req.user;

    const { nombreTipoMuestra, descripcionTipoMuestra, estadoTipoMuestra } =
      req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID del tipo de muestra no es válido",
      });
    }

    if (!nombreTipoMuestra || !nombreTipoMuestra.trim()) {
      return res.status(400).json({
        ok: false,
        msg: "El nombre del tipo de muestra es obligatorio",
      });
    }

    const tipoMuestra = await TipoMuestra.findById(id);

    if (!tipoMuestra) {
      return res.status(404).json({
        ok: false,
        msg: "Tipo de muestra no encontrado",
      });
    }

    const nombreNormalizado = nombreTipoMuestra.trim().toUpperCase();

    // Verificar que otro registro no tenga el mismo nombre
    const duplicado = await TipoMuestra.findOne({
      _id: { $ne: id },
      nombreTipoMuestra: nombreNormalizado,
    });

    if (duplicado) {
      return res.status(409).json({
        ok: false,
        codigo: "TIPO_MUESTRA_DUPLICADO",
        msg: "Ya existe otro tipo de muestra con ese nombre",
      });
    }

    tipoMuestra.nombreTipoMuestra = nombreNormalizado;
    tipoMuestra.descripcionTipoMuestra = descripcionTipoMuestra?.trim() || "";
    tipoMuestra.estadoTipoMuestra =
      estadoTipoMuestra?.trim().toUpperCase() || "ACTIVO";

    tipoMuestra.updatedBy = uid;
    tipoMuestra.usuarioActualizacion = nombreUsuario;
    tipoMuestra.fechaActualizacion = new Date();

    await tipoMuestra.save();

    return res.status(200).json({
      ok: true,
      msg: "Tipo de muestra actualizado correctamente",
      tipoMuestra,
    });
  } catch (error) {
    console.error("Error al actualizar tipo de muestra:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        ok: false,
        codigo: "TIPO_MUESTRA_DUPLICADO",
        msg: "Ya existe un tipo de muestra con esos datos",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al actualizar el tipo de muestra",
    });
  }
};

// ==========================================================
// CAMBIAR ESTADO ACTIVO / INACTIVO
// ==========================================================
const cambiarEstadoTipoMuestra = async (req, res = response) => {
  try {
    const { id } = req.params;
    const { uid, nombreUsuario } = req.user;
    const { estadoTipoMuestra } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID del tipo de muestra no es válido",
      });
    }

    const estadoNormalizado = estadoTipoMuestra?.toUpperCase();

    if (!["ACTIVO", "INACTIVO"].includes(estadoNormalizado)) {
      return res.status(400).json({
        ok: false,
        msg: "El estado debe ser ACTIVO o INACTIVO",
      });
    }

    const tipoMuestra = await TipoMuestra.findById(id);

    if (!tipoMuestra) {
      return res.status(404).json({
        ok: false,
        msg: "Tipo de muestra no encontrado",
      });
    }

    tipoMuestra.estadoTipoMuestra = estadoNormalizado;

    tipoMuestra.updatedBy = uid;
    tipoMuestra.usuarioActualizacion = nombreUsuario;
    tipoMuestra.fechaActualizacion = new Date();

    await tipoMuestra.save();

    return res.status(200).json({
      ok: true,
      msg: `Tipo de muestra ${
        estadoNormalizado === "ACTIVO" ? "activado" : "inactivado"
      } correctamente`,
      tipoMuestra,
    });
  } catch (error) {
    console.error("Error al cambiar estado del tipo de muestra:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al cambiar el estado del tipo de muestra",
    });
  }
};

// ==========================================================
// EXPORTACIONES
// ==========================================================
module.exports = {
  generarCodigoTipoMuestra,
  crearTipoMuestra,
  obtenerTiposMuestra,
  obtenerTipoMuestraPorId,
  actualizarTipoMuestra,
  cambiarEstadoTipoMuestra,
};
