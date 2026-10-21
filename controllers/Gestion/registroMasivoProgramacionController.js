const crypto = require('crypto');
const mongoose = require('mongoose');
const Empresa = require('../../models/Mantenimiento/Empresa');
const Programacion = require('../../models/Gestion/programacionPacienteEmpresa');
const { analizarFilasImportacion } = require('./validacionMasivaProgramacionController');

const errorNegocio = (msg, codigo = 'LOTE_INVALIDO', status = 409, detalles = []) =>
  Object.assign(new Error(msg), { codigo, status, detalles });
const huellaFila = (fila) => crypto.createHash('sha256').update(JSON.stringify({
  empresaId: fila.empresaId, protocoloId: fila.protocoloId, datos: fila.datos,
})).digest('hex');
const fechaSoloDia = (valor) => new Date(`${valor}T00:00:00.000Z`);
// ====== La programación se interpreta como día local de Perú ======
const fechaProgramacionPeru = (valor) => new Date(`${valor}T00:00:00.000-05:00`);
const texto = (valor) => String(valor ?? '').trim();

// ====== Confirmar cada lote usando el estado actual de MongoDB ======
const registrarImportacionProgramaciones = async (req, res) => {
  const importacionId = texto(req.body?.importacionId);
  const filas = req.body?.filas;
  if (!/^[a-zA-Z0-9-]{18,80}$/.test(importacionId) ||
      !Array.isArray(filas) || !filas.length || filas.length > 100 ||
      filas.some((f) => !Number.isInteger(f?.filaExcel) || f.filaExcel < 2 || !f.datos) ||
      new Set(filas.map((f) => f.filaExcel)).size !== filas.length) {
    return res.status(400).json({ ok: false, msg: 'Identificador o filas de importación inválidos (máximo 100 por lote).' });
  }

  let respuesta;
  for (let intento = 0; intento < 3; intento++) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // ====== Recuperar filas ya registradas por esta misma importación ======
        const existentesImportacion = await Programacion.find({
          importacionId, filaExcelImportacion: { $in: filas.map((f) => f.filaExcel) },
        }).session(session).lean();
        const existentesPorFila = new Map(existentesImportacion.map((p) => [p.filaExcelImportacion, p]));
        const resultados = [];
        const pendientes = [];
        for (const fila of filas) {
          const previa = existentesPorFila.get(fila.filaExcel);
          if (!previa) {
            pendientes.push(fila);
            continue;
          }
          if (previa.huellaImportacion !== huellaFila(fila)) {
            throw errorNegocio(`La fila ${fila.filaExcel} ya fue registrada con otros datos. No puede reemplazarse usando el mismo identificador.`, 'FILA_IMPORTADA_MODIFICADA');
          }
          resultados.push({ filaExcel: fila.filaExcel, estado: 'YA_REGISTRADA',
            codProgramacion: previa.codProgramacion, programacionId: String(previa._id), hc: previa.hc ?? null });
        }

        if (pendientes.length) {
          // ====== Revalidar y bloquear cambios posteriores a la previsualización ======
          const verificacion = await analizarFilasImportacion(pendientes, session);
          const observadas = [];
          const porFila = new Map(pendientes.map((f) => [f.filaExcel, f]));
          for (const resultado of verificacion.resultados) {
            const fila = porFila.get(resultado.filaExcel);
            const adicionales = Array.isArray(fila.advertenciasOriginales)
              ? fila.advertenciasOriginales.filter((m) => typeof m === 'string').map((m) => m.slice(0, 180)).slice(0, 12)
              : [];
            const errores = [...resultado.errores];
            if (resultado.paciente.estado === 'COINCIDENCIA_NOMBRE') {
              errores.push('Existe una posible HC por nombres. Debe resolver la identidad antes de importar.');
            }
            if ((resultado.advertencias.length || adicionales.length) && fila.confirmada !== true) {
              errores.push('Confirma las observaciones de esta fila antes de importarla.');
            }
            if (resultado.estado === 'BLOQUEADO' || errores.length) {
              observadas.push({ filaExcel: fila.filaExcel, estado: 'BLOQUEADA', errores });
            }
          }
          if (observadas.length) {
            throw errorNegocio('El lote tiene filas bloqueadas o sin confirmar. No se guardó ninguna de sus filas.',
              'LOTE_NO_VALIDADO', 409, observadas);
          }

          // ====== Construir el snapshot vigente del protocolo ======
          const empresas = await Empresa.find({ _id: { $in: [...new Set(pendientes.map((f) => f.empresaId))] } })
            .session(session).lean();
          const empresasPorId = new Map(empresas.map((e) => [String(e._id), e]));
          const anio = new Date().getFullYear();
          const ultimo = await Programacion.findOne({ codProgramacion: new RegExp(`^PPE-${anio}-`) })
            .sort({ codProgramacion: -1 }).select('codProgramacion').session(session).lean();
          let correlativo = ultimo ? Number(ultimo.codProgramacion.split('-')[2]) + 1 : 1;
          const nuevos = [];
          for (const fila of pendientes) {
            const resultado = verificacion.resultados.find((r) => r.filaExcel === fila.filaExcel);
            const datos = fila.datos;
            const empresa = empresasPorId.get(fila.empresaId);
            const protocolo = empresa?.protocolos?.find((p) => String(p._id) === fila.protocoloId);
            if (!empresa || empresa.estado === false || !protocolo || protocolo.estado === false) {
              throw errorNegocio(`Empresa o protocolo de fila ${fila.filaExcel} no disponibles.`, 'CATALOGO_DESACTUALIZADO');
            }
            const plazo = protocolo.plazoResultados;
            const cantidad = Number(plazo?.cantidadDias);
            if (!Number.isInteger(cantidad) || cantidad < 1 || !['HABILES', 'CALENDARIO'].includes(plazo?.tipoDias)) {
              throw errorNegocio(`Plazo contractual inválido en fila ${fila.filaExcel}.`, 'PLAZO_INVALIDO');
            }
            if (!protocolo.servicios?.length || protocolo.servicios.some((s) =>
              !mongoose.isValidObjectId(s.servicioId) || !s.codServicio || !s.nombreServicio || !s.tipoServicio)) {
              throw errorNegocio(`Servicios incompletos en el protocolo de fila ${fila.filaExcel}.`, 'SERVICIOS_INVALIDOS');
            }
            const advertenciasOriginales = Array.isArray(fila.advertenciasOriginales) ? fila.advertenciasOriginales : [];
            const advertencias = [...new Set([...resultado.advertencias, ...advertenciasOriginales])].map((a) => texto(a).slice(0, 180)).slice(0, 18);
            const documento = texto(datos.nroDoc).toUpperCase();
            const pacienteVinculado = resultado.paciente.estado === 'HC_COINCIDE';
            nuevos.push({
              codProgramacion: `PPE-${anio}-${String(correlativo++).padStart(4, '0')}`,
              empresaId: empresa._id,
              rucEmpresa: empresa.ruc,
              razonSocialEmpresa: empresa.razonSocial,
              nombreComercialEmpresa: empresa.nombreComercial ?? '',
              protocoloId: protocolo._id,
              codProtocolo: protocolo.codigoProtocolo,
              nombreProtocolo: protocolo.nombreProtocolo,
              plazoResultados: { cantidadDias: cantidad, tipoDias: plazo.tipoDias },
              serviciosProgramados: protocolo.servicios.map((s) => ({
                servicioId: s.servicioId, codServicio: s.codServicio,
                nombreServicio: s.nombreServicio, tipoServicio: s.tipoServicio,
              })),
              tipoDoc: documento ? texto(datos.tipoDoc).toUpperCase() : null,
              nroDoc: documento || null,
              nombreCliente: texto(datos.nombreCliente),
              apePatCliente: texto(datos.apePatCliente),
              apeMatCliente: texto(datos.apeMatCliente),
              fechaNacimiento: datos.fechaNacimiento ? fechaSoloDia(datos.fechaNacimiento) : null,
              sexoCliente: datos.sexoCliente || null,
              pacienteId: pacienteVinculado ? resultado.paciente.pacienteId : null,
              hc: pacienteVinculado ? resultado.paciente.hc : null,
              fechaProgramada: fechaProgramacionPeru(datos.fechaProgramada),
              sede: datos.sede,
              tipoEvaluacion: datos.tipoEvaluacion,
              tipoAtencion: datos.tipoAtencion || 'Regular',
              prioridad: datos.prioridad || 'Normal',
              observaciones: texto(datos.observaciones),
              estadoProgramacion: 'PROGRAMADO',
              origenRegistro: 'IMPORTACION_EXCEL',
              importacionId, filaExcelImportacion: fila.filaExcel, huellaImportacion: huellaFila(fila),
              revisionImportacion: {
                advertencias,
                confirmadoPor: advertencias.length ? String(req.user.uid) : null,
                fechaConfirmacion: advertencias.length ? new Date() : null,
              },
              createdBy: req.user.uid,
              usuarioRegistro: req.user.nombreUsuario,
            });
          }

          // ====== El lote se confirma completo o se revierte completo ======
          const guardadas = await Programacion.insertMany(nuevos, { session, ordered: true });
          guardadas.forEach((p) => resultados.push({ filaExcel: p.filaExcelImportacion, estado: 'REGISTRADA',
            codProgramacion: p.codProgramacion, programacionId: String(p._id), hc: p.hc ?? null }));
        }
        respuesta = {
          ok: true, importacionId, resultados: resultados.sort((a, b) => a.filaExcel - b.filaExcel),
          creadas: resultados.filter((r) => r.estado === 'REGISTRADA').length,
          previamenteRegistradas: resultados.filter((r) => r.estado === 'YA_REGISTRADA').length,
        };
      });
      return res.status(201).json(respuesta);
    } catch (error) {
      // ====== Reintentar colisiones transitorias del correlativo ======
      if (intento < 2 && (error.code === 11000 || error.code === 112 ||
          error.hasErrorLabel?.('TransientTransactionError'))) continue;
      if (!error.codigo) console.error('Error de registro masivo de programaciones:', error);
      return res.status(error.status ?? 500).json({
        ok: false,
        codigo: error.codigo ?? 'ERROR_REGISTRO',
        msg: error.codigo ? error.message : 'No se pudo registrar el lote. Sus escrituras se revirtieron.',
        detalles: error.detalles ?? [],
      });
    } finally {
      await session.endSession();
    }
  }
};

module.exports = { registrarImportacionProgramaciones };
