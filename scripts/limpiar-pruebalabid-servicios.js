const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const Servicio = require("../models/Mantenimiento/Servicio");

const aplicarCambios = process.argv.includes("--apply");

const MONGO_URI =
  process.env.DB_CNN ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.BD_CNN;

const ejecutar = async () => {
  if (!MONGO_URI) {
    throw new Error("No se encontró la cadena de conexión MongoDB.");
  }

  await mongoose.connect(MONGO_URI);

  console.log("");
  console.log("========================================");
  console.log(" LIMPIEZA pruebaLabId EN SERVICIOS");
  console.log("========================================");

  const filtro = {
    "examenesServicio.pruebaLabId": {
      $exists: true,
    },
  };

  const serviciosAfectados = await Servicio.collection.countDocuments(filtro);

  console.log(`Servicios con pruebaLabId: ${serviciosAfectados}`);

  if (!aplicarCambios) {
    console.log("");
    console.log("SIMULACIÓN. No se modificó ningún registro.");

    console.log("Para aplicar:");

    console.log("node scripts/limpiar-pruebalabid-servicios.js --apply");

    await mongoose.disconnect();
    return;
  }

  const resultado = await Servicio.collection.updateMany(filtro, {
    $unset: {
      "examenesServicio.$[].pruebaLabId": "",
    },
  });

  console.log("");
  console.log(`Documentos encontrados: ${resultado.matchedCount}`);

  console.log(`Documentos modificados: ${resultado.modifiedCount}`);

  console.log("");
  console.log("LIMPIEZA COMPLETADA.");

  await mongoose.disconnect();
};

ejecutar()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error);

    try {
      await mongoose.disconnect();
    } catch {}

    process.exit(1);
  });
