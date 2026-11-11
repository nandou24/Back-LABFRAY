// ====== Historial administrativo de remisiones ======
// Los cambios se guardan en el mismo documento y operación que modifica la remisión.
const normalizar = valor => {
  if (valor === undefined || valor === null || valor === '') return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object' && typeof valor.toString === 'function' && valor._bsontype === 'ObjectId') return String(valor);
  return valor;
};
const serializar = valor => JSON.stringify(normalizar(valor));
const agregarCambio = (cambios, campo, anterior, nuevo) => {
  const a = normalizar(anterior);
  const b = normalizar(nuevo);
  if (serializar(a) !== serializar(b)) cambios.push({ campo, anterior: a, nuevo: b });
};
const snapshotPaciente = paciente => paciente ? ({
  nombre: paciente.nombre || [paciente.apePat, paciente.apeMat, paciente.nombres].filter(Boolean).join(' '),
  documento: paciente.documento || [paciente.tipoDoc, paciente.nroDoc].filter(Boolean).join(' '),
  hc: paciente.hc || '', sexo: paciente.sexo || '',
  fechaNacimiento: normalizar(paciente.fechaNacimiento),
  edadDeclarada: paciente.edadDeclarada ?? null, unidadEdad: paciente.unidadEdad || '',
  telefono: paciente.telefono || '',
  pruebas: (paciente.pruebas || []).map(p => ({ codigo: p.codPruebaLab, nombre: p.nombrePruebaLab })),
}) : null;
const snapshotRecipiente = recipiente => recipiente ? ({
  pacienteClave: recipiente.clavePaciente,
  recipiente: recipiente.tuboEnvaseNombre,
  tuboEnvaseId: String(recipiente.tuboEnvaseId || ''),
  tipoMuestraDeclarado: recipiente.tipoMuestraNombre || '',
  cantidadDeclarada: recipiente.cantidadDeclarada,
  cantidadRecibida: recipiente.cantidadRecibida ?? null,
  codigoEtiqueta: recipiente.codigoEtiqueta || '',
  fechaToma: normalizar(recipiente.fechaToma),
}) : null;
const compararColeccion = (cambios, titulo, anteriores, nuevos, obtenerClave, snapshot) => {
  const previo = new Map((anteriores || []).map((item, i) => [obtenerClave(item, i), item]));
  const actual = new Map((nuevos || []).map((item, i) => [obtenerClave(item, i), item]));
  for (const [clave, item] of previo) {
    agregarCambio(cambios, `${titulo} ${clave}`, snapshot(item), snapshot(actual.get(clave)));
  }
  for (const [clave, item] of actual) {
    if (!previo.has(clave)) agregarCambio(cambios, `${titulo} ${clave}`, null, snapshot(item));
  }
};
// ====== Auditar por separado lectura térmica y cantidades ======
const compararRecepcion = (cambios, anterior, nuevo) => {
  const a = anterior || {}, b = nuevo || {};
  const campos = [
    ['Temperatura (°C)', 'temperaturaC'],
    ['Fecha y hora de recepción', 'fechaHora'],
    ['Motivo de no medición', 'motivoSinLectura'],
    ['Responsable de recepción', 'nombreResponsableRecepcion'],
    ['Total de recipientes declarados', 'totalDeclarado'],
    ['Total de recipientes recibidos', 'totalRecibido'],
    ['Incidencia de recepción', 'incidencia'],
  ];
  for (const [etiqueta, clave] of campos) agregarCambio(cambios, etiqueta, a[clave], b[clave]);
};
const cambiosCreacion = datos => {
  const cambios = [];
  for (const campo of ['origenNombre', 'origenCodigo', 'rutaIngreso', 'prioridad', 'sedeOrigen', 'observacionRemision']) {
    agregarCambio(cambios, campo, null, datos[campo]);
  }
  const remision = (datos.remisiones || [])[0] || {};
  for (const campo of ['origenTipo', 'sucursalRemitenteNombre', 'referenciaRemision']) {
    agregarCambio(cambios, `Remisión: ${campo}`, null, remision[campo]);
  }
  compararColeccion(cambios, 'Paciente', [], remision.pacientesAdministrativos, p => String(p.clave), snapshotPaciente);
  compararColeccion(cambios, 'Recipiente', [], remision.recipientesAdministrativos,
    (r, i) => String(r._id || `nuevo-${i + 1}`), snapshotRecipiente);
  if (datos.recepcionCentral) compararRecepcion(cambios, null, datos.recepcionCentral);
  return cambios;
};
const cambiosEdicion = (anterior, nuevo) => {
  const cambios = [];
  for (const campo of ['origenNombre', 'origenCodigo', 'rutaIngreso', 'prioridad', 'sedeOrigen', 'observacionRemision']) {
    agregarCambio(cambios, campo, anterior[campo], nuevo[campo]);
  }
  const vieja = (anterior.remisiones || [])[0] || {};
  const actual = (nuevo.remisiones || [])[0] || {};
  for (const campo of ['origenTipo', 'asociadoId', 'sucursalId', 'sucursalRemitenteNombre', 'referenciaRemision']) {
    agregarCambio(cambios, `Remisión: ${campo}`, vieja[campo], actual[campo]);
  }
  compararColeccion(cambios, 'Paciente', vieja.pacientesAdministrativos, actual.pacientesAdministrativos,
    p => String(p.clave), snapshotPaciente);
  compararColeccion(cambios, 'Recipiente', vieja.recipientesAdministrativos, actual.recipientesAdministrativos,
    (r, i) => String(r._id || `nuevo-${i + 1}`), snapshotRecipiente);
  compararRecepcion(cambios, anterior.recepcionCentral, nuevo.recepcionCentral);
  return cambios;
};
const crearEvento = ({ accion, usuario, nombreCompleto = '', motivo = '', versionAnterior = null, cambios = [] }) => ({
  accion, fechaHora: new Date(), usuarioId: String(usuario?.uid || ''),
  nombreUsuario: String(usuario?.nombreUsuario || usuario?.uid || ''),
  nombreCompleto: String(nombreCompleto || usuario?.nombreCompleto || usuario?.nombreUsuario || usuario?.uid || ''),
  motivo: String(motivo || '').trim().slice(0, 500),
  versionAnterior, versionNueva: versionAnterior === null ? 0 : versionAnterior + 1,
  cambios: cambios.length ? cambios : [{ campo: 'Sin cambios de contenido', anterior: null, nuevo: null }],
});
module.exports = { agregarCambio, cambiosCreacion, cambiosEdicion, crearEvento };
