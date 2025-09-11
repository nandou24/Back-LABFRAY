const mongoose = require("mongoose");
const { Schema } = require("mongoose");

const AtencionEmpresaSchema = Schema ({

    codAtencion: { type: String, required: true },
  empresaId: { type: String, required: true },
  servicioTipo: { type: String, enum: ['ETAs', 'Ocupacional', 'Otro'], required: true },
  fechaRegistro: { type: String, required: true },

  programaciones: [
    {
      fechas: [
        {
          fecha: { type: Date, required: true }, // día programado
          horaInicio: { type: String, required: true },
          horaFin: { type: String, required: true }
        }
      ],
      sedeEmpresa: { type: String, required: true },
      direccion: { type: String, required: true },
      linkMaps: { type: String },
      personalAsignado: [{ type: String, required: true }], // ids de usuarios internos asignados
      estado: { type: String, enum: ['BORRADOR', 'PROGRAMADA', 'ATENDIDA', 'NO_REALIZADA'], required: true },
      observacion: { type: String },
      archivos: [{ type: String }] // fotos/actas de ese día
    }
  ],

  facturacion: [
    {
      serie: { type: String },
      numero: { type: String },
      fechaEmision: { type: Date },
      vencimiento: { type: String },
      subtotal: { type: Number },
      igv: { type: Number },
      total: { type: Number },
      aplicaDetraccion: { type: Boolean },
      porcDetraccion: { type: Number },
      archivos: [{ type: String }], // PDF/imagen factura
      detraccion: {
        nroConstancia: { type: String },
        fecha: { type: Date },
        monto: { type: Number },
        banco: { type: String, enum: ['BN', 'OTRO'] },
        archivos: [{ type: String }]
      }
    }
  ],

  pagos: [
    {
      fecha: { type: Date},
      medio: { type: String, enum: ['TRANSFERENCIA', 'EFECTIVO', 'YAPE', 'PLIN', 'TARJETA', 'OTRO'] },
      referencia: { type: String },
      monto: { type: Number },
      observacion: { type: String },
      archivos: [{ type: String }] // capturas
    }
  ],

  totales: {
    pagadoNeto: { type: Number },
    detraccion: { type: Number },
    cobertura: { type: Number },
    saldo: { type: Number }
  },
  estado: { type: String, required: true }, // You may want to specify enum if EstadoAtencion is a set of values
  contactosEmpresa: [
    {
      nombre: { type: String, required: true },
      cargo: { type: String },
      telefono: { type: String, required: true },
      email: { type: String }
    }
  ],
  linksResultados: [{ type: String }], // URLs a informes/resultados
  archivosGenerales: [{ type: String }] // otros adjuntos
})

module.exports = {
  AtencionEmpresaModel: mongoose.model(
    "atencionEmpresaCollection",
    AtencionEmpresaSchema
  )
};