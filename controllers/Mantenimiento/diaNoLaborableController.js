const { response } = require("express");
const mongoose = require("mongoose");

const DiaNoLaborable = require("../../models/Mantenimiento/DiaNoLaborable");

const TIPOS_VALIDOS = [
  "FERIADO_NACIONAL",
  "FERIADO_LOCAL",
  "CIERRE_INSTITUCIONAL",
  "OTRO",
];

// ====== Validar fecha ISO ======

const validarFechaISO = (valor) => {
  const fecha = String(valor ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return null;
  }

  const [anio, mes, dia] = fecha.split("-").map(Number);
  const comprobacion = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    comprobacion.getUTCFullYear() !== anio ||
    comprobacion.getUTCMonth() !== mes - 1 ||
    comprobacion.getUTCDate() !== dia
  ) {
    return null;
  }

  return {
    fecha,
    anio,
  };
};

// ====== Escapar búsqueda ======

const escaparRegex = (valor) =>
  String(valor ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ====== Normalizar datos ======

const normalizarDatos = (datos = {}) => {
  const fechaValidada = validarFechaISO(datos.fecha);

  if (!fechaValidada) {
    return {
      ok: false,
      msg: "La fecha del día no laborable no es válida.",
    };
  }

  const descripcion = String(datos.descripcion ?? "").trim();

  if (!descripcion) {
    return {
      ok: false,
      msg: "La descripción es obligatoria.",
    };
  }

  if (descripcion.length > 180) {
    return {
      ok: false,
      msg: "La descripción no puede superar 180 caracteres.",
    };
  }

  const tipo = String(datos.tipo ?? "FERIADO_NACIONAL")
    .trim()
    .toUpperCase();

  if (!TIPOS_VALIDOS.includes(tipo)) {
    return {
      ok: false,
      msg: "El tipo de día no laborable no es válido.",
    };
  }

  const observacion = String(datos.observacion ?? "").trim();

  if (observacion.length > 500) {
    return {
      ok: false,
      msg: "La observación no puede superar 500 caracteres.",
    };
  }

  const estadoDiaNoLaborable = String(
    datos.estadoDiaNoLaborable ?? "ACTIVO",
  )
    .trim()
    .toUpperCase();

  if (!["ACTIVO", "INACTIVO"].includes(estadoDiaNoLaborable)) {
    return {
      ok: false,
      msg: "El estado del día no laborable no es válido.",
    };
  }

  return {
    ok: true,
    datos: {
      fecha: fechaValidada.fecha,
      anio: fechaValidada.anio,
      descripcion,
      tipo,
      observacion,
      estadoDiaNoLaborable,
    },
  };
};

// ====== Registrar ======

const crearDiaNoLaborable = async (req, res = response) => {
  try {
    const validacion = normalizarDatos(req.body);

    if (!validacion.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacion.msg,
      });
    }

    const existente = await DiaNoLaborable.findOne({
      fecha: validacion.datos.fecha,
    }).lean();

    if (existente) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un día no laborable registrado para esa fecha.",
      });
    }

    const { uid, nombreUsuario } = req.user;

    const diaNoLaborable = new DiaNoLaborable({
      ...validacion.datos,
      createdBy: uid,
      usuarioRegistro: nombreUsuario,
      fechaRegistro: new Date(),
    });

    await diaNoLaborable.save();

    return res.status(201).json({
      ok: true,
      msg: "Día no laborable registrado correctamente.",
      diaNoLaborable,
    });
  } catch (error) {
    console.error("Error al registrar día no laborable:", error);

    if (error?.code === 11000) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un día no laborable registrado para esa fecha.",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al registrar el día no laborable.",
    });
  }
};

// ====== Listar / buscar ======

const obtenerDiasNoLaborables = async (req, res = response) => {
  try {
    const { anio, estado, search } = req.query;
    const filtro = {};

    if (anio !== undefined && anio !== "") {
      const anioNumero = Number(anio);

      if (!Number.isInteger(anioNumero) || anioNumero < 1900 || anioNumero > 2200) {
        return res.status(400).json({
          ok: false,
          msg: "El año de consulta no es válido.",
        });
      }

      filtro.anio = anioNumero;
    }

    if (["ACTIVO", "INACTIVO"].includes(String(estado ?? "").toUpperCase())) {
      filtro.estadoDiaNoLaborable = String(estado).toUpperCase();
    }

    const termino = String(search ?? "").trim();

    if (termino) {
      const regex = new RegExp(escaparRegex(termino), "i");

      filtro.$or = [
        { fecha: regex },
        { descripcion: regex },
        { tipo: regex },
        { observacion: regex },
      ];
    }

    const diasNoLaborables = await DiaNoLaborable.find(filtro)
      .sort({ fecha: 1 })
      .lean();

    return res.json({
      ok: true,
      total: diasNoLaborables.length,
      diasNoLaborables,
    });
  } catch (error) {
    console.error("Error al obtener días no laborables:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al obtener los días no laborables.",
    });
  }
};

// ====== Obtener por ID ======

const obtenerDiaNoLaborablePorId = async (req, res = response) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        msg: "Identificador no válido.",
      });
    }

    const diaNoLaborable = await DiaNoLaborable.findById(id).lean();

    if (!diaNoLaborable) {
      return res.status(404).json({
        ok: false,
        msg: "Día no laborable no encontrado.",
      });
    }

    return res.json({
      ok: true,
      diaNoLaborable,
    });
  } catch (error) {
    console.error("Error al obtener día no laborable:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al obtener el día no laborable.",
    });
  }
};

// ====== Actualizar ======

const actualizarDiaNoLaborable = async (req, res = response) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        msg: "Identificador no válido.",
      });
    }

    const actual = await DiaNoLaborable.findById(id);

    if (!actual) {
      return res.status(404).json({
        ok: false,
        msg: "Día no laborable no encontrado.",
      });
    }

    const validacion = normalizarDatos({
      fecha: req.body.fecha ?? actual.fecha,
      descripcion: req.body.descripcion ?? actual.descripcion,
      tipo: req.body.tipo ?? actual.tipo,
      observacion: req.body.observacion ?? actual.observacion,
      estadoDiaNoLaborable:
        req.body.estadoDiaNoLaborable ?? actual.estadoDiaNoLaborable,
    });

    if (!validacion.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacion.msg,
      });
    }

    const duplicado = await DiaNoLaborable.findOne({
      fecha: validacion.datos.fecha,
      _id: { $ne: id },
    }).lean();

    if (duplicado) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe otro día no laborable registrado para esa fecha.",
      });
    }

    const { uid, nombreUsuario } = req.user;

    const diaNoLaborable = await DiaNoLaborable.findByIdAndUpdate(
      id,
      {
        ...validacion.datos,
        updatedBy: uid,
        usuarioActualizacion: nombreUsuario,
        fechaActualizacion: new Date(),
      },
      {
        new: true,
        runValidators: true,
      },
    );

    return res.json({
      ok: true,
      msg: "Día no laborable actualizado correctamente.",
      diaNoLaborable,
    });
  } catch (error) {
    console.error("Error al actualizar día no laborable:", error);

    if (error?.code === 11000) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un día no laborable registrado para esa fecha.",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al actualizar el día no laborable.",
    });
  }
};

// ====== Cambiar estado ======

const cambiarEstadoDiaNoLaborable = async (req, res = response) => {
  try {
    const { id } = req.params;
    const estadoDiaNoLaborable = String(
      req.body?.estadoDiaNoLaborable ?? "",
    )
      .trim()
      .toUpperCase();

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        msg: "Identificador no válido.",
      });
    }

    if (!["ACTIVO", "INACTIVO"].includes(estadoDiaNoLaborable)) {
      return res.status(400).json({
        ok: false,
        msg: "Estado no válido.",
      });
    }

    const { uid, nombreUsuario } = req.user;

    const diaNoLaborable = await DiaNoLaborable.findByIdAndUpdate(
      id,
      {
        estadoDiaNoLaborable,
        updatedBy: uid,
        usuarioActualizacion: nombreUsuario,
        fechaActualizacion: new Date(),
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!diaNoLaborable) {
      return res.status(404).json({
        ok: false,
        msg: "Día no laborable no encontrado.",
      });
    }

    return res.json({
      ok: true,
      msg:
        estadoDiaNoLaborable === "ACTIVO"
          ? "Día no laborable activado correctamente."
          : "Día no laborable inactivado correctamente.",
      diaNoLaborable,
    });
  } catch (error) {
    console.error("Error al cambiar estado del día no laborable:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al cambiar el estado del día no laborable.",
    });
  }
};

module.exports = {
  crearDiaNoLaborable,
  obtenerDiasNoLaborables,
  obtenerDiaNoLaborablePorId,
  actualizarDiaNoLaborable,
  cambiarEstadoDiaNoLaborable,
};
