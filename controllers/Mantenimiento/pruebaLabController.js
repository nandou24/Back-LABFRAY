const { response } = require("express");
const PruebaLab = require("../../models/Mantenimiento/PruebaLab");
const bcrypt = require("bcryptjs");
const { generarJWT } = require("../../helpers/jwt");
const jwt = require("jsonwebtoken");

const crearPruebaLab = async (req, res = response) => {
  const { nombrePruebaLab, ordenImpresion } = req.body;
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  const prefijoCodigo = "LC";

  try {
    // verificar si la prueba existe
    const pruebaLab = await PruebaLab.findOne({ nombrePruebaLab });

    if (pruebaLab) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe una prueba con ese nombre",
      });
    }

    // Validar que no exista el mismo número de orden de impresión
    if (ordenImpresion) {
      const pruebaConMismoOrden = await PruebaLab.findOne({ ordenImpresion });

      console.log("Prueba con mismo orden:", pruebaConMismoOrden);

      if (pruebaConMismoOrden) {
        return res.status(400).json({
          ok: false,
          msg: `Ya existe la prueba "${pruebaConMismoOrden.nombrePruebaLab}" con el orden de impresión ${ordenImpresion}`,
        });
      }
    }

    //creando codigo prueba
    // Buscar el última prueba creada en el área
    const ultimaPrueba = await PruebaLab.findOne().sort({ codPruebaLab: -1 });

    // Obtener el correlativo
    let correlativo = 1;
    if (ultimaPrueba) {
      const ultimoCorrelativo = parseInt(ultimaPrueba.codPruebaLab.slice(2, 6));
      correlativo = ultimoCorrelativo + 1;
    }

    if (correlativo > 9999) {
      return res.status(400).json({
        ok: false,
        msg: "El número máximo de pruebas ha sido alcanzado para este área.",
      });
    }

    // Correlativo con seis dígitos, maximo 9999
    const correlativoStr = correlativo.toString().padStart(4, "0");

    // Crear el número de código
    const codigoLab = `${prefijoCodigo}${correlativoStr}`;

    // Crear la prueba con el código
    const nuevaPruebaLab = new PruebaLab({
      ...req.body,
      codPruebaLab: codigoLab, // Agregar el código de la prueba generado
      createdBy: uid, // uid del usuario que creó la prueba
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó la prueba
      fechaRegistro: new Date(), // Fecha de registro
    });

    await nuevaPruebaLab.save();
    // console.log(dbUser, "pasoo registro");
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      uid: nuevaPruebaLab.id,
      //token: token,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimasPruebas = async (req, res = response) => {
  try {
    const pruebasLab = await PruebaLab.find()
      .populate({
        path: "itemsComponentes.itemLabId",
        populate: {
          path: "perteneceAPrueba",
          model: "pruebasLabCollection",
          select: "codPruebaLab nombrePruebaLab"
        }
      })
      .sort({ createdAt: -1 });

    return res.json({
      ok: true,
      pruebasLab,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const encontrarTermino = async (req, res = response) => {
  const termino = req.query.search;

  try {
    const pruebasLab = await PruebaLab.find({
      //nroDoc: { $regex: termino, $options: 'i'}

      $or: [
        { nombrePruebaLab: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nombre"
        { codPruebaLab: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "apellido paterno"
        // Agrega más campos si es necesario
      ],
    });
    return res.json({
      ok: true,
      pruebasLab, //! favoritos: favoritos
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const actualizarPrueba = async (req, res = response) => {
  const codPrueba = req.params.codPruebaLab; //recupera el codPrueba
  const datosActualizados = req.body; //recupera los datos a grabar
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
  delete datosActualizados._id; //quita los _id generados por el mongo y que no se pueden modificar
  delete datosActualizados.itemsComponentes._id;

  try {
    // Obtener la prueba actual para validaciones
    const pruebaActual = await PruebaLab.findOne({ codPruebaLab: codPrueba });
    
    if (!pruebaActual) {
      return res.status(404).json({
        ok: false,
        msg: "Prueba no encontrada con ese código",
      });
    }

    // Validar que no exista el mismo número de orden de impresión (excluyendo la prueba actual)
    if (datosActualizados.ordenImpresion) {
      const pruebaConMismoOrden = await PruebaLab.findOne({
        ordenImpresion: datosActualizados.ordenImpresion,
        _id: { $ne: pruebaActual._id }, // Excluir la prueba actual
      });

      console.log("Prueba con mismo orden en actualización:", pruebaConMismoOrden);

      if (pruebaConMismoOrden) {
        return res.status(400).json({
          ok: false,
          msg: `Ya existe la prueba "${pruebaConMismoOrden.nombrePruebaLab}" con el orden de impresión ${datosActualizados.ordenImpresion}`,
        });
      }
    }

    const pruebaLab = await PruebaLab.findOneAndUpdate(
      { codPruebaLab: codPrueba },
      {
        $set: datosActualizados,
        updatedBy: uid, // uid del usuario que actualiza
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true }
    );

    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      //uid: dbPaciente.id,
      //token: token,
    });
  } catch (error) {
    console.error("Error al actualizar la prueba: ", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};

module.exports = {
  crearPruebaLab,
  mostrarUltimasPruebas,
  encontrarTermino,
  actualizarPrueba,
};
