const path = require("path");
const mongoose = require("mongoose");

// ====== Cargar variables de entorno ======

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const SolicitudAtencion = require("../models/Gestion/SolicitudAtencion");
const {
  sincronizarCompromisosSolicitud,
} = require("../utils/Gestion/compromisoEntregaLaboratorio");

// ====== Configuración ======

const aplicarCambios = process.argv.includes("--apply");

const MONGO_URI =
  process.env.DB_CNN ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.BD_CNN;

// ====== Migración ======

const ejecutar = async () => {
  if (!MONGO_URI) {
    throw new Error(
      "No se encontró la cadena de conexión MongoDB. Revisa DB_CNN, MONGODB_URI o MONGO_URI.",
    );
  }

  console.log("");
  console.log("========================================");
  console.log(" CONGELAR PLAZOS HISTÓRICOS LABORATORIO");
  console.log("========================================");
  console.log(
    aplicarCambios ? "MODO: APLICAR CAMBIOS" : "MODO: SOLO SIMULACIÓN",
  );
  console.log("");

  await mongoose.connect(MONGO_URI);

  const solicitudes = await SolicitudAtencion.find({
    tipo: "Laboratorio",
    "unidadesLaboratorio.plazoComprometido": { $ne: null },
  })
    .select("_id codSolicitud codigoLaboratorio")
    .sort({ fechaEmision: 1 })
    .lean();

  const resumen = {
    solicitudes: solicitudes.length,
    modificadas: 0,
    congelados: 0,
    invalidados: 0,
    sinCambios: 0,
    errores: 0,
  };

  for (const solicitud of solicitudes) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const resultado = await sincronizarCompromisosSolicitud({
        solicitudAtencionId: solicitud._id,
        session,
        uid: "MIGRACION_PLAZOS",
        nombreUsuario: "MIGRACION_PLAZOS",
        motivoInvalidacion: "MIGRACION_HISTORICA",
      });

      if (resultado.modificada) {
        resumen.modificadas += 1;
      }

      resumen.congelados += resultado.congelados;
      resumen.invalidados += resultado.invalidados;
      resumen.sinCambios += resultado.sinCambios;

      if (aplicarCambios) {
        await session.commitTransaction();
      } else {
        await session.abortTransaction();
      }

      if (resultado.modificada) {
        console.log(
          `${aplicarCambios ? "APLICADO" : "SIMULADO"} ${solicitud.codSolicitud} · congelados=${resultado.congelados} · invalidados=${resultado.invalidados}`,
        );
      }
    } catch (error) {
      resumen.errores += 1;

      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      console.error(
        `ERROR ${solicitud.codSolicitud ?? solicitud._id}:`,
        error.message,
      );
    } finally {
      await session.endSession();
    }
  }

  console.log("");
  console.log("Resumen:");
  console.table(resumen);

  if (!aplicarCambios) {
    console.log("");
    console.log("No se modificó la base de datos.");
    console.log("Ejecuta nuevamente con --apply para congelar los plazos.");
  }
};

ejecutar()
  .catch((error) => {
    console.error("Error en migración de plazos:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
