'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Sucursal = require('../models/Mantenimiento/Sucursal');
const RemisionSucursal = require('../models/Gestion/RemisionSucursal');

const MONGO_URI = process.env.DB_CNN || process.env.MONGODB_URI || process.env.MONGO_URI || process.env.BD_CNN;
const APLICAR = process.argv.includes('--apply');
const ROLLBACK = process.argv.find((arg) => arg.startsWith('--rollback='));
const COUNTER = 'sucursalesConsecutivosCollection';

// ====== Interpretar códigos anteriores y nuevos ======
const interpretar = (valor) => {
  const codigo = String(valor ?? '').trim().toUpperCase();
  const coincidencia = /^LF-?0*([1-9]\d*)$/.exec(codigo);
  if (!coincidencia) return null;
  const numero = Number(coincidencia[1]);
  if (!Number.isSafeInteger(numero) || numero < 1) return null;
  return { numero, normalizado: `LF${numero}` };
};

const id = (valor) => String(valor);
const oid = (valor) => new mongoose.Types.ObjectId(valor);

const validarSinDuplicados = (sucursales) => {
  const porCodigo = new Map();
  const items = [];
  for (const sede of sucursales) {
    const dato = interpretar(sede.codigo);
    if (!dato) throw new Error(`Código de sede no reconocido: ${sede.codigo}. No se alteró ningún registro.`);
    if (porCodigo.has(dato.normalizado)) {
      throw new Error(`Colisión de códigos: ${porCodigo.get(dato.normalizado)} y ${id(sede._id)} pasarían a ${dato.normalizado}`);
    }
    porCodigo.set(dato.normalizado, id(sede._id));
    items.push({ _id: id(sede._id), anterior: sede.codigo, nuevo: dato.normalizado, numero: dato.numero });
  }
  return items;
};

// ====== Preparar migración sin escribir ======
async function prepararPlan() {
  const docs = await Sucursal.find({}).select('_id codigo').lean();
  const sedes = validarSinDuplicados(docs);
  const porSede = new Map(sedes.map((s) => [s._id, s]));
  const cambiosSedes = sedes.filter((s) => s.anterior !== s.nuevo);

  // ====== Copias de código en recepciones administrativas ======
  const copias = await RemisionSucursal.find({ sucursalReceptoraCodigo: /^LF-/i })
    .select('_id sucursalReceptoraId sucursalReceptoraCodigo').lean();
  const cambiosRecepciones = [];
  for (const registro of copias) {
    const sucursal = porSede.get(id(registro.sucursalReceptoraId));
    const codigo = interpretar(registro.sucursalReceptoraCodigo);
    if (!sucursal || !codigo || codigo.numero !== sucursal.numero) {
      throw new Error(`Recepción ${id(registro._id)} contiene un código de sede no coincidente. Revise los datos antes de aplicar.`);
    }
    if (registro.sucursalReceptoraCodigo !== sucursal.nuevo) {
      cambiosRecepciones.push({ _id: id(registro._id), sucursalId: sucursal._id,
        anterior: registro.sucursalReceptoraCodigo, nuevo: sucursal.nuevo });
    }
  }

  const secuencia = await mongoose.connection.collection(COUNTER).findOne({ _id: 'sucursal' });
  if (secuencia && (!Number.isSafeInteger(secuencia.numero) || secuencia.numero < 0)) {
    throw new Error('El consecutivo de sucursales no es válido. Revise la colección de secuencias.');
  }
  const maximo = Math.max(0, ...sedes.map((s) => s.numero));
  return { sedes, cambiosSedes, cambiosRecepciones, maximo,
    secuenciaAnterior: secuencia?.numero ?? null,
    consecutivoFinal: Math.max(maximo, secuencia?.numero ?? 0) };
}

const reportar = (plan) => {
  console.log('Sedes consultadas:', plan.sedes.length);
  for (const s of plan.cambiosSedes) console.log(`  ${s.anterior} -> ${s.nuevo}`);
  console.log('Códigos maestros por actualizar:', plan.cambiosSedes.length);
  console.log('Copias en recepciones por actualizar:', plan.cambiosRecepciones.length);
  console.log('Consecutivo anterior:', plan.secuenciaAnterior ?? '(sin documento)');
  console.log('Consecutivo final mínimo:', plan.consecutivoFinal);
};

// ====== Guardar respaldo local antes de aplicar ======
async function respaldar(plan) {
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const archivo = path.resolve(process.cwd(), `respaldo-codigos-sucursales-${sello}.json`);
  const datos = { tipo: 'LABFRAY_CODIGOS_SUCURSALES_V1', fecha: new Date().toISOString(),
    cambiosSedes: plan.cambiosSedes, cambiosRecepciones: plan.cambiosRecepciones,
    secuenciaAnterior: plan.secuenciaAnterior, consecutivoFinal: plan.consecutivoFinal };
  await fs.writeFile(archivo, JSON.stringify(datos, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Respaldo generado:', archivo);
  return archivo;
}

// ====== Aplicar solo los cambios previamente comprobados ======
async function aplicar(plan) {
  await respaldar(plan);
  for (const sede of plan.cambiosSedes) {
    const r = await Sucursal.collection.updateOne(
      { _id: oid(sede._id), codigo: sede.anterior }, { $set: { codigo: sede.nuevo } });
    if (r.modifiedCount !== 1) throw new Error(`La sede ${sede._id} cambió durante la migración. Operación detenida.`);
  }
  for (const copia of plan.cambiosRecepciones) {
    const r = await RemisionSucursal.collection.updateOne(
      { _id: oid(copia._id), sucursalReceptoraId: oid(copia.sucursalId), sucursalReceptoraCodigo: copia.anterior },
      { $set: { sucursalReceptoraCodigo: copia.nuevo } });
    if (r.modifiedCount !== 1) throw new Error(`La recepción ${copia._id} cambió durante la migración. Operación detenida.`);
  }
  if (plan.maximo > 0) {
    await mongoose.connection.collection(COUNTER).updateOne(
      { _id: 'sucursal' }, { $max: { numero: plan.maximo } }, { upsert: true });
  }
  console.log('Migración aplicada. Verifique el listado de Sucursales y una recepción anterior.');
}

// ====== Restaurar solo valores registrados en el respaldo ======
async function restaurar(ruta) {
  const datos = JSON.parse(await fs.readFile(path.resolve(ruta), 'utf8'));
  if (datos?.tipo !== 'LABFRAY_CODIGOS_SUCURSALES_V1' ||
      !Array.isArray(datos.cambiosSedes) || !Array.isArray(datos.cambiosRecepciones)) {
    throw new Error('El archivo de respaldo no corresponde a esta migración.');
  }
  for (const sede of datos.cambiosSedes) {
    if (!mongoose.isValidObjectId(sede._id) || !interpretar(sede.anterior) || !interpretar(sede.nuevo)) {
      throw new Error('El respaldo contiene identificadores o códigos inválidos.');
    }
    const actual = await Sucursal.collection.findOne({ _id: oid(sede._id) }, { projection: { codigo: 1 } });
    if (!actual || (actual.codigo !== sede.anterior && actual.codigo !== sede.nuevo)) {
      throw new Error(`La sede ${sede._id} fue modificada tras migrar. No es seguro restaurar automáticamente.`);
    }
    const ocupada = await Sucursal.collection.findOne({ codigo: sede.anterior, _id: { $ne: oid(sede._id) } });
    if (ocupada) throw new Error(`El código anterior ${sede.anterior} está ocupado. Operación detenida.`);
  }
  for (const copia of datos.cambiosRecepciones) {
    if (!mongoose.isValidObjectId(copia._id) || !mongoose.isValidObjectId(copia.sucursalId)) {
      throw new Error('El respaldo de recepciones contiene identificadores inválidos.');
    }
    const actual = await RemisionSucursal.collection.findOne({ _id: oid(copia._id) },
      { projection: { sucursalReceptoraCodigo: 1, sucursalReceptoraId: 1 } });
    if (!actual || id(actual.sucursalReceptoraId) !== copia.sucursalId ||
        (actual.sucursalReceptoraCodigo !== copia.anterior && actual.sucursalReceptoraCodigo !== copia.nuevo)) {
      throw new Error(`La recepción ${copia._id} fue modificada tras migrar. No es seguro restaurar automáticamente.`);
    }
  }
  for (const copia of datos.cambiosRecepciones) {
    await RemisionSucursal.collection.updateOne(
      { _id: oid(copia._id), sucursalReceptoraCodigo: copia.nuevo },
      { $set: { sucursalReceptoraCodigo: copia.anterior } });
  }
  for (const sede of datos.cambiosSedes) {
    await Sucursal.collection.updateOne({ _id: oid(sede._id), codigo: sede.nuevo },
      { $set: { codigo: sede.anterior } });
  }
  // ====== No reducir el consecutivo: evita reutilizar códigos de sedes nuevas ======
  console.log('Códigos restaurados. El consecutivo se conserva por seguridad.');
}

async function main() {
  if (APLICAR && ROLLBACK) throw new Error('Use --apply o --rollback=<archivo>, no ambos.');
  if (!MONGO_URI) throw new Error('Falta DB_CNN, MONGODB_URI, MONGO_URI o BD_CNN en .env.');
  await mongoose.connect(MONGO_URI);
  try {
    if (ROLLBACK) return await restaurar(ROLLBACK.slice('--rollback='.length));
    const plan = await prepararPlan();
    reportar(plan);
    if (!APLICAR) {
      console.log('SIMULACIÓN: no se modificó MongoDB. Use --apply después de revisar.');
      return;
    }
    if (!plan.cambiosSedes.length && !plan.cambiosRecepciones.length && plan.maximo <= (plan.secuenciaAnterior ?? 0)) {
      console.log('Los códigos ya están migrados; no hay cambios pendientes.');
      return;
    }
    await aplicar(plan);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error('ERROR:', error.message); process.exitCode = 1; });
