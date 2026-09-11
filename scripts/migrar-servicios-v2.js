const path = require("path");
const mongoose = require("mongoose");

// ====== Cargar variables de entorno ======

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const Servicio = require("../models/Mantenimiento/Servicio");
const PruebaLab = require("../models/Mantenimiento/PruebaLab");

// ====== Configuración ======

const aplicarCambios = process.argv.includes("--apply");

const MONGO_URI =
  process.env.DB_CNN ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.BD_CNN;

// ====== Utilitarios ======

const normalizarCodigo = (valor) => {
  return String(valor ?? "")
    .trim()
    .toUpperCase();
};

const existeValor = (valor) => {
  return valor !== undefined && valor !== null;
};

const objectIdValido = (valor) => {
  return valor && mongoose.Types.ObjectId.isValid(valor);
};

// ====== Convertir estado legacy ======

const convertirEstadoBooleano = (valor) => {
  if (typeof valor === "boolean") {
    return {
      valido: true,
      valor,
    };
  }

  if (typeof valor === "number") {
    if (valor === 1) {
      return {
        valido: true,
        valor: true,
      };
    }

    if (valor === 0) {
      return {
        valido: true,
        valor: false,
      };
    }
  }

  if (typeof valor === "string") {
    const texto = valor.trim().toUpperCase();

    if (["TRUE", "1", "ACTIVO", "SI", "SÍ"].includes(texto)) {
      return {
        valido: true,
        valor: true,
      };
    }

    if (["FALSE", "0", "INACTIVO", "NO"].includes(texto)) {
      return {
        valido: true,
        valor: false,
      };
    }
  }

  return {
    valido: false,
    valor: null,
  };
};

// ====== Migración ======

const ejecutarMigracion = async () => {
  if (!MONGO_URI) {
    throw new Error(
      "No se encontró la cadena de conexión MongoDB. " +
        "Revisa DB_CNN, MONGODB_URI o MONGO_URI.",
    );
  }

  console.log("");
  console.log("========================================");
  console.log(" MIGRACIÓN SERVICIOS V2");
  console.log("========================================");

  console.log(
    aplicarCambios ? "MODO: APLICAR CAMBIOS" : "MODO: SOLO SIMULACIÓN",
  );

  console.log("");

  await mongoose.connect(MONGO_URI);

  console.log("MongoDB conectado");
  console.log("");

  // ====== Cargar maestros ======

  const pruebasLab = await PruebaLab.collection
    .find(
      {},
      {
        projection: {
          _id: 1,
          codPruebaLab: 1,
          nombrePruebaLab: 1,
        },
      },
    )
    .toArray();

  const pruebaPorId = new Map();

  const pruebaPorCodigo = new Map();

  pruebasLab.forEach((prueba) => {
    pruebaPorId.set(prueba._id.toString(), prueba);

    const codigo = normalizarCodigo(prueba.codPruebaLab);

    if (codigo) {
      pruebaPorCodigo.set(codigo, prueba);
    }
  });

  console.log(`Pruebas de laboratorio cargadas: ${pruebasLab.length}`);

  // ====== Cargar servicios RAW ======

  // Usamos collection para poder detectar
  // los tipos físicos realmente almacenados.
  const servicios = await Servicio.collection.find({}).toArray();

  console.log(`Servicios encontrados: ${servicios.length}`);

  console.log("");

  // ====== Resumen ======

  const resumen = {
    revisados: 0,
    modificados: 0,
    sinCambios: 0,

    componentesMigrados: 0,

    resueltosPorReferencia: 0,
    resueltosPorLegacy: 0,
    resueltosPorCodigo: 0,

    pendientes: [],
    conflictos: [],
  };

  // ====== Recorrer servicios ======

  for (const servicio of servicios) {
    resumen.revisados++;

    const cambios = {};

    // ====== Clase servicio ======

    if (!servicio.claseServicio) {
      cambios.claseServicio = "INDIVIDUAL";
    }

    // ====== Configuración profesional ======

    if (!existeValor(servicio.requiereSeleccionProfesional)) {
      cambios.requiereSeleccionProfesional = false;
    }

    // ====== Servicios incluidos ======

    if (!Array.isArray(servicio.serviciosIncluidos)) {
      cambios.serviciosIncluidos = [];
    }

    // ====== Precio legacy ======

    if (typeof servicio.precioServicio === "string") {
      const precio = Number(servicio.precioServicio);

      if (Number.isFinite(precio) && precio >= 0) {
        cambios.precioServicio = precio;
      } else {
        resumen.conflictos.push({
          servicio: servicio.codServicio,

          tipo: "PRECIO_INVALIDO",

          valor: servicio.precioServicio,
        });
      }
    }

    // ====== Estado legacy ======

    if (typeof servicio.estadoServicio !== "boolean") {
      const estado = convertirEstadoBooleano(servicio.estadoServicio);

      if (estado.valido) {
        cambios.estadoServicio = estado.valor;
      } else {
        resumen.conflictos.push({
          servicio: servicio.codServicio,

          tipo: "ESTADO_INVALIDO",

          valor: servicio.estadoServicio,
        });
      }
    }

    // ====== Componentes clínicos ======

    const examenesOriginales = Array.isArray(servicio.examenesServicio)
      ? servicio.examenesServicio
      : [];

    let examenesModificados = false;

    const examenesNuevos = examenesOriginales.map((componente) => {
      const nuevo = {
        ...componente,
      };

      // ====== Solo inferir Laboratorio ======

      const esServicioLaboratorio = servicio.tipoServicio === "Laboratorio";

      if (!esServicioLaboratorio) {
        if (examenesOriginales.length > 0) {
          resumen.pendientes.push({
            servicio: servicio.codServicio,

            componente: componente.codExamen,

            motivo: "Servicio no Laboratorio con componente clínico existente",
          });
        }

        return nuevo;
      }

      // ====== Tipo examen ======

      if (!nuevo.tipoExamen) {
        nuevo.tipoExamen = "LABORATORIO";

        examenesModificados = true;
      } else if (nuevo.tipoExamen !== "LABORATORIO") {
        resumen.conflictos.push({
          servicio: servicio.codServicio,

          componente: componente.codExamen,

          tipo: "TIPO_COMPONENTE_INCONSISTENTE",

          valor: nuevo.tipoExamen,
        });

        return nuevo;
      }

      // ====== Defaults instancias ======

      if (!existeValor(nuevo.numeroInstancias)) {
        nuevo.numeroInstancias = 1;

        examenesModificados = true;
      }

      if (!nuevo.modalidadInstancias) {
        nuevo.modalidadInstancias = "UNICA";

        examenesModificados = true;
      }

      if (!Array.isArray(nuevo.etiquetasInstancias)) {
        nuevo.etiquetasInstancias = [];

        examenesModificados = true;
      }

      // ====== Buscar referencia ======

      let prueba = null;

      let origenReferencia = null;

      // 1. Nueva referencia
      if (objectIdValido(nuevo.referenciaId)) {
        prueba = pruebaPorId.get(nuevo.referenciaId.toString());

        if (prueba) {
          origenReferencia = "REFERENCIA";
        }
      }

      // 2. Legacy
      if (!prueba && objectIdValido(nuevo.pruebaLabId)) {
        prueba = pruebaPorId.get(nuevo.pruebaLabId.toString());

        if (prueba) {
          origenReferencia = "LEGACY";
        }
      }

      // 3. Código
      if (!prueba) {
        const codigo = normalizarCodigo(nuevo.codExamen);

        prueba = pruebaPorCodigo.get(codigo) ?? null;

        if (prueba) {
          origenReferencia = "CODIGO";
        }
      }

      // ====== No resuelto ======

      if (!prueba) {
        resumen.pendientes.push({
          servicio: servicio.codServicio,

          nombreServicio: servicio.nombreServicio,

          componente: nuevo.codExamen,

          nombreComponente: nuevo.nombreExamen,

          motivo: "No se encontró PruebaLab relacionada",
        });

        return nuevo;
      }

      // ====== Validar código ======

      const codigoServicio = normalizarCodigo(nuevo.codExamen);

      const codigoPrueba = normalizarCodigo(prueba.codPruebaLab);

      if (
        codigoServicio &&
        codigoPrueba &&
        codigoServicio !== codigoPrueba &&
        origenReferencia !== "CODIGO"
      ) {
        resumen.conflictos.push({
          servicio: servicio.codServicio,

          componente: nuevo.codExamen,

          tipo: "REFERENCIA_CODIGO_DIFERENTE",

          referencia: prueba._id.toString(),

          codPruebaLab: prueba.codPruebaLab,
        });
      }

      // ====== Asignar nueva referencia ======

      const referencia = prueba._id;

      if (
        !nuevo.referenciaId ||
        nuevo.referenciaId.toString() !== referencia.toString()
      ) {
        nuevo.referenciaId = referencia;

        examenesModificados = true;
      }

      // Mantener legacy en Fase 1.
      if (
        !nuevo.pruebaLabId ||
        nuevo.pruebaLabId.toString() !== referencia.toString()
      ) {
        nuevo.pruebaLabId = referencia;

        examenesModificados = true;
      }

      // ====== Estadística ======

      switch (origenReferencia) {
        case "REFERENCIA":
          resumen.resueltosPorReferencia++;
          break;

        case "LEGACY":
          resumen.resueltosPorLegacy++;
          break;

        case "CODIGO":
          resumen.resueltosPorCodigo++;
          break;
      }

      resumen.componentesMigrados++;

      return nuevo;
    });

    if (examenesModificados) {
      cambios.examenesServicio = examenesNuevos;
    }

    // ====== Guardar ======

    if (Object.keys(cambios).length === 0) {
      resumen.sinCambios++;
      continue;
    }

    resumen.modificados++;

    console.log(
      `${aplicarCambios ? "[UPDATE]" : "[DRY]"} ` +
        `${servicio.codServicio} - ${servicio.nombreServicio}`,
    );

    console.log("  Campos:", Object.keys(cambios).join(", "));

    if (aplicarCambios) {
      // Usamos la colección directamente para que
      // una migración técnica no altere updatedAt
      // ni usuarioActualizacion.
      await Servicio.collection.updateOne(
        {
          _id: servicio._id,
        },
        {
          $set: cambios,
        },
      );
    }
  }

  // ====== Resultado ======

  console.log("");
  console.log("========================================");
  console.log(" RESULTADO");
  console.log("========================================");

  console.log(`Servicios revisados: ${resumen.revisados}`);

  console.log(`Servicios a modificar/modificados: ${resumen.modificados}`);

  console.log(`Servicios sin cambios: ${resumen.sinCambios}`);

  console.log(`Componentes procesados: ${resumen.componentesMigrados}`);

  console.log(`Resueltos por referenciaId: ${resumen.resueltosPorReferencia}`);

  console.log(`Resueltos por pruebaLabId: ${resumen.resueltosPorLegacy}`);

  console.log(`Resueltos por codExamen: ${resumen.resueltosPorCodigo}`);

  console.log(`Pendientes: ${resumen.pendientes.length}`);

  console.log(`Conflictos: ${resumen.conflictos.length}`);

  // ====== Mostrar pendientes ======

  if (resumen.pendientes.length) {
    console.log("");
    console.log("===== PENDIENTES =====");

    console.table(resumen.pendientes);
  }

  // ====== Mostrar conflictos ======

  if (resumen.conflictos.length) {
    console.log("");
    console.log("===== CONFLICTOS =====");

    console.table(resumen.conflictos);
  }

  console.log("");

  if (!aplicarCambios) {
    console.log("SIMULACIÓN TERMINADA. No se modificó ningún registro.");

    console.log("Para aplicar: node scripts/migrar-servicios-v2.js --apply");
  } else {
    console.log("MIGRACIÓN APLICADA.");
  }

  console.log("");

  await mongoose.disconnect();
};

// ====== Ejecutar ======

ejecutarMigracion()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("");
    console.error("ERROR DE MIGRACIÓN:", error);

    try {
      await mongoose.disconnect();
    } catch {}

    process.exit(1);
  });
