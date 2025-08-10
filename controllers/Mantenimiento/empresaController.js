const { response } = require("express");
const Empresa = require("../../models/Mantenimiento/Empresa");

const crearEmpresa = async (req, res = response) => {
  const { ruc, personasContacto } = req.body;

  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  try {
    // Verificar si ya existe una empresa con ese RUC
    const empresaExistente = await Empresa.findOne({ ruc });

    if (empresaExistente) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una empresa registrada con ese RUC",
      });
    }

    // Validar que al menos una persona de contacto sea principal
    const contactoPrincipal = personasContacto.find(
      (contacto) => contacto.principal === true
    );
    if (!contactoPrincipal) {
      // Si no hay ninguno marcado como principal, marcar el primero
      personasContacto[0].principal = true;
    }

    // Crear la nueva empresa
    const nuevaEmpresa = new Empresa({
      ...req.body,
      fechaRegistro: new Date(),
      estado: true,
      // Campos de auditoría
      createdBy: uid,
      usuarioRegistro: nombreUsuario,
      fechaRegistro: new Date(),
    });

    // Guardar en la base de datos
    const empresaGuardada = await nuevaEmpresa.save();

    res.status(201).json({
      ok: true,
      msg: "Empresa creada exitosamente",
      empresa: empresaGuardada,
    });
  } catch (error) {
    console.error("Error al crear empresa:", error);

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map(
        (err) => err.message
      );
      return res.status(400).json({
        ok: false,
        msg: "Error de validación",
        errors: validationErrors,
      });
    }

    res.status(500).json({
      ok: false,
      msg: "Error interno del servidor al crear la empresa",
      error: error.message,
    });
  }
};

const actualizarEmpresa = async (req, res = response) => {
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
  const datosActualizables = { ...req.body };
  console.log("datosActualizables", datosActualizables);
  const ruc = req.body.ruc;

  // Remover campos que no se deben actualizar directamente
  delete datosActualizables.ruc; // El RUC no se puede cambiar
  delete datosActualizables._id;
  delete datosActualizables.createdBy;
  delete datosActualizables.usuarioRegistro;
  delete datosActualizables.fechaRegistro;

  console.log("ruc", ruc);

  try {
    // Verificar que la empresa existe
    const empresaExistente = await Empresa.findOne({ ruc });

    if (!empresaExistente) {
      return res.status(404).json({
        ok: false,
        msg: "No se encontró una empresa con ese RUC",
      });
    }

    // Validar contacto principal si se están actualizando personas de contacto
    if (
      datosActualizables.personasContacto &&
      datosActualizables.personasContacto.length > 0
    ) {
      const contactoPrincipal = datosActualizables.personasContacto.find(
        (contacto) => contacto.principal === true
      );
      if (!contactoPrincipal) {
        // Si no hay ninguno marcado como principal, marcar el primero
        datosActualizables.personasContacto[0].principal = true;
      }
    }

    // Actualizar la empresa
    const empresaActualizada = await Empresa.findOneAndUpdate(
      { ruc },
      {
        $set: {
          ...datosActualizables,
          // Campos de auditoría
          updatedBy: uid,
          usuarioActualizacion: nombreUsuario,
          fechaActualizacion: new Date(),
        },
      },
      {
        new: true, // Retorna el documento actualizado
        runValidators: true, // Ejecuta las validaciones del modelo
      }
    );

    if (!empresaActualizada) {
      return res.status(404).json({
        ok: false,
        msg: "No se pudo actualizar la empresa",
      });
    }

    res.status(200).json({
      ok: true,
      msg: "Empresa actualizada exitosamente",
      empresa: empresaActualizada,
    });
  } catch (error) {
    console.error("Error al actualizar empresa:", error);

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map(
        (err) => err.message
      );
      return res.status(400).json({
        ok: false,
        msg: "Error de validación en los datos",
        errors: validationErrors,
      });
    }

    if (error.name === "CastError") {
      return res.status(400).json({
        ok: false,
        msg: "Formato de datos inválido",
      });
    }

    res.status(500).json({
      ok: false,
      msg: "Error interno del servidor al actualizar la empresa",
      error: error.message,
    });
  }
};

const obtenerEmpresas = async (req, res = response) => {
  try {
    const cantidad = req.query.cant;
    const desde = req.query.desde || 0;
    const limite = parseInt(cantidad);
    const skip = parseInt(desde);

    let empresas;
    let total;

    // Si no se especifica cantidad, mostrar todas las empresas
    if (cantidad == 0) {
      empresas = await Empresa.find({ estado: true })
        .sort({ createdAt: -1 })
        .lean();
      total = empresas.length;
    } else {
      // Si se especifica una cantidad, usar paginación
      empresas = await Empresa.find({ estado: true })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limite)
        .lean();

      // Obtener el total de empresas activas para la paginación
      total = await Empresa.countDocuments({ estado: true });
    }

    return res.json({
      ok: true,
      empresas,
      total,
      desde: skip,
      limite: limite || total,
    });
  } catch (error) {
    console.error("Error al obtener empresas:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error interno del servidor al obtener las empresas",
      error: error.message,
    });
  }
};

const buscarEmpresasPorTermino = async (req, res = response) => {
  const termino = req.params.termino;

  if (!termino || termino.trim() === "") {
    return res.status(400).json({
      ok: false,
      msg: "Debe proporcionar un término de búsqueda válido",
    });
  }

  try {
    const empresas = await Empresa.find({
      estado: true, // Solo empresas activas
      $or: [
        { ruc: { $regex: termino, $options: "i" } }, // Búsqueda por RUC
        { razonSocial: { $regex: termino, $options: "i" } }, // Búsqueda por razón social
        { nombreComercial: { $regex: termino, $options: "i" } }, // Búsqueda por nombre comercial
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      empresas,
    });
  } catch (error) {
    console.error("Error al buscar empresas:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error interno del servidor al buscar empresas",
      error: error.message,
    });
  }
};

module.exports = {
  crearEmpresa,
  actualizarEmpresa,
  obtenerEmpresas,
  buscarEmpresasPorTermino,
};
