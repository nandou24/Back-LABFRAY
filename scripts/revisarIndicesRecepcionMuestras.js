// ====== Diagnóstico seguro de índices de recepción administrativa ======
// Por defecto SOLO CONSULTA; --aplicar elimina exclusivamente índices únicos obsoletos conocidos.
const mongoose = require("mongoose");

const CAMPO = "remisiones.lineas.muestraLaboratorioId";
const NOMBRES_OBSOLETOS = new Set([
  "una_remision_por_muestra_fisica",
  "una_remision_por_muestra_fisica_v2",
  "remisiones.lineas.muestraLaboratorioId_1",
]);

const esIndiceObsoleto = (indice) =>
  NOMBRES_OBSOLETOS.has(indice.name) &&
  indice.unique === true &&
  Object.keys(indice.key || {}).length === 1 &&
  indice.key[CAMPO] === 1;

async function revisar() {
  const uri = process.env.BD_CNN;
  if (!uri)
    throw new Error(
      "Defina MONGO_URI en el entorno. No use una base diferente a la prevista.",
    );
  const aplicar = process.argv.includes("--aplicar");
  const confirmar = process.argv.includes("--confirmar=recepcionmuestras");
  if (aplicar && !confirmar) {
    throw new Error(
      "Para ejecutar cambios debe añadir --confirmar=recepcionmuestras",
    );
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const coleccion = mongoose.connection.db.collection("recepcionmuestras");
  const indices = await coleccion.indexes();
  console.log("Base:", mongoose.connection.db.databaseName);
  console.log("Colección:", coleccion.collectionName);
  console.log("Índices existentes:");
  for (const indice of indices) {
    console.log(
      JSON.stringify({
        nombre: indice.name,
        campos: indice.key,
        unico: indice.unique === true,
        parcial: indice.partialFilterExpression || null,
      }),
    );
  }
  const obsoletos = indices.filter(esIndiceObsoleto);
  if (!obsoletos.length) {
    console.log(
      "No se detectaron índices únicos obsoletos conocidos. No hay cambios.",
    );
    return;
  }
  console.log(
    "Índices obsoletos detectados:",
    obsoletos.map((x) => x.name).join(", "),
  );
  if (!aplicar) {
    console.log("SOLO DIAGNÓSTICO: no se eliminó ningún índice.");
    console.log(
      "Verifique el respaldo y la base antes de ejecutar con --aplicar --confirmar=recepcionmuestras.",
    );
    return;
  }
  for (const indice of obsoletos) {
    await coleccion.dropIndex(indice.name);
    console.log("Índice único obsoleto retirado:", indice.name);
  }
  const restantes = await coleccion.indexes();
  if (restantes.some(esIndiceObsoleto))
    throw new Error("Quedan índices únicos obsoletos. Revise manualmente.");
  console.log(
    "Verificado: se conservaron otros índices, incluido el código único de remisión.",
  );
}

if (require.main === module) {
  revisar()
    .catch((e) => {
      console.error("No se completó la revisión:", e.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
module.exports = { esIndiceObsoleto };
