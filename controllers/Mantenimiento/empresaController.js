const { response } = require("express");
const Empresa = require("../../models/Mantenimiento/Empresa");
const CotizacionEmpresa =
  require("../../models/Gestion/CotizacionEmpresa").CotizacionModel;

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

  // Extraer arrays que necesitan tratamiento especial
  const personasContacto = datosActualizables.personasContacto;
  const ubicacionesSedes = datosActualizables.ubicacionesSedes;

  // Remover campos que no se deben actualizar directamente
  delete datosActualizables.ruc; // El RUC no se puede cambiar
  delete datosActualizables._id;
  delete datosActualizables.createdBy;
  delete datosActualizables.usuarioRegistro;
  delete datosActualizables.fechaRegistro;
  delete datosActualizables.personasContacto; // Lo manejamos por separado
  delete datosActualizables.ubicacionesSedes; // Lo manejamos por separado

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

    // 📌 MANEJO ESPECIAL DE PERSONAS DE CONTACTO
    if (personasContacto && personasContacto.length > 0) {
      // Validar contacto principal
      const contactoPrincipal = personasContacto.find(
        (contacto) => contacto.principal === true
      );
      if (!contactoPrincipal) {
        // Si no hay ninguno marcado como principal, marcar el primero
        personasContacto[0].principal = true;
      }

      // Preservar IDs existentes y manejar nuevos/actualizados
      const personasActualizadas = personasContacto.map((persona) => {
        if (persona._id) {
          // Si tiene _id, es una persona existente - preservar el ID
          return {
            _id: persona._id,
            nombre: persona.nombre,
            cargo: persona.cargo,
            telefono: persona.telefono,
            email: persona.email,
            principal: persona.principal,
          };
        } else {
          // Si no tiene _id, es una persona nueva - MongoDB generará un nuevo ID
          return {
            nombre: persona.nombre,
            cargo: persona.cargo,
            telefono: persona.telefono,
            email: persona.email,
            principal: persona.principal,
          };
        }
      });

      datosActualizables.personasContacto = personasActualizadas;
    }

    // 📌 MANEJO ESPECIAL DE UBICACIONES/SEDES
    if (ubicacionesSedes && ubicacionesSedes.length > 0) {
      const ubicacionesActualizadas = ubicacionesSedes.map((sede) => {
        if (sede._id) {
          // Si tiene _id, es una sede existente - preservar el ID
          return {
            _id: sede._id,
            nombreSede: sede.nombreSede,
            direccionSede: sede.direccionSede,
            departamentoSede: sede.departamentoSede,
            provinciaSede: sede.provinciaSede,
            distritoSede: sede.distritoSede,
            referenciasSede: sede.referenciasSede,
            coordenadasMaps: sede.coordenadasMaps,
            telefonoSede: sede.telefonoSede,
            emailSede: sede.emailSede,
            observacionesSede: sede.observacionesSede,
          };
        } else {
          // Si no tiene _id, es una sede nueva - MongoDB generará un nuevo ID
          return {
            nombreSede: sede.nombreSede,
            direccionSede: sede.direccionSede,
            departamentoSede: sede.departamentoSede,
            provinciaSede: sede.provinciaSede,
            distritoSede: sede.distritoSede,
            referenciasSede: sede.referenciasSede,
            coordenadasMaps: sede.coordenadasMaps,
            telefonoSede: sede.telefonoSede,
            emailSede: sede.emailSede,
            observacionesSede: sede.observacionesSede,
          };
        }
      });

      datosActualizables.ubicacionesSedes = ubicacionesActualizadas;
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
  const termino = req.query.termino;

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

// 📌 Método para eliminar contacto específico
const eliminarContactoEmpresa = async (req, res = response) => {
  const { ruc, contactoId } = req.params;
  const { uid, nombreUsuario } = req.user;

  try {
    const empresa = await Empresa.findOne({ ruc });

    if (!empresa) {
      return res.status(404).json({
        ok: false,
        msg: "Empresa no encontrada",
      });
    }

    // Verificar que el contacto existe
    const contactoExiste = empresa.personasContacto.id(contactoId);
    if (!contactoExiste) {
      return res.status(404).json({
        ok: false,
        msg: "Contacto no encontrado",
      });
    }

    // 🔍 VALIDACIÓN: Verificar si existen cotizaciones vinculadas al contacto
    const cotizacionesVinculadas = await CotizacionEmpresa.find({
      "historial.dirigidoA_Id": contactoId,
    }).lean();

    if (cotizacionesVinculadas && cotizacionesVinculadas.length > 0) {
      return res.status(400).json({
        ok: false,
        msg: `No se puede eliminar este contacto porque tiene ${cotizacionesVinculadas.length} cotización(es) vinculada(s). Primero debe actualizar o eliminar las cotizaciones relacionadas.`,
        cotizacionesVinculadas: cotizacionesVinculadas.map((cot) => ({
          codCotizacion: cot.codCotizacion,
          estadoCotizacion: cot.estadoCotizacion,
          fechaCreacion: cot.createdAt,
        })),
      });
    }

    // Eliminar el contacto usando pull
    const empresaActualizada = await Empresa.findOneAndUpdate(
      { ruc },
      {
        $pull: { personasContacto: { _id: contactoId } },
        $set: {
          updatedBy: uid,
          usuarioActualizacion: nombreUsuario,
          fechaActualizacion: new Date(),
        },
      },
      { new: true }
    );

    // Si el contacto eliminado era principal, marcar otro como principal
    const contactoPrincipal = empresaActualizada.personasContacto.find(
      (contacto) => contacto.principal === true
    );

    if (!contactoPrincipal && empresaActualizada.personasContacto.length > 0) {
      empresaActualizada.personasContacto[0].principal = true;
      await empresaActualizada.save();
    }

    res.status(200).json({
      ok: true,
      msg: "Contacto eliminado exitosamente",
      empresa: empresaActualizada,
    });
  } catch (error) {
    console.error("Error al eliminar contacto:", error);
    res.status(500).json({
      ok: false,
      msg: "Error interno del servidor al eliminar contacto",
      error: error.message,
    });
  }
};

// 📌 Método para eliminar sede específica
const eliminarSedeEmpresa = async (req, res = response) => {
  const { ruc, sedeId } = req.params;
  const { uid, nombreUsuario } = req.user;

  try {
    const empresa = await Empresa.findOne({ ruc });

    if (!empresa) {
      return res.status(404).json({
        ok: false,
        msg: "Empresa no encontrada",
      });
    }

    // Verificar que la sede existe
    const sedeExiste = empresa.ubicacionesSedes.id(sedeId);
    if (!sedeExiste) {
      return res.status(404).json({
        ok: false,
        msg: "Sede no encontrada",
      });
    }

    // Eliminar la sede usando pull
    const empresaActualizada = await Empresa.findOneAndUpdate(
      { ruc },
      {
        $pull: { ubicacionesSedes: { _id: sedeId } },
        $set: {
          updatedBy: uid,
          usuarioActualizacion: nombreUsuario,
          fechaActualizacion: new Date(),
        },
      },
      { new: true }
    );

    res.status(200).json({
      ok: true,
      msg: "Sede eliminada exitosamente",
      empresa: empresaActualizada,
    });
  } catch (error) {
    console.error("Error al eliminar sede:", error);
    res.status(500).json({
      ok: false,
      msg: "Error interno del servidor al eliminar sede",
      error: error.message,
    });
  }
};

// 📌 Método para verificar cotizaciones vinculadas a un contacto
const verificarCotizacionesVinculadasContacto = async (req, res = response) => {
  const { ruc, contactoId } = req.params;

  try {
    const empresa = await Empresa.findOne({ ruc });

    if (!empresa) {
      return res.status(404).json({
        ok: false,
        msg: "Empresa no encontrada",
      });
    }

    // Verificar que el contacto existe
    const contactoExiste = empresa.personasContacto.id(contactoId);
    if (!contactoExiste) {
      return res.status(404).json({
        ok: false,
        msg: "Contacto no encontrado",
      });
    }

    // Buscar cotizaciones vinculadas
    const cotizacionesVinculadas = await CotizacionEmpresa.find({
      "historial.dirigidoA_Id": contactoId,
    })
      .select("codCotizacion estadoCotizacion createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      ok: true,
      contacto: {
        _id: contactoExiste._id,
        nombre: contactoExiste.nombre,
        cargo: contactoExiste.cargo,
        email: contactoExiste.email,
        telefono: contactoExiste.telefono,
      },
      totalCotizaciones: cotizacionesVinculadas.length,
      puedeEliminar: cotizacionesVinculadas.length === 0,
      cotizacionesVinculadas: cotizacionesVinculadas,
    });
  } catch (error) {
    console.error("Error al verificar cotizaciones vinculadas:", error);
    res.status(500).json({
      ok: false,
      msg: "Error interno del servidor al verificar cotizaciones",
      error: error.message,
    });
  }
};

module.exports = {
  crearEmpresa,
  actualizarEmpresa,
  obtenerEmpresas,
  buscarEmpresasPorTermino,
  eliminarContactoEmpresa,
  eliminarSedeEmpresa,
  verificarCotizacionesVinculadasContacto,
};
