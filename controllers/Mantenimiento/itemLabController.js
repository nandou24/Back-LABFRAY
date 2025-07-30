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
  } = req.body;

  try {
    // verificar si el nombre existe
    const itemExistente = await ItemLab.findOne({
      nombreInforme: { $regex: new RegExp(`^${nombreInforme}$`, "i") },
      perteneceAPrueba: { $regex: new RegExp(`^${perteneceAPrueba}$`, "i") },
    });

    console.log("Item existente:", itemExistente);

    if (itemExistente) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un item con ese nombre y prueba a la que pertenece",
      });
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
    const itemsLab = await ItemLab.find().sort({ createdAt: -1 });

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
    });
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

  try {
    // console.log('Datos recibidos:', req.body);

    const itemLab = await ItemLab.findOneAndUpdate(
      { codItemLab: codigo },
      { $set: datosActualizados },
      { new: true } // Devuelve el documento actualizado
    );

    if (!itemLab) {
      return res.status(404).json({
        ok: false,
        msg: "Item no encontrado con ese código",
      });
    }

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

module.exports = {
  crearItemLab,
  mostrarUltimosItems,
  encontrarTermino,
  actualizarItem,
};
