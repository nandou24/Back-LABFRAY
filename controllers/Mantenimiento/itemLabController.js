const { response } = require("express");
const ItemLab = require("../../models/Mantenimiento/ItemLab");
const bcrypt = require("bcryptjs");
const { generarJWT } = require("../../helpers/jwt");
const jwt = require("jsonwebtoken");

const crearItemLab = async (req, res = response) => {
  console.log("Datos recibidos:", req.body);

  const {
    codItemLab,
    nombreInforme,
    metodoItemLab,
    plantillaValores,
    unidadesRef,
    poseeValidacion,
    perteneceAPrueba,
    paramValidacion,
    ordenImpresion,
    grupoItemLab,
  } = req.body;

  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  try {
    // verificar si el nombre existe
    const itemExistente = await ItemLab.findOne({
      nombreInforme: { $regex: new RegExp(`^${nombreInforme}$`, "i") },
      perteneceAPrueba: { $eq: perteneceAPrueba },
    });

    console.log("Item existente:", itemExistente);

    if (itemExistente) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un item con ese nombre y prueba a la que pertenece",
      });
    }

    // Validar que no exista el mismo número de orden de impresión
    if (ordenImpresion && perteneceAPrueba) {
      let consultaValidacion = {
        ordenImpresion: ordenImpresion,
        perteneceAPrueba: perteneceAPrueba,
      };

      // Si se proporciona grupoItemLab, incluirlo en la validación
      if (grupoItemLab) {
        consultaValidacion.grupoItemLab = grupoItemLab;
      }

      const itemConMismoOrden = await ItemLab.findOne(consultaValidacion);

      console.log("Item con mismo orden:", itemConMismoOrden);

      if (itemConMismoOrden) {
        const mensajeError = grupoItemLab
          ? `Ya existe el item "${itemConMismoOrden.nombreInforme}" con el orden de impresión ${ordenImpresion} para el mismo grupo y prueba`
          : `Ya existe el item "${itemConMismoOrden.nombreInforme}" con el orden de impresión ${ordenImpresion} para la misma prueba`;

        return res.status(400).json({
          ok: false,
          msg: mensajeError,
        });
      }
    }

    //creando codigo prueba
    // Buscar el último item

    const ultimoItem = await ItemLab.findOne().sort({ codItemLab: -1 });

    // 2. Generar el nuevo código
    let nuevoCodigo = 1; // Código inicial si no hay ítems

    if (ultimoItem) {
      // Extraemos solo el número del código, ejemplo: de "IL0005" extraemos "5"
      const numeroUltimo =
        parseInt(ultimoItem.codItemLab.replace("IL", "")) || 0;
      nuevoCodigo = numeroUltimo + 1;
    }

    // Formateamos: IL + número con 4 cifras
    const codItemLabFormateado = `IL${String(nuevoCodigo).padStart(4, "0")}`;
    console.log("Nuevo código generado:", codItemLabFormateado);

    // Crear la prueba con el código
    const nuevoItemLab = new ItemLab({
      ...req.body,
      codItemLab: codItemLabFormateado, // Agregar el código de la prueba generado
      createdBy: uid, // uid del usuario que creó el item
      usuarioRegistro: nombreUsuario, // Nombre de usuario que creó el item
      fechaRegistro: new Date(), // Fecha de registro
    });

    // console.log("Datos a grabar"+nuevoItemLab)

    await nuevoItemLab.save();
    // console.log(dbUser, "pasoo registro");
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      uid: nuevoItemLab.id,
      //token: token,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de registrar",
    });
  }
};

const mostrarUltimosItems = async (req, res = response) => {
  try {
    const itemsLab = await ItemLab.find()
      .populate("perteneceAPrueba", "codPruebaLab nombrePruebaLab")
      .sort({ createdAt: -1 });

    return res.json({
      ok: true,
      itemsLab,
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
  // console.log('TERMINO DE BUSQUEDA '+ termino)

  try {
    const itemsLab = await ItemLab.find({
      //nroDoc: { $regex: termino, $options: 'i'}

      $or: [
        { nombreInforme: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "nombre"
        { nombreHojaTrabajo: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "método"
        { perteneceA: { $regex: termino, $options: "i" } }, // Búsqueda en el campo "observación"
        // Agrega más campos si es necesario
      ],
    }).populate("perteneceAPrueba", "codPruebaLab nombrePruebaLab");
    return res.json({
      ok: true,
      itemsLab, //! favoritos: favoritos
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      ok: false,
      msg: "Error en la consulta",
    });
  }
};

const actualizarItem = async (req, res = response) => {
  const codigo = req.params.codigo; //recupera la hc
  const datosActualizados = req.body; //recupera los datos a grabar
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

  try {
    // console.log('Datos recibidos:', req.body);

    // Obtener el item actual para validaciones
    const itemActual = await ItemLab.findOne({ codItemLab: codigo });

    if (!itemActual) {
      return res.status(404).json({
        ok: false,
        msg: "Item no encontrado con ese código",
      });
    }

    // Validar que no exista el mismo número de orden de impresión (excluyendo el item actual)
    if (
      datosActualizados.ordenImpresion &&
      datosActualizados.perteneceAPrueba
    ) {
      let consultaValidacion = {
        ordenImpresion: datosActualizados.ordenImpresion,
        perteneceAPrueba: datosActualizados.perteneceAPrueba,
        _id: { $ne: itemActual._id }, // Excluir el item actual
      };

      // Si se proporciona grupoItemLab, incluirlo en la validación
      if (datosActualizados.grupoItemLab) {
        consultaValidacion.grupoItemLab = datosActualizados.grupoItemLab;
      }

      const itemConMismoOrden = await ItemLab.findOne(consultaValidacion);

      console.log("Item con mismo orden en actualización:", itemConMismoOrden);

      if (itemConMismoOrden) {
        const mensajeError = datosActualizados.grupoItemLab
          ? `Ya existe el item "${itemConMismoOrden.nombreInforme}" con el orden de impresión ${datosActualizados.ordenImpresion} para el mismo grupo y prueba`
          : `Ya existe el item "${itemConMismoOrden.nombreInforme}" con el orden de impresión ${datosActualizados.ordenImpresion} para la misma prueba`;

        return res.status(400).json({
          ok: false,
          msg: mensajeError,
        });
      }
    }

    const itemLab = await ItemLab.findOneAndUpdate(
      { codItemLab: codigo },
      {
        $set: datosActualizados,
        updatedBy: uid, // uid del usuario que actualiza el item
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza el item
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true } // Devuelve el documento actualizado
    );

    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.error("Error al actualizar el item: ", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};

const eliminarItem = async (req, res = response) => {
  const itemLabId = req.params.itemLabId; // Recupera el ID del item
  const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token
  console.log("ID del item a eliminar:", itemLabId);

  try {
    const itemLab = await ItemLab.findByIdAndDelete(itemLabId);

    if (!itemLab) {
      return res.status(404).json({
        ok: false,
        msg: "Item no encontrado",
      });
    }

    //Generar respuesta exitosa
    return res.status(200).json({
      ok: true,
      msg: "Item eliminado",
    });
  } catch (error) {
    console.error("Error al eliminar el item: ", error);
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de eliminar back end",
    });
  }
};

module.exports = {
  crearItemLab,
  mostrarUltimosItems,
  encontrarTermino,
  actualizarItem,
  eliminarItem,
};
