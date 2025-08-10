const { response } = require("express");
const Cotizacion =
  require("../../models/Gestion/CotizacionPaciente").CotizacionModel;
const mongoose = require("mongoose");

const crearCotizacion = async (req, res = response) => {
  try {
    const { historial, codCotizacion } = req.body;
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

    console.log("Datos recibidos:", req.body);

    // verificar si la cotización existe
    const cotizacion = await Cotizacion.findOne({ codCotizacion });

    if (cotizacion) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una cotización con ese código",
      });
    }

    // 📌 Validación: Los servicios cotizados son requeridos
    if (
      !historial ||
      historial.length === 0 ||
      !historial[0].serviciosCotizacion ||
      historial[0].serviciosCotizacion.length === 0
    ) {
      return res
        .status(400)
        .json({ ok: false, msg: "Debe agregar al menos un servicio" });
    }

    // Validación de clienteId
    const clienteId = historial[0].clienteId;
    if (!mongoose.Types.ObjectId.isValid(clienteId)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID del cliente no es válido",
      });
    }

    // Validación de solicitanteId
    const solicitanteId = historial[0].solicitanteId;
    if (solicitanteId) {
      if (!mongoose.Types.ObjectId.isValid(solicitanteId)) {
        return res.status(400).json({
          ok: false,
          msg: "El ID del solicitante no es válido",
        });
      }
    }

    // Validar IDs de médicos en servicios (si se usan)
    for (const servicio of historial[0].serviciosCotizacion) {
      if (servicio.medicoAtiende?.medicoId) {
        if (!mongoose.Types.ObjectId.isValid(servicio.medicoAtiende.medicoId)) {
          return res.status(400).json({
            ok: false,
            msg: "Uno de los IDs de médicos no es válido",
          });
        }
      }
    }

    // Generación de código correlativo
    const anioActual = new Date().getFullYear();
    const ultimaCotizacion = await Cotizacion.findOne({
      codCotizacion: new RegExp(`^${anioActual}-`),
    })
      .sort({ codCotizacion: -1 })
      .lean();

    // console.log(ultimaCotizacion + ' último servicio del área')

    // Obtener el correlativo
    let correlativo = 1;
    if (ultimaCotizacion) {
      const ultimoCodigo = ultimaCotizacion.codCotizacion;
      const ultimoNumero = parseInt(ultimoCodigo.split("-")[1], 10);
      // console.log(ultimoNumero +' ultimoCorrelativo')
      correlativo = ultimoNumero + 1;
      // console.log(correlativo+' correlativo')
    }

    if (correlativo > 999999) {
      return res.status(400).json({
        ok: false,
        msg: "El número máximo de cotizacione ha sido alcanzado para este año.",
      });
    }

    //Crear el nuevo código (Ejemplo: 2024-00001)
    const nuevoCodigo = `${anioActual}-${String(correlativo).padStart(5, "0")}`;

    // Crear el documento
    const nuevaCotizacion = new Cotizacion({
      ...req.body,
      codCotizacion: nuevoCodigo, // Agregar el código de la prueba generado
      historial: [
        {
          ...historial[0], // Tomamos los datos de la primera versión del historial
          version: 1, // Primera versión
          fechaModificacion: new Date(), // Fecha de creación
          createdBy: uid, // uid del usuario que creó la cotización
          usuarioRegistro: nombreUsuario, // Nombre de usuario que creó la cotización
          fechaRegistro: new Date(), // Fecha de registro
        },
      ],
    });

    // console.log("Datos a grabar"+nuevaCotizacion)

    await nuevaCotizacion.save();
    //Generar respuesta exitosa
    return res.status(200).json({
      ok: true,
      msg: "Cotización registrada con éxito",
      cotizacion: nuevaCotizacion,
      //token: token,
    });
  } catch (error) {
    console.error("Error al registrar la cotización:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimasCotizaciones = async (req, res = response) => {
  try {
    // Calcular la fecha de hace 7 días
    const fechaHaceUnaSemana = new Date();
    fechaHaceUnaSemana.setDate(fechaHaceUnaSemana.getDate() - 7);

    const cotizaciones = await Cotizacion.find({
      createdAt: { $gte: fechaHaceUnaSemana },
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      cotizaciones: cotizaciones,
    });
  } catch (error) {
    console.error("❌ Error al consultar cotizaciones:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const mostrarUltimasCotizacionesPorPagar = async (req, res = response) => {
  //console.log("entro a controlador mostrar cotizaciones por pagar")

  try {
    const fechaHaceUnaSemana = new Date();
    fechaHaceUnaSemana.setDate(fechaHaceUnaSemana.getDate() - 7);

    // const cantidad = req.query.cant;
    // const limite = parseInt(cantidad);

    const cotizaciones = await Cotizacion.find({
      estadoCotizacion: { $in: ["GENERADA", "MODIFICADA", "PAGO ANULADO"] },
      createdAt: { $gte: fechaHaceUnaSemana },
    })
      .sort({ createdAt: -1 })
      .lean();

    // 📌 Obtener solo la última versión del historial en cada cotización

    const cotizacionesConUltimaVersion = cotizaciones.map((cot) => ({
      ...cot,
      historial:
        cot.historial.length > 0
          ? [cot.historial[cot.historial.length - 1]]
          : [],
    }));

    return res.json({
      ok: true,
      cotizaciones: cotizacionesConUltimaVersion,
    });
  } catch (error) {
    console.error("❌ Error al consultar cotizaciones:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const mostrarUltimasCotizacionesPagadas = async (req, res = response) => {
  console.log("entro a controlador mostrar cotizaciones pagadas");

  try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);

    const cotizaciones = await Cotizacion.find({
      estadoCotizacion: { $in: ["PAGO TOTAL", "PAGO PARCIAL"] },
    })
      .sort({ createdAt: -1 })
      .limit(limite)
      .lean();

    // 📌 Obtener solo la última versión del historial en cada cotización

    const cotizacionesConUltimaVersion = cotizaciones.map((cot) => ({
      ...cot,
      historial:
        cot.historial.length > 0
          ? [cot.historial[cot.historial.length - 1]]
          : [],
    }));

    return res.json({
      ok: true,
      cotizaciones: cotizacionesConUltimaVersion,
    });
  } catch (error) {
    console.error("❌ Error al consultar cotizaciones:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTermino = async (req, res = response) => {
  const termino = req.query.search;
  console.log(termino);

  try {
    const cotizaciones = await Cotizacion.find({
      $or: [
        { codCotizacion: { $regex: termino, $options: "i" } },
        { "historial.nroDoc": { $regex: termino, $options: "i" } },
        { "historial.nombreCliente": { $regex: termino, $options: "i" } },
        { "historial.apePatCliente": { $regex: termino, $options: "i" } },
        { "historial.apeMatCliente": { $regex: termino, $options: "i" } },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(50); // 📌 Limita a 50 resultados;
    return res.json({
      ok: true,
      cotizaciones, //! favoritos: favoritos
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const crearNuevaVersionCotiPersona = async (req, res = response) => {
  try {
    const { codCotizacion, historial, estadoCotizacion } = req.body;
    console.log("Datos recibidos:", req.body);
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

    const cotizacionExistente = await Cotizacion.findOne({ codCotizacion });

    if (!cotizacionExistente) {
      return res.status(404).json({
        ok: false,
        msg: "La cotización no existe.",
      });
    }

    // console.log('Datos recibidos:', req.body);

    const ultimaVersion =
      cotizacionExistente.historial[cotizacionExistente.historial.length - 1];

    const nuevaVersion = {
      ...historial[0], // Tomamos el único historial enviado desde el frontend
      version: ultimaVersion ? ultimaVersion.version + 1 : 1, // Incrementamos la versión
      fechaModificacion: new Date(), // Generamos la nueva fecha
    };

    const objetosSonIguales = (obj1, obj2) => {
      // Clonamos los objetos profundamente para evitar mutaciones
      const obj1Clonado = JSON.parse(JSON.stringify(obj1));
      const obj2Clonado = JSON.parse(JSON.stringify(obj2));

      // Clonamos los objetos y eliminamos `fechaModificacion`
      delete obj1Clonado.fechaModificacion;
      delete obj2Clonado.fechaModificacion;
      delete obj1Clonado.version;
      delete obj2Clonado.version;
      delete obj1Clonado._id;
      delete obj2Clonado._id;
      // 📌 Si existe `serviciosCotizacion`, eliminamos `_id` en cada servicio
      if (obj1Clonado.serviciosCotizacion && obj2Clonado.serviciosCotizacion) {
        obj1Clonado.serviciosCotizacion.forEach(
          (servicio) => delete servicio._id
        );
        obj2Clonado.serviciosCotizacion.forEach(
          (servicio) => delete servicio._id
        );

        // 📌 Ordenamos los servicios para evitar diferencias por el orden
        obj1Clonado.serviciosCotizacion.sort((a, b) =>
          a.codServicio.localeCompare(b.codServicio)
        );
        obj2Clonado.serviciosCotizacion.sort((a, b) =>
          a.codServicio.localeCompare(b.codServicio)
        );
      }

      return JSON.stringify(obj1Clonado) === JSON.stringify(obj2Clonado);
    };

    // 🔄 Verificación opcional: Evitar versiones duplicadas si no hubo cambios
    if (objetosSonIguales(nuevaVersion, ultimaVersion)) {
      return res.status(400).json({
        ok: false,
        msg: "No hay cambios para generar una nueva versión.",
      });
    }

    const cotizacionActualizada = await Cotizacion.findOneAndUpdate(
      { codCotizacion },
      {
        $push: { historial: nuevaVersion }, // 📌 Agregar nueva versión al historial
        $set: {
          estadoCotizacion: estadoCotizacion || "MODIFICADA",
          fechaModificacion: nuevaVersion.fechaModificacion,
          updatedBy: uid, // uid del usuario que actualiza
          usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
          fechaActualizacion: new Date(), // Fecha de actualización
        }, // 📌 Actualizar estado
      },
      { new: true }
    );

    if (cotizacionActualizada) {
      //Generar respuesta exitosa
      return res.status(200).json({
        ok: true,
        msg: "Nueva versión de la cotización agregada con éxito.",
        //uid: dbPaciente.id,
        //token: token,
      });
    }
  } catch (error) {
    console.error("Error al generar nueva versión de la cotización:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error interno al generar la nueva versión de la cotización.",
    });
  }
};

const verificarHcRegistrada = async (req, res = response) => {
  try {
    const { codCotizacion } = req.query;

    const cotizacion = await Cotizacion.findOne({ codCotizacion }).lean();

    if (!cotizacion) {
      return res.status(404).json({
        ok: false,
        msg: "Cotización no encontrada.",
      });
    }

    // Se asume que la propiedad 'hc' está en el objeto cotización o en la última versión del historial
    let hcRegistrada = false;

    if (
      cotizacion.historial &&
      cotizacion.historial.length > 0 &&
      cotizacion.historial[cotizacion.historial.length - 1].hc
    ) {
      hcRegistrada = true;
    }

    return res.json({
      ok: true,
      hcRegistrada,
    });
  } catch (error) {
    console.error("Error al verificar HC registrada:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al verificar HC registrada.",
    });
  }
};

module.exports = {
  crearCotizacion,
  mostrarUltimasCotizaciones,
  encontrarTermino,
  crearNuevaVersionCotiPersona,
  mostrarUltimasCotizacionesPorPagar,
  mostrarUltimasCotizacionesPagadas,
  verificarHcRegistrada,
};
