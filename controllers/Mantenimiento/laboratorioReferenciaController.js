const { response } = require("express");

const LaboratorioReferencia = require("../../models/Mantenimiento/LaboratorioReferencia");

// ====== Generar código ======

const generarCodigoLaboratorioReferencia = async () => {
  const ultimoLaboratorio = await LaboratorioReferencia.findOne({
    codLaboratorioReferencia: {
      $regex: /^LR\d+$/,
    },
  }).sort({
    codLaboratorioReferencia: -1,
  });

  if (!ultimoLaboratorio?.codLaboratorioReferencia) {
    return "LR0001";
  }

  const ultimoNumero = Number(
    ultimoLaboratorio.codLaboratorioReferencia.replace("LR", ""),
  );

  const siguienteNumero = ultimoNumero + 1;

  return `LR${String(siguienteNumero).padStart(4, "0")}`;
};

// ====== Validar contactos principales ======

const validarContactosPrincipales = (contactos = []) => {
  const principalesPorTipo = {};

  for (const contacto of contactos) {
    if (!contacto?.principal) {
      continue;
    }

    const tipoContacto = contacto.tipoContacto;

    if (!tipoContacto) {
      continue;
    }

    if (principalesPorTipo[tipoContacto]) {
      return {
        ok: false,
        msg: `Solo puede existir un contacto principal para el tipo ${tipoContacto}.`,
      };
    }

    principalesPorTipo[tipoContacto] = true;
  }

  return {
    ok: true,
  };
};

// ====== Registrar laboratorio ======

const crearLaboratorioReferencia = async (req, res = response) => {
  try {
    const {
      nombreLaboratorio,
      razonSocial,
      ruc,
      codigoCliente,
      direccion,
      contactos,
      observacion,
      estadoLaboratorioReferencia,
    } = req.body;

    const { uid, nombreUsuario } = req.user;

    const nombreNormalizado = nombreLaboratorio?.trim().toUpperCase();

    if (!nombreNormalizado) {
      return res.status(400).json({
        ok: false,
        msg: "El nombre del laboratorio es obligatorio.",
      });
    }

    // ====== Validar nombre duplicado ======

    const laboratorioConMismoNombre = await LaboratorioReferencia.findOne({
      nombreLaboratorio: nombreNormalizado,
    });

    if (laboratorioConMismoNombre) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un laboratorio de referencia con ese nombre.",
      });
    }

    // ====== Validar RUC duplicado ======

    const rucNormalizado = ruc?.trim() ?? "";

    if (rucNormalizado) {
      const laboratorioConMismoRuc = await LaboratorioReferencia.findOne({
        ruc: rucNormalizado,
      });

      if (laboratorioConMismoRuc) {
        return res.status(400).json({
          ok: false,
          msg: "Ya existe un laboratorio de referencia con ese RUC.",
        });
      }
    }

    // ====== Validar contactos ======

    const contactosNormalizados = Array.isArray(contactos) ? contactos : [];

    const validacionContactos = validarContactosPrincipales(
      contactosNormalizados,
    );

    if (!validacionContactos.ok) {
      return res.status(400).json({
        ok: false,
        msg: validacionContactos.msg,
      });
    }

    // ====== Generar código ======

    const codLaboratorioReferencia = await generarCodigoLaboratorioReferencia();

    // ====== Crear ======

    const laboratorioReferencia = new LaboratorioReferencia({
      codLaboratorioReferencia,
      nombreLaboratorio: nombreNormalizado,
      razonSocial: razonSocial?.trim() ?? "",
      ruc: rucNormalizado,
      codigoCliente: codigoCliente?.trim() ?? "",
      direccion: direccion?.trim() ?? "",
      contactos: contactosNormalizados,
      observacion: observacion?.trim() ?? "",
      estadoLaboratorioReferencia: estadoLaboratorioReferencia ?? "ACTIVO",
      createdBy: uid,
      usuarioRegistro: nombreUsuario,
      fechaRegistro: new Date(),
    });

    await laboratorioReferencia.save();

    return res.status(201).json({
      ok: true,
      msg: "Laboratorio de referencia registrado correctamente.",
      laboratorioReferencia,
    });
  } catch (error) {
    console.error("Error al registrar laboratorio de referencia:", error);

    if (error?.code === 11000) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un laboratorio de referencia con esos datos.",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al registrar el laboratorio de referencia.",
    });
  }
};

// ====== Obtener laboratorios ======

const obtenerLaboratoriosReferencia = async (req, res = response) => {
  try {
    const { estado, search } = req.query;

    const filtro = {};

    // ====== Estado ======

    if (estado === "ACTIVO" || estado === "INACTIVO") {
      filtro.estadoLaboratorioReferencia = estado;
    }

    // ====== Búsqueda ======

    const termino = search?.trim();

    if (termino) {
      filtro.$or = [
        {
          codLaboratorioReferencia: {
            $regex: termino,
            $options: "i",
          },
        },
        {
          nombreLaboratorio: {
            $regex: termino,
            $options: "i",
          },
        },
        {
          razonSocial: {
            $regex: termino,
            $options: "i",
          },
        },
        {
          ruc: {
            $regex: termino,
            $options: "i",
          },
        },
        {
          codigoCliente: {
            $regex: termino,
            $options: "i",
          },
        },
        {
          "contactos.nombreContacto": {
            $regex: termino,
            $options: "i",
          },
        },
      ];
    }

    const laboratoriosReferencia = await LaboratorioReferencia.find(
      filtro,
    ).sort({
      nombreLaboratorio: 1,
    });

    return res.json({
      ok: true,
      total: laboratoriosReferencia.length,
      laboratoriosReferencia,
    });
  } catch (error) {
    console.error("Error al obtener laboratorios de referencia:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al obtener los laboratorios de referencia.",
    });
  }
};

// ====== Obtener laboratorio por ID ======

const obtenerLaboratorioReferenciaPorId = async (req, res = response) => {
  try {
    const { id } = req.params;

    const laboratorioReferencia = await LaboratorioReferencia.findById(id);

    if (!laboratorioReferencia) {
      return res.status(404).json({
        ok: false,
        msg: "Laboratorio de referencia no encontrado.",
      });
    }

    return res.json({
      ok: true,
      laboratorioReferencia,
    });
  } catch (error) {
    console.error("Error al obtener laboratorio de referencia:", error);

    return res.status(500).json({
      ok: false,
      msg: "Error al obtener el laboratorio de referencia.",
    });
  }
};

// ====== Actualizar laboratorio ======

const actualizarLaboratorioReferencia = async (req, res = response) => {
  try {
    const { id } = req.params;

    const { uid, nombreUsuario } = req.user;

    const laboratorioActual = await LaboratorioReferencia.findById(id);

    if (!laboratorioActual) {
      return res.status(404).json({
        ok: false,
        msg: "Laboratorio de referencia no encontrado.",
      });
    }

    const datosActualizados = {
      ...req.body,
    };

    // ====== Campos no modificables ======

    delete datosActualizados._id;
    delete datosActualizados.codLaboratorioReferencia;

    delete datosActualizados.createdBy;
    delete datosActualizados.usuarioRegistro;
    delete datosActualizados.fechaRegistro;

    delete datosActualizados.createdAt;
    delete datosActualizados.updatedAt;

    // ====== Normalizar nombre ======

    if (datosActualizados.nombreLaboratorio !== undefined) {
      datosActualizados.nombreLaboratorio = datosActualizados.nombreLaboratorio
        ?.trim()
        .toUpperCase();

      if (!datosActualizados.nombreLaboratorio) {
        return res.status(400).json({
          ok: false,
          msg: "El nombre del laboratorio es obligatorio.",
        });
      }

      const laboratorioConMismoNombre = await LaboratorioReferencia.findOne({
        nombreLaboratorio: datosActualizados.nombreLaboratorio,

        _id: {
          $ne: id,
        },
      });

      if (laboratorioConMismoNombre) {
        return res.status(400).json({
          ok: false,
          msg: "Ya existe otro laboratorio de referencia con ese nombre.",
        });
      }
    }

    // ====== Validar RUC ======

    if (datosActualizados.ruc !== undefined) {
      datosActualizados.ruc = datosActualizados.ruc?.trim() ?? "";

      if (datosActualizados.ruc) {
        const laboratorioConMismoRuc = await LaboratorioReferencia.findOne({
          ruc: datosActualizados.ruc,

          _id: {
            $ne: id,
          },
        });

        if (laboratorioConMismoRuc) {
          return res.status(400).json({
            ok: false,
            msg: "Ya existe otro laboratorio de referencia con ese RUC.",
          });
        }
      }
    }

    // ====== Validar contactos ======

    if (Array.isArray(datosActualizados.contactos)) {
      const validacionContactos = validarContactosPrincipales(
        datosActualizados.contactos,
      );

      if (!validacionContactos.ok) {
        return res.status(400).json({
          ok: false,
          msg: validacionContactos.msg,
        });
      }
    }

    // ====== Auditoría ======

    datosActualizados.updatedBy = uid;
    datosActualizados.usuarioActualizacion = nombreUsuario;
    datosActualizados.fechaActualizacion = new Date();

    const laboratorioReferencia = await LaboratorioReferencia.findByIdAndUpdate(
      id,
      datosActualizados,
      {
        new: true,
        runValidators: true,
      },
    );

    return res.json({
      ok: true,
      msg: "Laboratorio de referencia actualizado correctamente.",
      laboratorioReferencia,
    });
  } catch (error) {
    console.error("Error al actualizar laboratorio de referencia:", error);

    if (error?.code === 11000) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un laboratorio de referencia con esos datos.",
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al actualizar el laboratorio de referencia.",
    });
  }
};

// ====== Cambiar estado ======

const cambiarEstadoLaboratorioReferencia = async (req, res = response) => {
  try {
    const { id } = req.params;
    const { estadoLaboratorioReferencia } = req.body;
    const { uid, nombreUsuario } = req.user;

    if (!["ACTIVO", "INACTIVO"].includes(estadoLaboratorioReferencia)) {
      return res.status(400).json({
        ok: false,
        msg: "Estado de laboratorio no válido.",
      });
    }

    const laboratorioReferencia = await LaboratorioReferencia.findByIdAndUpdate(
      id,
      {
        estadoLaboratorioReferencia,
        updatedBy: uid,
        usuarioActualizacion: nombreUsuario,
        fechaActualizacion: new Date(),
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!laboratorioReferencia) {
      return res.status(404).json({
        ok: false,
        msg: "Laboratorio de referencia no encontrado.",
      });
    }

    return res.json({
      ok: true,
      msg:
        estadoLaboratorioReferencia === "ACTIVO"
          ? "Laboratorio de referencia activado correctamente."
          : "Laboratorio de referencia inactivado correctamente.",

      laboratorioReferencia,
    });
  } catch (error) {
    console.error(
      "Error al cambiar estado del laboratorio de referencia:",
      error,
    );

    return res.status(500).json({
      ok: false,
      msg: "Error al cambiar el estado del laboratorio de referencia.",
    });
  }
};

// ====== Exportaciones ======

module.exports = {
  crearLaboratorioReferencia,
  obtenerLaboratoriosReferencia,
  obtenerLaboratorioReferenciaPorId,
  actualizarLaboratorioReferencia,
  cambiarEstadoLaboratorioReferencia,
};
