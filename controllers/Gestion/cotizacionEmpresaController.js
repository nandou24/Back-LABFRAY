const { response } = require("express");
const CotizacionEmpresa =
  require("../../models/Gestion/CotizacionEmpresa").CotizacionModel;
const mongoose = require("mongoose");

const crearCotizacionEmpresa = async (req, res = response) => {
  try {
    const { historial, codCotizacion } = req.body;
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

    console.log("Datos recibidos:", req.body);

    // verificar si la cotización existe
    const cotizacion = await CotizacionEmpresa.findOne({ codCotizacion });

    if (cotizacion) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una cotización empresarial con ese código",
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

    // Validación de empresaId
    const empresaId = historial[0].empresaId;
    if (!mongoose.Types.ObjectId.isValid(empresaId)) {
      return res.status(400).json({
        ok: false,
        msg: "El ID de la empresa no es válido",
      });
    }

    // Validación de RUC
    const ruc = historial[0].ruc;
    if (!ruc || ruc.trim() === "") {
      return res.status(400).json({
        ok: false,
        msg: "El RUC de la empresa es requerido",
      });
    }

    // Validación de razón social
    const razonSocial = historial[0].razonSocial;
    if (!razonSocial || razonSocial.trim() === "") {
      return res.status(400).json({
        ok: false,
        msg: "La razón social de la empresa es requerida",
      });
    }

    // Validar IDs de servicios
    for (const servicio of historial[0].serviciosCotizacion) {
      if (servicio.servicioId) {
        if (!mongoose.Types.ObjectId.isValid(servicio.servicioId)) {
          return res.status(400).json({
            ok: false,
            msg: "Uno de los IDs de servicios no es válido",
          });
        }
      }
    }

    // Generación de código correlativo para empresa
    const anioActual = new Date().getFullYear();
    const ultimaCotizacion = await CotizacionEmpresa.findOne({
      codCotizacion: new RegExp(`^EMP-${anioActual}-`),
    })
      .sort({ codCotizacion: -1 })
      .lean();

    // Obtener el correlativo
    let correlativo = 1;
    if (ultimaCotizacion) {
      const ultimoCodigo = ultimaCotizacion.codCotizacion;
      const ultimoNumero = parseInt(ultimoCodigo.split("-")[2], 10);
      correlativo = ultimoNumero + 1;
    }

    if (correlativo > 9999) {
      return res.status(400).json({
        ok: false,
        msg: "El número máximo de cotizaciones empresariales ha sido alcanzado para este año.",
      });
    }

    //Crear el nuevo código (Ejemplo: EMP-2024-0001)
    const nuevoCodigo = `EMP-${anioActual}-${String(correlativo).padStart(
      4,
      "0"
    )}`;

    // Crear el documento
    const nuevaCotizacion = new CotizacionEmpresa({
      ...req.body,
      codCotizacion: nuevoCodigo, // Agregar el código de la cotización generado
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

    await nuevaCotizacion.save();
    //Generar respuesta exitosa
    return res.status(200).json({
      ok: true,
      msg: "Cotización empresarial registrada con éxito",
      cotizacion: nuevaCotizacion,
    });
  } catch (error) {
    console.error("Error al registrar la cotización empresarial:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimasCotizacionesEmpresa = async (req, res = response) => {
  try {
    // Calcular la fecha de hace 7 días
    const fechaHaceUnaSemana = new Date();
    fechaHaceUnaSemana.setDate(fechaHaceUnaSemana.getDate() - 7);

    const cotizaciones = await CotizacionEmpresa.find({
      createdAt: { $gte: fechaHaceUnaSemana },
    })
      .populate(
        "historial.empresaId",
        "razonSocial ruc personasContacto direccionFiscal distrito provincia departamento"
      )
      .sort({ createdAt: -1 })
      .lean();

    // 📌 Procesar las cotizaciones para extraer los datos del contacto
    const cotizacionesConContacto = cotizaciones.map((cotizacion) => {
      // Procesamos cada entrada del historial
      const historialConContacto = cotizacion.historial.map((entrada) => {
        let contactoInfo = null;

        // Si tenemos la empresa poblada y el dirigidoA_Id
        if (
          entrada.empresaId &&
          entrada.empresaId.personasContacto &&
          entrada.dirigidoA_Id
        ) {
          // Buscamos la persona de contacto en el array
          contactoInfo = entrada.empresaId.personasContacto.find(
            (persona) =>
              persona._id.toString() === entrada.dirigidoA_Id.toString()
          );
        }

        return {
          ...entrada,
          dirigidoA: contactoInfo || null, // Agregamos la info del contacto
        };
      });

      return {
        ...cotizacion,
        historial: historialConContacto,
      };
    });

    return res.json({
      ok: true,
      cotizaciones: cotizacionesConContacto,
    });
  } catch (error) {
    console.error("❌ Error al consultar cotizaciones empresariales:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const mostrarUltimasCotizacionesEmpresaPorPagar = async (
  req,
  res = response
) => {
  try {
    const fechaHaceUnaSemana = new Date();
    fechaHaceUnaSemana.setDate(fechaHaceUnaSemana.getDate() - 7);

    const cotizaciones = await CotizacionEmpresa.find({
      estadoCotizacion: { $in: ["GENERADA", "MODIFICADA", "PAGO ANULADO"] },
      createdAt: { $gte: fechaHaceUnaSemana },
    })
      .populate(
        "historial.empresaId",
        "razonSocial ruc personasContacto direccionFiscal distrito provincia departamento"
      )
      .sort({ createdAt: -1 })
      .lean();

    // 📌 Obtener solo la última versión del historial en cada cotización y agregar contacto
    const cotizacionesConUltimaVersion = cotizaciones.map((cot) => {
      const ultimaEntrada =
        cot.historial.length > 0
          ? cot.historial[cot.historial.length - 1]
          : null;

      let contactoInfo = null;
      if (
        ultimaEntrada &&
        ultimaEntrada.empresaId &&
        ultimaEntrada.empresaId.personasContacto &&
        ultimaEntrada.dirigidoA_Id
      ) {
        contactoInfo = ultimaEntrada.empresaId.personasContacto.find(
          (persona) =>
            persona._id.toString() === ultimaEntrada.dirigidoA_Id.toString()
        );
      }

      return {
        ...cot,
        historial: ultimaEntrada
          ? [
              {
                ...ultimaEntrada,
                dirigidoA: contactoInfo || null,
              },
            ]
          : [],
      };
    });

    return res.json({
      ok: true,
      cotizaciones: cotizacionesConUltimaVersion,
    });
  } catch (error) {
    console.error("❌ Error al consultar cotizaciones empresariales:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const mostrarUltimasCotizacionesEmpresaPagadas = async (
  req,
  res = response
) => {
  console.log("entro a controlador mostrar cotizaciones empresariales pagadas");

  try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);

    const cotizaciones = await CotizacionEmpresa.find({
      estadoCotizacion: { $in: ["PAGO TOTAL", "PAGO PARCIAL"] },
    })
      .populate(
        "historial.empresaId",
        "razonSocial ruc personasContacto direccionFiscal distrito provincia departamento"
      )
      .sort({ createdAt: -1 })
      .limit(limite)
      .lean();

    // 📌 Obtener solo la última versión del historial en cada cotización y agregar contacto
    const cotizacionesConUltimaVersion = cotizaciones.map((cot) => {
      const ultimaEntrada =
        cot.historial.length > 0
          ? cot.historial[cot.historial.length - 1]
          : null;

      let contactoInfo = null;
      if (
        ultimaEntrada &&
        ultimaEntrada.empresaId &&
        ultimaEntrada.empresaId.personasContacto &&
        ultimaEntrada.dirigidoA_Id
      ) {
        contactoInfo = ultimaEntrada.empresaId.personasContacto.find(
          (persona) =>
            persona._id.toString() === ultimaEntrada.dirigidoA_Id.toString()
        );
      }

      return {
        ...cot,
        historial: ultimaEntrada
          ? [
              {
                ...ultimaEntrada,
                dirigidoA: contactoInfo || null,
              },
            ]
          : [],
      };
    });

    return res.json({
      ok: true,
      cotizaciones: cotizacionesConUltimaVersion,
    });
  } catch (error) {
    console.error("❌ Error al consultar cotizaciones empresariales:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTerminoEmpresa = async (req, res = response) => {
  const termino = req.query.search;
  console.log(termino);

  try {
    const cotizaciones = await CotizacionEmpresa.find({
      $or: [
        { codCotizacion: { $regex: termino, $options: "i" } },
        { "historial.ruc": { $regex: termino, $options: "i" } },
        { "historial.razonSocial": { $regex: termino, $options: "i" } },
      ],
    })
      .populate(
        "historial.empresaId",
        "razonSocial ruc personasContacto direccionFiscal distrito provincia departamento"
      )
      .sort({ updatedAt: -1 })
      .limit(50) // 📌 Limita a 50 resultados
      .lean();

    // 📌 Procesar las cotizaciones para extraer los datos del contacto
    const cotizacionesConContacto = cotizaciones.map((cotizacion) => {
      const historialConContacto = cotizacion.historial.map((entrada) => {
        let contactoInfo = null;

        if (
          entrada.empresaId &&
          entrada.empresaId.personasContacto &&
          entrada.dirigidoA_Id
        ) {
          contactoInfo = entrada.empresaId.personasContacto.find(
            (persona) =>
              persona._id.toString() === entrada.dirigidoA_Id.toString()
          );
        }

        return {
          ...entrada,
          dirigidoA: contactoInfo || null,
        };
      });

      return {
        ...cotizacion,
        historial: historialConContacto,
      };
    });

    return res.json({
      ok: true,
      cotizaciones: cotizacionesConContacto,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const crearNuevaVersionCotiEmpresa = async (req, res = response) => {
  try {
    const { codCotizacion, historial, estadoCotizacion } = req.body;
    console.log("Datos recibidos:", req.body);
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

    const cotizacionExistente = await CotizacionEmpresa.findOne({
      codCotizacion,
    });

    if (!cotizacionExistente) {
      return res.status(404).json({
        ok: false,
        msg: "La cotización empresarial no existe.",
      });
    }

    const ultimaVersion =
      cotizacionExistente.historial[cotizacionExistente.historial.length - 1];

    const nuevaVersion = {
      ...historial[0], // Tomamos el único historial enviado desde el frontend
      version: ultimaVersion ? ultimaVersion.version + 1 : 1, // Incrementamos la versión
      fechaModificacion: new Date(), // Generamos la nueva fecha
      createdBy: uid, // uid del usuario que actualiza
      usuarioRegistro: nombreUsuario, // Nombre de usuario que actualiza
      fechaRegistro: new Date(), // Fecha de actualización
    };

    const objetosSonIguales = (obj1, obj2) => {
      // Clonamos los objetos profundamente para evitar mutaciones
      const obj1Clonado = JSON.parse(JSON.stringify(obj1));
      const obj2Clonado = JSON.parse(JSON.stringify(obj2));

      // Eliminamos campos que no deben compararse
      delete obj1Clonado.fechaModificacion;
      delete obj2Clonado.fechaModificacion;
      delete obj1Clonado.version;
      delete obj2Clonado.version;
      delete obj1Clonado._id;
      delete obj2Clonado._id;
      delete obj1Clonado.createdBy;
      delete obj2Clonado.createdBy;
      delete obj1Clonado.usuarioRegistro;
      delete obj2Clonado.usuarioRegistro;
      delete obj1Clonado.fechaRegistro;
      delete obj2Clonado.fechaRegistro;

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

    const cotizacionActualizada = await CotizacionEmpresa.findOneAndUpdate(
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
        msg: "Nueva versión de la cotización empresarial agregada con éxito.",
      });
    }
  } catch (error) {
    console.error(
      "Error al generar nueva versión de la cotización empresarial:",
      error
    );
    return res.status(500).json({
      ok: false,
      msg: "Error interno al generar la nueva versión de la cotización empresarial.",
    });
  }
};

const obtenerCotizacionEmpresaPorCodigo = async (req, res = response) => {
  try {
    const { codCotizacion } = req.params;

    const cotizacion = await CotizacionEmpresa.findOne({ codCotizacion })
      .populate(
        "historial.empresaId",
        "razonSocial ruc personasContacto direccionFiscal distrito provincia departamento"
      )
      .lean();

    if (!cotizacion) {
      return res.status(404).json({
        ok: false,
        msg: "Cotización empresarial no encontrada.",
      });
    }

    // 📌 Procesar el historial para extraer los datos del contacto
    const historialConContacto = cotizacion.historial.map((entrada) => {
      let contactoInfo = null;

      // Si tenemos la empresa poblada y el dirigidoA_Id
      if (
        entrada.empresaId &&
        entrada.empresaId.personasContacto &&
        entrada.dirigidoA_Id
      ) {
        // Buscamos la persona de contacto en el array
        contactoInfo = entrada.empresaId.personasContacto.find(
          (persona) =>
            persona._id.toString() === entrada.dirigidoA_Id.toString()
        );
      }

      return {
        ...entrada,
        dirigidoA: contactoInfo || null, // Agregamos la info del contacto
      };
    });

    const cotizacionConContacto = {
      ...cotizacion,
      historial: historialConContacto,
    };

    return res.json({
      ok: true,
      cotizacion: cotizacionConContacto,
    });
  } catch (error) {
    console.error("Error al obtener cotización empresarial:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al obtener cotización empresarial.",
    });
  }
};

module.exports = {
  crearCotizacionEmpresa,
  mostrarUltimasCotizacionesEmpresa,
  encontrarTerminoEmpresa,
  crearNuevaVersionCotiEmpresa,
  mostrarUltimasCotizacionesEmpresaPorPagar,
  mostrarUltimasCotizacionesEmpresaPagadas,
  obtenerCotizacionEmpresaPorCodigo,
};
