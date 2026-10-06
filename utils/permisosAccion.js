const PERMISOS_ACCION = Object.freeze({
  RESULTADOS_REGISTRAR: "RESULTADOS_REGISTRAR",
  RESULTADOS_VALIDAR: "RESULTADOS_VALIDAR",
  RESULTADOS_LIBERAR: "RESULTADOS_LIBERAR",
  RESULTADOS_ANULAR: "RESULTADOS_ANULAR",
});

const PERMISOS_ACCION_VALIDOS = new Set(Object.values(PERMISOS_ACCION));

const normalizarPermisosAcciones = (permisos = []) => {
  if (!Array.isArray(permisos)) {
    return [];
  }

  return [
    ...new Set(
      permisos
        .map((permiso) => String(permiso ?? "").trim().toUpperCase())
        .filter((permiso) => PERMISOS_ACCION_VALIDOS.has(permiso)),
    ),
  ];
};

module.exports = {
  PERMISOS_ACCION,
  PERMISOS_ACCION_VALIDOS,
  normalizarPermisosAcciones,
};
