const mongoose = require("mongoose");
const SolicitudAtencion = require("../../models/Gestion/SolicitudAtencion");
const ProgramacionPacienteEmpresa = require("../../models/Gestion/programacionPacienteEmpresa");
const Servicio = require("../../models/Mantenimiento/Servicio");
const PruebaLab = require("../../models/Mantenimiento/PruebaLab");
// ====== Registrar maestros de muestra ======
require("../../models/Mantenimiento/TipoMuestra");
require("../../models/Mantenimiento/TuboEnvase");
// ====== Registrar laboratorio de referencia ======
require("../../models/Mantenimiento/LaboratorioReferencia");

const { response } = require("express");

// Generar el código de solicitud con formato SOL'año''mes'0001
async function generarCodigoSolicitud(session) {
  if (!session) {
    throw new Error(
      "Se requiere una sesión de MongoDB para generar el código de solicitud",
    );
  }

  const ahora = new Date();
  const anio = ahora.getFullYear().toString().slice(-2); // '24'
  const mes = (ahora.getMonth() + 1).toString().padStart(2, "0"); // '06'
  const prefijo = `SOL${anio}${mes}`; // ej. SOL2406

  // Buscar la última solicitud creada este mes
  const ultimaSolicitud = await SolicitudAtencion.findOne({
    codSolicitud: { $regex: `^${prefijo}` },
  })
    .sort({ codSolicitud: -1 })
    .session(session) // Usar la sesión si se está en una transacción
    .lean();

  //console.log("Última solicitud encontrada:", ultimaSolicitud);

  let consecutivo = 1;
  if (ultimaSolicitud && ultimaSolicitud.codSolicitud) {
    const ultimos4 = ultimaSolicitud.codSolicitud.slice(-4);
    consecutivo = parseInt(ultimos4, 10) + 1;
  }

  const codigo = `${prefijo}${consecutivo.toString().padStart(4, "0")}`;
  return codigo;
}

// ==========================================
// NORMALIZAR TIPO DE SOLICITUD
// ==========================================

const normalizarTipoSolicitud = (tipoServicio) => {
  if (!tipoServicio) {
    throw new Error("El servicio no tiene definido un tipo de servicio");
  }

  const tipoNormalizado = tipoServicio.trim().toUpperCase();

  const tipos = {
    LAB: "Laboratorio",
    LABORATORIO: "Laboratorio",

    CON: "Consulta",
    CONSULTA: "Consulta",

    ECO: "Ecografía",
    ECOGRAFIA: "Ecografía",
    ECOGRAFÍA: "Ecografía",

    RX: "Radiografía",
    RADIOGRAFIA: "Radiografía",
    RADIOGRAFÍA: "Radiografía",
    "RAYOS X": "Radiografía",

    PRO: "Procedimiento",
    PROCEDIMIENTO: "Procedimiento",

    OTRO: "Otro",
  };

  const tipoSolicitud = tipos[tipoNormalizado];

  if (!tipoSolicitud) {
    throw new Error(
      `Tipo de servicio no soportado para solicitud de atención: ${tipoServicio}`,
    );
  }

  return tipoSolicitud;
};

// ====== Expandir servicios de cotización para atención ======

const expandirServiciosCotizacionParaAtencion = async (
  serviciosCotizacion,
  session = null,
) => {
  if (!Array.isArray(serviciosCotizacion) || serviciosCotizacion.length === 0) {
    throw new Error(
      "No existen servicios para generar solicitudes de atención",
    );
  }

  const obtenerId = (valor) => {
    if (valor && typeof valor === "object" && valor._id) {
      return valor._id.toString();
    }

    return String(valor ?? "");
  };

  // ====== Validar líneas ======

  for (let i = 0; i < serviciosCotizacion.length; i++) {
    const linea = serviciosCotizacion[i];

    const servicioId = obtenerId(linea.servicioId);
    const cantidadCotizada = Number(linea.cantidad ?? 1);

    if (!mongoose.Types.ObjectId.isValid(servicioId)) {
      throw new Error(`El servicio de la línea ${i + 1} no es válido`);
    }

    if (!Number.isInteger(cantidadCotizada) || cantidadCotizada < 1) {
      throw new Error(`La cantidad de la línea ${i + 1} no es válida`);
    }
  }

  // ====== Obtener maestros principales ======

  const idsPrincipales = [
    ...new Set(serviciosCotizacion.map((linea) => obtenerId(linea.servicioId))),
  ];

  let consultaPrincipales = Servicio.find({
    _id: {
      $in: idsPrincipales,
    },
  });

  if (session) {
    consultaPrincipales = consultaPrincipales.session(session);
  }

  const serviciosPrincipales = await consultaPrincipales;

  const mapaPrincipales = new Map();

  serviciosPrincipales.forEach((servicio) => {
    mapaPrincipales.set(servicio._id.toString(), servicio);
  });

  if (mapaPrincipales.size !== idsPrincipales.length) {
    throw new Error("Uno o más servicios de la cotización ya no existen");
  }

  // ====== Resolver composición de paquetes ======

  const composicionesPorLinea = new Map();
  const idsIncluidos = new Set();

  for (let i = 0; i < serviciosCotizacion.length; i++) {
    const linea = serviciosCotizacion[i];

    const servicioId = obtenerId(linea.servicioId);
    const maestro = mapaPrincipales.get(servicioId);

    const claseServicio =
      linea.claseServicio ?? maestro?.claseServicio ?? "INDIVIDUAL";

    if (claseServicio !== "PAQUETE") {
      continue;
    }

    const snapshot = Array.isArray(linea.serviciosIncluidos)
      ? linea.serviciosIncluidos
      : [];

    let incluidos;
    let fuenteComposicion;

    // ====== Priorizar snapshot comercial ======

    if (snapshot.length > 0) {
      incluidos = snapshot;
      fuenteComposicion = "SNAPSHOT_COTIZACION";
    } else {
      incluidos = maestro?.serviciosIncluidos ?? [];
      fuenteComposicion = "MAESTRO_ACTUAL_FALLBACK";
    }

    if (incluidos.length === 0) {
      throw new Error(
        `No existe composición disponible para el paquete ${linea.codServicio}`,
      );
    }

    const incluidosNormalizados = incluidos.map((incluido) => {
      const servicioIncluidoId = obtenerId(incluido.servicioId);

      const cantidad = Number(incluido.cantidad ?? 1);

      if (!mongoose.Types.ObjectId.isValid(servicioIncluidoId)) {
        throw new Error(
          `El paquete ${linea.codServicio} contiene un servicio no válido`,
        );
      }

      if (!Number.isInteger(cantidad) || cantidad < 1) {
        throw new Error(
          `El paquete ${linea.codServicio} contiene una cantidad no válida`,
        );
      }

      idsIncluidos.add(servicioIncluidoId);

      return {
        servicioId: servicioIncluidoId,
        cantidad,
      };
    });

    composicionesPorLinea.set(i, {
      incluidos: incluidosNormalizados,
      fuenteComposicion,
    });
  }

  // ====== Obtener maestros incluidos ======

  let serviciosIncluidos = [];

  if (idsIncluidos.size > 0) {
    let consultaIncluidos = Servicio.find({
      _id: {
        $in: [...idsIncluidos],
      },
      claseServicio: "INDIVIDUAL",
    });

    if (session) {
      consultaIncluidos = consultaIncluidos.session(session);
    }

    serviciosIncluidos = await consultaIncluidos;
  }

  const mapaIncluidos = new Map();

  serviciosIncluidos.forEach((servicio) => {
    mapaIncluidos.set(servicio._id.toString(), servicio);
  });

  if (mapaIncluidos.size !== idsIncluidos.size) {
    throw new Error(
      "Uno o más servicios incluidos en los paquetes ya no existen",
    );
  }

  // ====== Construir servicios individuales ======

  const serviciosExpandidos = [];

  for (let i = 0; i < serviciosCotizacion.length; i++) {
    const linea = serviciosCotizacion[i];

    const servicioId = obtenerId(linea.servicioId);
    const maestro = mapaPrincipales.get(servicioId);

    const claseServicio =
      linea.claseServicio ?? maestro?.claseServicio ?? "INDIVIDUAL";

    const cantidadCotizada = Number(linea.cantidad ?? 1);

    // ====== Servicio individual ======

    if (claseServicio === "INDIVIDUAL") {
      const medicoAtiende = linea.medicoAtiende?.medicoId
        ? linea.medicoAtiende
        : null;

      serviciosExpandidos.push({
        lineaCotizacion: i + 1,

        servicioId: maestro._id,

        codServicio: linea.codServicio ?? maestro.codServicio,

        tipoServicio: linea.tipoServicio ?? maestro.tipoServicio,

        nombreServicio: linea.nombreServicio ?? maestro.nombreServicio,

        // ====== Cantidades transaccionales ======

        cantidadCotizada,

        cantidadEnPaquete: 1,

        cantidadServicio: cantidadCotizada,

        // ====== Composición clínica ======

        examenesServicio: maestro.examenesServicio ?? [],

        requiereSeleccionProfesional:
          typeof linea.requiereSeleccionProfesional === "boolean"
            ? linea.requiereSeleccionProfesional
            : maestro.requiereSeleccionProfesional,

        medicoAtiende,

        fuenteComposicion: "DIRECTO",

        origenServicio: {
          claseServicio: "INDIVIDUAL",

          servicioOrigenId: maestro._id,

          codServicioOrigen: linea.codServicio ?? maestro.codServicio,

          nombreServicioOrigen: linea.nombreServicio ?? maestro.nombreServicio,
        },
      });

      continue;
    }

    // ====== Paquete ======

    const composicion = composicionesPorLinea.get(i);

    if (!composicion) {
      throw new Error(
        `No se pudo resolver la composición del paquete ${linea.codServicio}`,
      );
    }

    for (const incluido of composicion.incluidos) {
      const servicioIncluido = mapaIncluidos.get(incluido.servicioId);

      if (!servicioIncluido) {
        throw new Error(
          `No se encontró un servicio incluido del paquete ${linea.codServicio}`,
        );
      }

      const cantidadServicio = cantidadCotizada * incluido.cantidad;

      serviciosExpandidos.push({
        lineaCotizacion: i + 1,

        servicioId: servicioIncluido._id,

        codServicio: servicioIncluido.codServicio,

        tipoServicio: servicioIncluido.tipoServicio,

        nombreServicio: servicioIncluido.nombreServicio,

        // ====== Cantidades transaccionales ======

        cantidadCotizada,

        cantidadEnPaquete: incluido.cantidad,

        cantidadServicio,

        // ====== Composición clínica ======

        examenesServicio: servicioIncluido.examenesServicio ?? [],

        requiereSeleccionProfesional:
          servicioIncluido.requiereSeleccionProfesional ?? false,

        // ====== No heredar profesional del paquete ======
        medicoAtiende: null,

        fuenteComposicion: composicion.fuenteComposicion,

        origenServicio: {
          claseServicio: "PAQUETE",

          servicioOrigenId: maestro._id,

          codServicioOrigen: linea.codServicio ?? maestro.codServicio,

          nombreServicioOrigen: linea.nombreServicio ?? maestro.nombreServicio,
        },
      });
    }
  }

  return serviciosExpandidos;
};

// ====== Generar unidades de laboratorio ======

const generarUnidadesLaboratorio = (serviciosExpandidos) => {
  const unidadesLaboratorio = [];

  serviciosExpandidos.forEach((servicio) => {
    const componentes = Array.isArray(servicio.examenesServicio)
      ? servicio.examenesServicio
      : [];

    componentes.forEach((componente) => {
      if (componente.tipoExamen !== "LABORATORIO" || !componente.referenciaId) {
        return;
      }

      const modalidad = componente.modalidadInstancias ?? "UNICA";

      const numeroInstancias =
        modalidad === "UNICA" ? 1 : Number(componente.numeroInstancias ?? 1);

      const etiquetas = Array.isArray(componente.etiquetasInstancias)
        ? componente.etiquetasInstancias
        : [];

      const cantidadServicio = Number(servicio.cantidadServicio ?? 1);

      for (
        let numeroServicio = 1;
        numeroServicio <= cantidadServicio;
        numeroServicio++
      ) {
        for (
          let numeroInstancia = 1;
          numeroInstancia <= numeroInstancias;
          numeroInstancia++
        ) {
          const etiquetaInstancia =
            modalidad === "UNICA"
              ? null
              : (etiquetas[numeroInstancia - 1] ?? null);

          const pruebaLabId = componente.referenciaId.toString();

          unidadesLaboratorio.push({
            claveUnidad:
              `${servicio.lineaCotizacion}:` +
              `${servicio.origenServicio.servicioOrigenId}:` +
              `${servicio.servicioId}:` +
              `${pruebaLabId}:` +
              `${numeroServicio}:` +
              `${numeroInstancia}`,

            lineaCotizacion: servicio.lineaCotizacion,

            servicioId: servicio.servicioId,

            codServicio: servicio.codServicio,

            nombreServicio: servicio.nombreServicio,

            cantidadCotizada: servicio.cantidadCotizada,

            cantidadEnPaquete: servicio.cantidadEnPaquete,

            cantidadServicio,

            numeroServicio,

            origenServicio: servicio.origenServicio,

            fuenteComposicion: servicio.fuenteComposicion,

            pruebaLabId,

            codExamen: componente.codExamen,

            nombreExamen: componente.nombreExamen,

            modalidadInstancias: modalidad,

            numeroInstancias,

            numeroInstancia,

            etiquetaInstancia,
          });
        }
      }
    });
  });

  return unidadesLaboratorio;
};

// ====== Snapshot laboratorio de referencia ======

const construirSnapshotLaboratorioReferencia = (laboratorioDocumento) => {
  if (!laboratorioDocumento?._id) {
    return null;
  }

  const laboratorio =
    typeof laboratorioDocumento.toObject === "function"
      ? laboratorioDocumento.toObject()
      : laboratorioDocumento;

  return {
    codLaboratorioReferencia: laboratorio.codLaboratorioReferencia ?? null,

    nombreLaboratorio: laboratorio.nombreLaboratorio ?? "",

    razonSocial: laboratorio.razonSocial ?? "",

    ruc: laboratorio.ruc ?? "",

    codigoCliente: laboratorio.codigoCliente ?? "",

    direccion: laboratorio.direccion ?? "",

    observacion: laboratorio.observacion ?? "",

    estadoLaboratorioReferencia:
      laboratorio.estadoLaboratorioReferencia ?? "ACTIVO",
  };
};

// ====== Normalizar procesamiento ======

const normalizarProcesamientoClinico = (procesamiento) => {
  if (!procesamiento) {
    return null;
  }

  const tipo = procesamiento.tipo ?? "INTERNO";

  const laboratorioReferencia = procesamiento.laboratorioReferenciaId;

  // ====== Procesamiento interno ======

  if (tipo === "INTERNO") {
    return {
      tipo: "INTERNO",

      laboratorioReferenciaId: null,

      laboratorioReferencia: null,

      observacion: procesamiento.observacion ?? "",
    };
  }

  // ====== Procesamiento por referencia ======

  if (tipo === "REFERENCIA") {
    if (!laboratorioReferencia?._id) {
      throw new Error(
        "Existe un procesamiento por REFERENCIA sin un laboratorio de referencia válido",
      );
    }

    return {
      tipo: "REFERENCIA",

      laboratorioReferenciaId: laboratorioReferencia._id,

      laboratorioReferencia: construirSnapshotLaboratorioReferencia(
        laboratorioReferencia,
      ),

      observacion: procesamiento.observacion ?? "",
    };
  }

  throw new Error(`Tipo de procesamiento no soportado: ${tipo}`);
};

// ====== Resolver procesamiento efectivo ======

const resolverProcesamientoEfectivo = (prueba, grupo, itemConfig) => {
  if (itemConfig?.procesamientoOverride) {
    return {
      ...normalizarProcesamientoClinico(itemConfig.procesamientoOverride),

      origenConfiguracion: "ITEM",
    };
  }

  if (grupo?.procesamientoOverride) {
    return {
      ...normalizarProcesamientoClinico(grupo.procesamientoOverride),

      origenConfiguracion: "GRUPO",
    };
  }

  return {
    ...normalizarProcesamientoClinico(
      prueba?.procesamientoDefault ?? {
        tipo: "INTERNO",
      },
    ),

    origenConfiguracion: "PRUEBA",
  };
};

// ====== Normalizar estado item legacy ======

const normalizarEstadoItemClinico = (estadoItem) => {
  if (estadoItem === true || estadoItem === "true") {
    return "ACTIVO";
  }

  if (estadoItem === false || estadoItem === "false") {
    return "INACTIVO";
  }

  return estadoItem ?? "ACTIVO";
};

// ====== Construir snapshot de ItemLab ======

const construirSnapshotItemLab = (itemMaestro) => {
  if (!itemMaestro?._id) {
    throw new Error("No se pudo resolver un ItemLab requerido por la prueba");
  }

  return {
    itemLabId: itemMaestro._id,

    codItemLab: itemMaestro.codItemLab ?? null,

    nombreInforme: itemMaestro.nombreInforme,

    nombreHojaTrabajo: itemMaestro.nombreHojaTrabajo,

    metodoItemLab: itemMaestro.metodoItemLab,

    valoresHojaTrabajo: itemMaestro.valoresHojaTrabajo ?? "",

    valoresInforme: itemMaestro.valoresInforme ?? "",

    unidadesRef: itemMaestro.unidadesRef ?? "",

    ordenImpresion: Number(itemMaestro.ordenImpresion ?? 0),

    poseeValidacion: itemMaestro.poseeValidacion ?? false,

    // ====== Compatibilidad legacy ======

    paramValidacion: Array.isArray(itemMaestro.paramValidacion)
      ? itemMaestro.paramValidacion.map((parametro) => ({
          descrValidacion: parametro.descrValidacion ?? "",

          sexo: parametro.sexo ?? "",

          edadIndistinta: parametro.edadIndistinta ?? null,

          edadMin: parametro.edadMin ?? null,

          edadMax: parametro.edadMax ?? null,

          descRegla: parametro.descRegla ?? "",

          valor1: parametro.valor1 ?? null,

          valor2: parametro.valor2 ?? null,
        }))
      : [],

    // ====== Configuración actual ======

    contextoAnalitico: itemMaestro.contextoAnalitico ?? "",

    tipoResultado: itemMaestro.tipoResultado ?? "TEXTO",

    opcionesResultado: Array.isArray(itemMaestro.opcionesResultado)
      ? [...itemMaestro.opcionesResultado]
      : [],

    permiteValorNoListado: itemMaestro.permiteValorNoListado ?? false,

    estadoItem: normalizarEstadoItemClinico(itemMaestro.estadoItem),

    referenciasResultado: Array.isArray(itemMaestro.referenciasResultado)
      ? itemMaestro.referenciasResultado.map((referencia) => ({
          descripcion: referencia.descripcion ?? "",

          sexo: referencia.sexo ?? "TODOS",

          edadMin: referencia.edadMin ?? null,

          edadMax: referencia.edadMax ?? null,

          unidadEdad: referencia.unidadEdad ?? "ANIOS",

          tipoReferencia: referencia.tipoReferencia,

          valorMin: referencia.valorMin ?? null,

          valorMax: referencia.valorMax ?? null,

          valorLimite: referencia.valorLimite ?? null,

          valoresPermitidos: Array.isArray(referencia.valoresPermitidos)
            ? [...referencia.valoresPermitidos]
            : [],

          textoReferencia: referencia.textoReferencia ?? "",

          activo: referencia.activo ?? true,
        }))
      : [],

    reglasAlerta: Array.isArray(itemMaestro.reglasAlerta)
      ? itemMaestro.reglasAlerta.map((regla) => ({
          descripcion: regla.descripcion ?? "",

          sexo: regla.sexo ?? "TODOS",

          edadMin: regla.edadMin ?? null,

          edadMax: regla.edadMax ?? null,

          unidadEdad: regla.unidadEdad ?? "ANIOS",

          condicion: regla.condicion,

          valor1: regla.valor1 ?? null,

          valor2: regla.valor2 ?? null,

          nivelAlerta: regla.nivelAlerta ?? "ADVERTENCIA",

          mensaje: regla.mensaje ?? "",

          activo: regla.activo ?? true,
        }))
      : [],
  };
};

// ====== Normalizar grupos legacy ======

const obtenerGruposResultadoClinicos = (prueba) => {
  const gruposActuales = Array.isArray(prueba.gruposResultado)
    ? prueba.gruposResultado
    : [];

  if (gruposActuales.length > 0) {
    return gruposActuales;
  }

  const itemsLegacy = Array.isArray(prueba.itemsComponentes)
    ? prueba.itemsComponentes
    : [];

  if (itemsLegacy.length === 0) {
    return [];
  }

  return [
    {
      nombreGrupo: "",
      ordenGrupo: 0,
      mostrarTitulo: false,
      procesamientoOverride: null,

      items: itemsLegacy.map((item, index) => ({
        itemLabId: item.itemLabId,

        ordenItem: index,

        mostrarItem: true,

        procesamientoOverride: null,
      })),
    },
  ];
};

// ====== Snapshot tipo de muestra ======

const construirSnapshotTipoMuestra = (tipoMuestraDocumento) => {
  if (!tipoMuestraDocumento?._id) {
    return null;
  }

  const tipoMuestra =
    typeof tipoMuestraDocumento.toObject === "function"
      ? tipoMuestraDocumento.toObject()
      : tipoMuestraDocumento;

  return {
    codTipoMuestra: tipoMuestra.codTipoMuestra ?? null,

    nombreTipoMuestra: tipoMuestra.nombreTipoMuestra ?? "",

    descripcionTipoMuestra: tipoMuestra.descripcionTipoMuestra ?? "",

    estadoTipoMuestra: tipoMuestra.estadoTipoMuestra ?? "ACTIVO",
  };
};

// ====== Snapshot tubo / envase ======

const construirSnapshotTuboEnvase = (tuboEnvaseDocumento) => {
  if (!tuboEnvaseDocumento?._id) {
    return null;
  }

  const tuboEnvase =
    typeof tuboEnvaseDocumento.toObject === "function"
      ? tuboEnvaseDocumento.toObject()
      : tuboEnvaseDocumento;

  return {
    codTuboEnvase: tuboEnvase.codTuboEnvase ?? null,

    nombreTuboEnvase: tuboEnvase.nombreTuboEnvase ?? "",

    descripcionTuboEnvase: tuboEnvase.descripcionTuboEnvase ?? "",

    color: tuboEnvase.color ?? "",

    aditivo: tuboEnvase.aditivo ?? "",

    capacidad: tuboEnvase.capacidad ?? null,

    unidadCapacidad: tuboEnvase.unidadCapacidad ?? null,

    estadoTuboEnvase: tuboEnvase.estadoTuboEnvase ?? "ACTIVO",
  };
};

// ====== Construir snapshot de PruebaLab ======

const construirSnapshotPruebaLab = (pruebaDocumento) => {
  const prueba =
    typeof pruebaDocumento?.toObject === "function"
      ? pruebaDocumento.toObject()
      : pruebaDocumento;

  const grupos = obtenerGruposResultadoClinicos(prueba);

  return {
    pruebaLabId: prueba._id,

    codPruebaLab: prueba.codPruebaLab,

    nombrePruebaLab: prueba.nombrePruebaLab,

    areaLab: prueba.areaLab,

    condPreAnalitPaciente: prueba.condPreAnalitPaciente ?? "",

    condPreAnalitRefer: prueba.condPreAnalitRefer ?? "",

    tiempoRespuesta: prueba.tiempoRespuesta ?? "",

    observPruebas: prueba.observPruebas ?? null,

    estadoPrueba:
      prueba.estadoPrueba === true || prueba.estadoPrueba === "true"
        ? "ACTIVO"
        : prueba.estadoPrueba === false || prueba.estadoPrueba === "false"
          ? "INACTIVO"
          : (prueba.estadoPrueba ?? "ACTIVO"),

    // ====== Procesamiento ======

    procesamientoDefault: normalizarProcesamientoClinico(
      prueba.procesamientoDefault ?? {
        tipo: "INTERNO",
      },
    ),

    // ====== Muestra ======

    requiereMuestra: prueba.requiereMuestra ?? true,

    requerimientosMuestra: Array.isArray(prueba.requerimientosMuestra)
      ? prueba.requerimientosMuestra.map((requerimiento) => ({
          descripcion: requerimiento.descripcion ?? "",

          alcance: requerimiento.alcance ?? "TODA_PRUEBA",

          opciones: Array.isArray(requerimiento.opciones)
            ? requerimiento.opciones.map((opcion) => {
                const tipoMuestra = opcion.tipoMuestraId;

                const tuboEnvase = opcion.tuboEnvaseId;

                // ====== Validar maestros poblados ======

                if (!tipoMuestra?._id) {
                  throw new Error(
                    `No se pudo resolver el TipoMuestra de la prueba ${prueba.codPruebaLab}`,
                  );
                }

                if (!tuboEnvase?._id) {
                  throw new Error(
                    `No se pudo resolver el TuboEnvase de la prueba ${prueba.codPruebaLab}`,
                  );
                }

                return {
                  tipoMuestraId: tipoMuestra._id,

                  tipoMuestra: construirSnapshotTipoMuestra(tipoMuestra),

                  tuboEnvaseId: tuboEnvase._id,

                  tuboEnvase: construirSnapshotTuboEnvase(tuboEnvase),
                };
              })
            : [],

          itemsAsociados: Array.isArray(requerimiento.itemsAsociados)
            ? requerimiento.itemsAsociados.map(
                (itemId) => itemId?._id ?? itemId,
              )
            : [],

          cantidadRecipientes: Number(requerimiento.cantidadRecipientes ?? 1),

          volumenMinimo: requerimiento.volumenMinimo ?? null,

          unidadVolumen: requerimiento.unidadVolumen ?? null,

          permiteCompartirMuestra:
            requerimiento.permiteCompartirMuestra ?? true,

          observacion: requerimiento.observacion ?? "",
        }))
      : [],

    // ====== Grupos e Items ======

    gruposResultado: grupos.map((grupo) => ({
      nombreGrupo: grupo.nombreGrupo ?? "",

      ordenGrupo: Number(grupo.ordenGrupo ?? 0),

      mostrarTitulo: grupo.mostrarTitulo ?? true,

      items: Array.isArray(grupo.items)
        ? grupo.items.map((itemConfig) => {
            const itemMaestro = itemConfig.itemLabId;

            if (!itemMaestro?._id) {
              throw new Error(
                `No se pudo poblar un ItemLab de la prueba ${prueba.codPruebaLab}`,
              );
            }

            return {
              itemLabId: itemMaestro._id,

              ordenItem: Number(itemConfig.ordenItem ?? 0),

              mostrarItem: itemConfig.mostrarItem ?? true,

              procesamientoEfectivo: resolverProcesamientoEfectivo(
                prueba,
                grupo,
                itemConfig,
              ),

              snapshotItem: construirSnapshotItemLab(itemMaestro),

              // ====== Resultado transaccional ======

              resultado: {
                valor: null,
                observacion: "",
                estado: "PENDIENTE",
              },
            };
          })
        : [],
    })),
  };
};

// ====== Materializar snapshot clínico ======

const materializarSnapshotClinicoLaboratorio = async (
  unidadesLaboratorio,
  session = null,
) => {
  if (!Array.isArray(unidadesLaboratorio) || unidadesLaboratorio.length === 0) {
    return [];
  }

  const idsPruebas = [
    ...new Set(
      unidadesLaboratorio.map((unidad) => unidad.pruebaLabId.toString()),
    ),
  ];

  // ====== Obtener pruebas y maestros relacionados ======

  let consulta = PruebaLab.find({
    _id: {
      $in: idsPruebas,
    },
  })
    // ====== Items ======
    .populate("gruposResultado.items.itemLabId")
    .populate("itemsComponentes.itemLabId")

    // ====== Muestras ======
    .populate("requerimientosMuestra.opciones.tipoMuestraId")
    .populate("requerimientosMuestra.opciones.tuboEnvaseId")

    // ====== Laboratorio referencia de la prueba ======
    .populate("procesamientoDefault.laboratorioReferenciaId")

    // ====== Laboratorio referencia del grupo ======
    .populate("gruposResultado.procesamientoOverride.laboratorioReferenciaId")

    // ====== Laboratorio referencia del Item ======
    .populate(
      "gruposResultado.items.procesamientoOverride.laboratorioReferenciaId",
    );

  if (session) {
    consulta = consulta.session(session);
  }

  const pruebas = await consulta;

  // ====== Indexar pruebas ======

  const mapaPruebas = new Map();

  pruebas.forEach((prueba) => {
    mapaPruebas.set(prueba._id.toString(), prueba);
  });

  if (mapaPruebas.size !== idsPruebas.length) {
    throw new Error("Una o más PruebaLab de las unidades no existen");
  }

  // ====== Materializar cada unidad ======

  return unidadesLaboratorio.map((unidad) => {
    const prueba = mapaPruebas.get(unidad.pruebaLabId.toString());

    if (!prueba) {
      throw new Error(`No se encontró la prueba ${unidad.pruebaLabId}`);
    }

    return {
      ...unidad,

      snapshotClinico: construirSnapshotPruebaLab(prueba),
    };
  });
};

// ====== Previsualizar expansión para atención ======

const previsualizarExpansionAtencion = async (req, res = response) => {
  try {
    const serviciosCotizacion = Array.isArray(req.body?.serviciosCotizacion)
      ? req.body.serviciosCotizacion
      : [];

    const serviciosExpandidos =
      await expandirServiciosCotizacionParaAtencion(serviciosCotizacion);

    const serviciosAgrupados = agruparServiciosPorTipo(serviciosExpandidos);

    // ====== Materializar laboratorio ======

    const serviciosLaboratorio = serviciosAgrupados.Laboratorio ?? [];

    const unidadesLaboratorio =
      generarUnidadesLaboratorio(serviciosLaboratorio);

    // ====== Snapshot clínico ======

    const unidadesLaboratorioClinicas =
      await materializarSnapshotClinicoLaboratorio(unidadesLaboratorio);

    return res.json({
      ok: true,

      serviciosExpandidos,

      serviciosAgrupados,

      unidadesLaboratorio,

      unidadesLaboratorioClinicas,

      resumenLaboratorio: {
        serviciosLaboratorio: serviciosLaboratorio.length,

        unidadesLaboratorio: unidadesLaboratorio.length,

        unidadesConSnapshot: unidadesLaboratorioClinicas.length,
      },
    });
  } catch (error) {
    console.error("Error al previsualizar expansión de atención:", error);

    return res.status(400).json({
      ok: false,
      msg: error.message || "No se pudo expandir la cotización",
    });
  }
};

// ==========================================
// AGRUPAR SERVICIOS POR TIPO
// ==========================================

const agruparServiciosPorTipo = (servicios) => {
  if (!Array.isArray(servicios) || servicios.length === 0) {
    throw new Error(
      "No existen servicios para generar solicitudes de atención",
    );
  }

  return servicios.reduce((agrupados, servicio) => {
    const tipo = normalizarTipoSolicitud(servicio.tipoServicio);

    if (!agrupados[tipo]) {
      agrupados[tipo] = [];
    }

    agrupados[tipo].push(servicio);

    return agrupados;
  }, {});
};

// ==========================================
// CREAR SOLICITUDES DE ATENCIÓN
// ==========================================

const crearSolicitudesAtencion = async ({
  origenAtencion,
  servicios,
  paciente,
  datosOrigen,
  session,
  uid,
  nombreUsuario,
}) => {
  // ==========================================
  // VALIDAR SESIÓN
  // ==========================================

  if (!session) {
    throw new Error(
      "Se requiere una sesión de MongoDB para crear solicitudes de atención",
    );
  }

  // ==========================================
  // VALIDAR ORIGEN
  // ==========================================

  if (!["PARTICULAR", "EMPRESA"].includes(origenAtencion)) {
    throw new Error("Origen de atención no válido");
  }

  // ==========================================
  // VALIDAR PACIENTE
  // ==========================================

  if (
    !paciente?.clienteId ||
    !paciente?.hc ||
    !paciente?.tipoDoc ||
    !paciente?.nroDoc ||
    !paciente?.nombreCliente ||
    !paciente?.apePatCliente
  ) {
    throw new Error(
      "Faltan datos obligatorios del paciente para generar las solicitudes",
    );
  }

  // ==========================================
  // VALIDAR DATOS DEL ORIGEN
  // ==========================================

  if (origenAtencion === "PARTICULAR") {
    if (
      !datosOrigen?.pagoId ||
      !datosOrigen?.codPago ||
      !datosOrigen?.cotizacionId ||
      !datosOrigen?.codCotizacion
    ) {
      throw new Error(
        "Faltan datos del pago o cotización para generar las solicitudes",
      );
    }
  }

  if (origenAtencion === "EMPRESA") {
    if (
      !datosOrigen?.programacionEmpresaId ||
      !datosOrigen?.codProgramacion ||
      !datosOrigen?.empresaId ||
      !datosOrigen?.razonSocialEmpresa ||
      !datosOrigen?.protocoloId ||
      !datosOrigen?.codProtocolo ||
      !datosOrigen?.nombreProtocolo
    ) {
      throw new Error(
        "Faltan datos de la programación empresarial para generar las solicitudes",
      );
    }
  }

  // ==========================================
  // AGRUPAR SERVICIOS
  // ==========================================

  // ====== Expandir servicios de cotización ======

  const serviciosExpandidos = await expandirServiciosCotizacionParaAtencion(
    servicios,
    session,
  );

  // ====== Agrupar servicios individuales ======

  const serviciosAgrupados = agruparServiciosPorTipo(serviciosExpandidos);

  // ====== Materializar unidades laboratorio ======

  const serviciosLaboratorio = serviciosAgrupados.Laboratorio ?? [];

  const unidadesLaboratorio = generarUnidadesLaboratorio(serviciosLaboratorio);

  const solicitudesCreadas = [];

  const ahora = new Date();

  // ==========================================
  // CREAR UNA SOLICITUD POR TIPO
  // ==========================================

  for (const [tipo, serviciosTipo] of Object.entries(serviciosAgrupados)) {
    const codSolicitud = await generarCodigoSolicitud(session);

    const datosSolicitud = {
      codSolicitud,
      origenAtencion,
      tipo,
      servicios: serviciosTipo.map((servicio) => ({
        servicioId: servicio.servicioId,

        codServicio: servicio.codServicio,

        nombreServicio: servicio.nombreServicio,

        // ====== Trazabilidad transaccional ======

        lineaCotizacion: servicio.lineaCotizacion,

        cantidadServicio: servicio.cantidadServicio,

        requiereSeleccionProfesional:
          servicio.requiereSeleccionProfesional ?? false,

        fuenteComposicion: servicio.fuenteComposicion ?? "DIRECTO",

        origenServicio: servicio.origenServicio ?? null,

        estado: "PENDIENTE",

        // ====== Profesional seleccionado ======

        ...(servicio.medicoAtiende?.medicoId && {
          medicoAtiende: servicio.medicoAtiende,
        }),
      })),

      // ======================================
      // PACIENTE
      // ======================================

      hc: paciente.hc,
      clienteId: paciente.clienteId,
      tipoDoc: paciente.tipoDoc,
      nroDoc: paciente.nroDoc,
      nombreCliente: paciente.nombreCliente,
      apePatCliente: paciente.apePatCliente,
      apeMatCliente: paciente.apeMatCliente || "",

      // ======================================
      // SOLICITUD
      // ======================================

      fechaEmision: ahora,
      estado: "GENERADO",

      // ======================================
      // AUDITORÍA
      // ======================================

      createdBy: uid,
      usuarioRegistro: nombreUsuario,
      fechaRegistro: ahora,
    };

    // ====== Unidades clínicas de laboratorio ======

    if (tipo === "Laboratorio") {
      datosSolicitud.unidadesLaboratorio = unidadesLaboratorio.map(
        (unidad) => ({
          ...unidad,
          estado: "PENDIENTE",
        }),
      );
    }

    // ==========================================
    // ORIGEN PARTICULAR
    // ==========================================

    if (origenAtencion === "PARTICULAR") {
      Object.assign(datosSolicitud, {
        pagoId: datosOrigen.pagoId,
        codPago: datosOrigen.codPago,
        cotizacionId: datosOrigen.cotizacionId,
        codCotizacion: datosOrigen.codCotizacion,
        fechaCotizacion: datosOrigen.fechaCotizacion,
        solicitanteId: datosOrigen.solicitanteId || null,
      });
    }

    // ==========================================
    // ORIGEN EMPRESA
    // ==========================================

    if (origenAtencion === "EMPRESA") {
      Object.assign(datosSolicitud, {
        programacionEmpresaId: datosOrigen.programacionEmpresaId,
        codProgramacion: datosOrigen.codProgramacion,
        empresaId: datosOrigen.empresaId,
        razonSocialEmpresa: datosOrigen.razonSocialEmpresa,
        protocoloId: datosOrigen.protocoloId,
        codProtocolo: datosOrigen.codProtocolo,
        nombreProtocolo: datosOrigen.nombreProtocolo,
      });
    }

    // ==========================================
    // GUARDAR SOLICITUD
    // ==========================================

    const nuevaSolicitud = new SolicitudAtencion(datosSolicitud);

    await nuevaSolicitud.save({
      session,
    });

    solicitudesCreadas.push(nuevaSolicitud);
  }

  return solicitudesCreadas;
};

// Actualizar el estado de una solicitud
exports.actualizarEstado = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const { uid, nombreUsuario } = req.user; // ← obtenemos al usuario del token

    const solicitud = await SolicitudAtencion.findByIdAndUpdate(
      id,
      {
        estado,
        updatedBy: uid, // uid del usuario que actualiza
        usuarioActualizacion: nombreUsuario, // Nombre de usuario que actualiza
        fechaActualizacion: new Date(), // Fecha de actualización
      },
      { new: true },
    );
    if (!solicitud) {
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }
    res.json(solicitud);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Traer solicitudes por rango de fechas
const obtenerPorRangoFechas = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, terminoBusqueda } = req.query;
    console.log("Fechas recibidas:", fechaInicio, fechaFin);
    console.log("Término de búsqueda:", terminoBusqueda);

    const filtro = {
      fechaEmision: {
        $gte: new Date(fechaInicio),
        $lte: new Date(fechaFin),
      },
    };

    if (terminoBusqueda.trim() !== "") {
      const regex = new RegExp(terminoBusqueda.trim(), "i"); // 'i' = case-insensitive
      filtro.$or = [
        { pacienteNombre: regex },
        { codCotizacion: regex },
        { nroDocumento: regex },
      ];
    }

    const solicitudes = await SolicitudAtencion.find(filtro)
      .populate(
        "solicitanteId",
        "nombreRefMedico apePatRefMedico apeMatRefMedico",
      )
      .populate("pagoId", "subTotalFacturar")
      .populate("programacionEmpresaId")
      .sort({ fechaEmision: -1 });

    console.log("Solicitudes encontradas:", solicitudes.length);

    res.json(solicitudes);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Buscar solicitudes dentro de un rango de fechas (puede incluir filtros adicionales)
exports.buscarSolicitudes = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, ...otrosFiltros } = req.query;
    const filtro = {
      ...otrosFiltros,
      fechaEmision: {
        $gte: new Date(fechaInicio),
        $lte: new Date(fechaFin),
      },
    };
    const solicitudes = await SolicitudAtencion.find(filtro);
    res.json(solicitudes);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ==========================================
// RECALCULAR ESTADO DE PROGRAMACIÓN EMPRESA
// SEGÚN ATENCIONES DE SUS ÁREAS
// ==========================================

const recalcularEstadoProgramacionEmpresa = async ({
  programacionEmpresaId,
  session,
  uid,
  nombreUsuario,
  ahora,
}) => {
  // ==========================================
  // VALIDAR PROGRAMACIÓN
  // ==========================================

  const programacion = await ProgramacionPacienteEmpresa.findById(
    programacionEmpresaId,
  ).session(session);

  if (!programacion) {
    const error = new Error("La programación empresarial asociada no existe");
    error.codigo = "PROGRAMACION_NO_ENCONTRADA";
    throw error;
  }

  // ==========================================
  // VALIDAR ESTADO ACTUAL
  // ==========================================

  if (
    !["EN ATENCION", "PENDIENTE DE COMPLETAR"].includes(
      programacion.estadoProgramacion,
    )
  ) {
    const error = new Error(
      `No se puede recalcular una programación en estado ${programacion.estadoProgramacion}`,
    );

    error.codigo = "ESTADO_PROGRAMACION_NO_PERMITIDO";

    throw error;
  }

  // ==========================================
  // OBTENER TODAS LAS SOLICITUDES
  // DE LA PROGRAMACIÓN
  // ==========================================

  const solicitudes = await SolicitudAtencion.find({
    origenAtencion: "EMPRESA",
    programacionEmpresaId: programacion._id,
  })
    .session(session)
    .lean();

  if (solicitudes.length === 0) {
    const error = new Error(
      "La programación no tiene solicitudes de atención asociadas",
    );

    error.codigo = "SOLICITUDES_NO_ENCONTRADAS";

    throw error;
  }

  // ==========================================
  // EVALUAR AVANCE DE ATENCIONES
  // ==========================================

  const totalSolicitudes = solicitudes.length;

  const solicitudesAtendidas = solicitudes.filter(
    (solicitud) => solicitud.estado === "ATENDIDO",
  ).length;

  const todasAtendidas = solicitudesAtendidas === totalSolicitudes;

  // ==========================================
  // ACTUALIZAR PROGRAMACIÓN
  // ==========================================

  programacion.estadoProgramacion = todasAtendidas
    ? "ATENDIDO"
    : "PENDIENTE DE COMPLETAR";

  programacion.fechaUltimaAtencion = ahora;

  if (todasAtendidas) {
    programacion.fechaFinalizacion = ahora;
  }

  // ==========================================
  // AUDITORÍA
  // ==========================================

  programacion.updatedBy = uid;

  programacion.usuarioActualizacion = nombreUsuario;

  programacion.fechaActualizacion = ahora;

  await programacion.save({
    session,
  });

  return {
    programacion,
    resumen: {
      totalSolicitudes,
      solicitudesAtendidas,
      solicitudesPendientes: totalSolicitudes - solicitudesAtendidas,
      todasAtendidas,
    },
  };
};

// ==========================================
// COMPLETAR ATENCIÓN DE UN ÁREA
// ==========================================

const completarAtencionArea = async (req, res = response) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { id } = req.params;
    const { uid, nombreUsuario } = req.user;

    // ========================================
    // 1. VALIDAR ID
    // ========================================

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();

      return res.status(400).json({
        ok: false,
        codigo: "ID_SOLICITUD_INVALIDO",
        msg: "El ID de la solicitud no es válido",
      });
    }

    // ========================================
    // 2. OBTENER SOLICITUD
    // ========================================

    const solicitud = await SolicitudAtencion.findById(id).session(session);

    if (!solicitud) {
      await session.abortTransaction();

      return res.status(404).json({
        ok: false,
        codigo: "SOLICITUD_NO_ENCONTRADA",
        msg: "Solicitud de atención no encontrada",
      });
    }

    // ========================================
    // 3. VALIDAR ESTADO ACTUAL
    // ========================================

    if (!["GENERADO", "EN PROCESO"].includes(solicitud.estado)) {
      await session.abortTransaction();

      return res.status(409).json({
        ok: false,
        codigo: "ATENCION_AREA_NO_PERMITIDA",
        msg: `No se puede completar la atención de una solicitud en estado ${solicitud.estado}`,
      });
    }

    // ========================================
    // 4. VALIDAR ORIGEN EMPRESA
    // ========================================

    if (
      solicitud.origenAtencion === "EMPRESA" &&
      !solicitud.programacionEmpresaId
    ) {
      await session.abortTransaction();

      return res.status(409).json({
        ok: false,
        codigo: "PROGRAMACION_EMPRESA_REQUERIDA",
        msg: "La solicitud empresarial no tiene una programación asociada",
      });
    }

    const ahora = new Date();

    // ========================================
    // 5. COMPLETAR ATENCIÓN DEL ÁREA
    // ========================================

    solicitud.estado = "ATENDIDO";
    solicitud.fechaAtencionArea = ahora;
    solicitud.atendidoPor = uid;
    solicitud.usuarioAtencion = nombreUsuario;

    // ========================================
    // 6. AUDITORÍA GENERAL
    // ========================================

    solicitud.updatedBy = uid;
    solicitud.usuarioActualizacion = nombreUsuario;
    solicitud.fechaActualizacion = ahora;

    await solicitud.save({
      session,
    });

    // ========================================
    // 7. RECALCULAR PROGRAMACIÓN
    // SOLO PARA EMPRESA
    // ========================================

    let programacionActualizada = null;
    let resumenProgramacion = null;

    if (solicitud.origenAtencion === "EMPRESA") {
      const resultado = await recalcularEstadoProgramacionEmpresa({
        programacionEmpresaId: solicitud.programacionEmpresaId,
        session,
        uid,
        nombreUsuario,
        ahora,
      });

      programacionActualizada = resultado.programacion;
      resumenProgramacion = resultado.resumen;
    }

    // ========================================
    // 8. CONFIRMAR TRANSACCIÓN
    // ========================================

    await session.commitTransaction();

    return res.status(200).json({
      ok: true,
      msg: "Atención del área completada correctamente",
      solicitud,
      programacion: programacionActualizada,
      resumenProgramacion,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error al completar atención del área:", error);

    // Errores de integridad / negocio
    if (error.codigo) {
      return res.status(409).json({
        ok: false,
        codigo: error.codigo,
        msg: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error al completar la atención del área",
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  crearSolicitudesAtencion,
  obtenerPorRangoFechas,
  generarCodigoSolicitud,
  completarAtencionArea,
  previsualizarExpansionAtencion,
};
