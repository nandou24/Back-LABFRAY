const { response } = require("express");
const bcrypt = require('bcryptjs');
const { generarJWT } = require('../helpers/jwt');
const jwt = require("jsonwebtoken");
const Pago = require("../models/PagoPaciente");
const Cotizacion = require("../models/CotizacionPaciente");
const mongoose = require('mongoose');

const generarPagoPersona = async (req, res = response) => { 

    const session = await mongoose.startSession();
    session.startTransaction();
  
    try {

        const {
            codPago,
            serviciosCotizacion,
            detallePagos,
            totalFacturar,
            faltaPagar,
            subTotalFacturar,
            igvFacturar,
            codCotizacion,
            //estadoCotizacion,
            tienePagosAnteriores
        } = req.body;

        const totalFormulario = req.body.total;
        const faltaPagarFrontend = req.body.faltaPagar;

        // 1. Validar que serviciosCotizacion no esté vacío
        if (!serviciosCotizacion || !Array.isArray(serviciosCotizacion) || serviciosCotizacion.length === 0) {
            return res.status(400).json({
            ok: false,
            msg: 'No se han registrado servicios en la cotización a pagar.'
            });
        }

        // 2. Validar que detallePagos no esté vacío
        if (!detallePagos || !Array.isArray(detallePagos) || detallePagos.length === 0) {
            return res.status(400).json({
            ok: false,
            msg: 'Debe registrar al menos un pago en la cotización.'
            });
        }

        // 3. Validar totalFacturar > 0
        if (typeof totalFacturar !== 'number' || totalFacturar <= 0) {
            return res.status(400).json({
            ok: false,
            msg: 'El total a facturar debe ser mayor que cero.'
            });
        }

        // 4. Calcular totalPagado (monto + recargo)
        const totalPagadoCalculado = detallePagos.reduce((acc, p) => {
            const monto = Number(p.monto) || 0;
            //const recargo = Number(p.montoConRecargo || 0) - monto;
            return acc + monto;// + recargo;
        }, 0);

        // 5. Calcular faltaPagar real
        const faltaPagarCalculado = +(totalFormulario - totalPagadoCalculado).toFixed(3);

        // 6. Comparar con el faltaPagar recibido del frontend
        const diferenciaFaltaPagar = Math.abs(faltaPagarCalculado - faltaPagarFrontend);
        if (diferenciaFaltaPagar > 0.01) {
        return res.status(400).json({
            ok: false,
            msg: 'Inconsistencia detectada entre el monto de falta por pagar enviado y el calculado.'
        });
        }
    
        // 7. Validar faltaPagar no negativo
        if (faltaPagarCalculado < 0) {
        return res.status(400).json({
            ok: false,
            msg: 'El monto de "falta pagar" no puede ser negativo.'
        });
        }

        // 8. Determinar estadoCotizacion en base a faltaPagar
        const estadoCotizacion = faltaPagarCalculado > 0 ? 'PAGO PARCIAL' : 'PAGO TOTAL';
      
        // 9. Validar coherencia entre pagos y faltaPagar
        //const totalPagado = detallePagos.reduce((acc, p) => acc + (p.monto || 0), 0);

        const diferencia = Math.abs((totalFormulario - totalPagadoCalculado) - faltaPagarCalculado);
        if (diferencia > 0.01) {
            return res.status(400).json({
                ok: false,
                msg: 'Los valores de pagos y falta pagar no coinciden con el total.'
            });
        }

        console.log('Datos recibidos:', req.body);

        // Caso: ya existen pagos -> actualizar documento
        if (tienePagosAnteriores) {
                const nuevosPagos = detallePagos.filter(p => !p.esAntiguo).map(p => ({
                ...p,
                esAntiguo: true
            }));

            console.log("Datos a grabar",nuevosPagos)
    
            await Pago.updateOne(
                { codCotizacion },
                { $push: { detallePagos: { $each: nuevosPagos }},
                    $set: { 
                        faltaPagar: faltaPagarCalculado,
                        subTotalFacturar,
                        igvFacturar, 
                        totalFacturar} },
                { session }
            );
    
            await Cotizacion.findOneAndUpdate(
                { codCotizacion },
                { $set: { estadoCotizacion } },
                { session }
            );
    
            await session.commitTransaction();
                session.endSession();
    
            return res.status(200).json({
                ok: true,
                msg: 'Pago actualizado con éxito y estado de la cotización actualizado.'
            });
        }

        console.log("detalle a grabar",detallePagos)
        // Caso: primer pago -> crear nuevo documento sea parcial o total
        const detalleConAntiguedad = detallePagos.map(p => ({
            medioPago: p.medioPago,
            monto: p.monto,
            recargo: p.recargo,
            numOperacion: p.numOperacion,
            fechaPago: p.fechaPago,
            banco: p.banco,
            esAntiguo: true  // Marca que estos pagos ya fueron registrados
        }));
 
        //Generar el JWT
        //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
        
        // Crear el código del pago
        const nuevoCodPago = await generarCodigoPago();

        // Crear el pago
        const nuevoPago = new Pago({
            ...req.body,
            detallePagos: detalleConAntiguedad,
            codPago: nuevoCodPago, // Agregar el código de la prueba generado
            faltaPagar: faltaPagarCalculado
        });

        console.log("Datos a grabar"+nuevoPago)

        await nuevoPago.save();

        await Cotizacion.findOneAndUpdate(
            { codCotizacion },
            { $set: { estadoCotizacion } },
            { session }
        );

        await session.commitTransaction();
        session.endSession();

        //Generar respuesta exitosa
        return res.status(200).json({
            ok: true,
            msg: 'Pago registrado con éxito y actualizado el estado de la cotización.',
            data: nuevoPago.codPago,
            //token: token,
        });
    } catch (error) {

        await session.abortTransaction();
        session.endSession();

        console.error('Error al registrar el pago:', error);
        console.log('❌ Transacción revertida correctamente');

        if (error.name === 'LimitePagoError') {
            return res.status(400).json({
              ok: false,
              msg: error.message
            });
        }

        console.error('Error al registrar el pago:', error);
        return res.status(500).json({
            ok: false,
            msg: "Error al momento de registrar el pago.",
        });
    }
};

const generarCodigoPago = async () => {
    const anioActual = new Date().getFullYear();
    const prefijo = `P${anioActual}`;
  
    // Buscar el último código que comience con el prefijo del año actual
    const ultimoPago = await Pago.findOne({ codPago: new RegExp(`^${prefijo}`) })
                                 .sort({ codPago: -1 })
                                 .lean();
  
    let nuevoNumero = 1;

    if (ultimoPago?.codPago) {
    const ultimaParte = ultimoPago.codPago.split('-')[1]; // ejemplo: "000237"
    nuevoNumero = parseInt(ultimaParte, 10) + 1;
    }

    if (nuevoNumero > 99999) {
        const error = new Error(`Se alcanzó el límite máximo de códigos de pago para el año ${anioActual}.`);
        error.name = 'LimitePagoError';
        throw error;  
    }

    const correlativo = nuevoNumero.toString().padStart(5, '0');
  
    return `${prefijo}-${correlativo}`;
};

const mostrarUltimosPagos = async(req, res = response) => {
    
    console.log("entro a controlador mostrar pagos")
  
    try {
    const cantidad = req.query.cant;
    const limite = parseInt(cantidad);

    const pagos = await Pago.find({
        estadoCotizacion: { $in: ['PAGO TOTAL', 'PAGO PARCIAL'] }
    })
    .sort({createdAt: -1})
    .limit(limite)
    .lean();

    return res.json({
        ok: true,
        pagos : pagos
    })

    } catch (error) {
        console.error("❌ Error al consultar pagos:", error);
        return res.status(500).json({
            ok: false,
            msg: 'Error en la consulta'
        })
    }
}


const encontrarTermino = async(req, res = response) => {
    
  const termino = req.query.search;
  console.log(termino)

  try {

      const cotizaciones = await Pago.find({       
        historial: {
            $elemMatch: {
                $or: [
                    { nomCliente: { $regex: termino, $options: 'i' } },  // Nombre del cliente
                    { nroDoc: { $regex: termino, $options: 'i' } },      // Número de documento
                ]
            }
        }
      })
      .sort({ updatedAt: -1 }) // 📌 Ordena de más nuevas a más antiguas
      .limit(10); // 📌 Limita a 10 resultados;
      return res.json({
          ok: true,
          cotizaciones //! favoritos: favoritos
      })

  } catch (error) {
      console.log(error);
      return res.status(500).json({
          ok: false,
          msg: 'Error en la consulta'
      })
  }
}

const encontrarDetallePago = async(req, res = response) => {
    
    const termino = req.query.codCoti;
    console.log('termino',termino)
  
    try {
  
        if (!termino) {
            return res.status(400).json({
              ok: false,
              msg: 'El código de cotización es requerido.',
              detallePago: []
            });
          }

        const pagos  = await Pago.findOne({ codCotizacion: termino });

        if (!pagos || pagos.length === 0) {
            return res.status(404).json({
              ok: false,
              msg: 'No se encontraron pagos para esta cotización.',
              detallePago: []
            });
          }

        return res.status(200).json({
            ok: true,
            detallePago: pagos.detallePagos
        });
  
    } catch (error) {
        console.error('❌ Error en backend:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Error al obtener el detalle de pagos',
            detallePago: []
            });
        }
}

const anularPago  = async(req, res = response) => {

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { motivo, observacion } = req.body;
        const { codPago } = req.params;

        console.log('Datos recibidos para anular pago:', req.body);

        // Validar que se envíe el código de pago
        if (!codPago || !motivo ) {
            return res.status(400).json({
                ok: false,
                msg: 'El código de pago y el motivo son requeridos.'
            });
        }

        // Buscar el pago por su código
        const pago = await Pago.findOne({ codPago });

        // Validar que el pago exista
        if (!pago) {
            return res.status(404).json({
                ok: false,
                msg: 'Pago no encontrado.'
            });
        }

        // Verificar si el pago ya está anulado
        if (pago.estadoPago === 'ANULADO' || pago.estadoPago === 'FACTURADO') {
            return res.status(400).json({
                ok: false,
                msg: 'El pago ya fue anulado previamente.'
            });
        }

        // Actualizar el estado del pago a ANULADO y agregar la información de anulación
        await Pago.updateOne(
            { codPago },
            { 
                $set: { 
                    estadoPago: 'ANULADO',
                    anulacion: {
                        motivo: motivo,
                        observacion: observacion,
                        fecha: new Date()
                    }
                }
            },
            { session }
        );

        // Actualizar el estado de la cotización a MODIFICADO
        await Cotizacion.updateOne(
            { codCotizacion: pago.codCotizacion },
            { $set: { estadoCotizacion: 'PAGO ANULADO' } },
            { session }
        );


        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({
            ok: true,
            msg: 'Pago anulado con éxito.'
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        
        console.error('❌ Error al anular el pago:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Error al anular el pago.'
        });
    }

}



module.exports = {
    generarPagoPersona,
    mostrarUltimosPagos,
    encontrarTermino,
    encontrarDetallePago,
    anularPago
  }