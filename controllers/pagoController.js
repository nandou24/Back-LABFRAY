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
            serviciosCotizacion,
            detallePagos,
            totalFacturar,
            faltaPagar,
            codCotizacion,
            estadoCotizacion,
            tienePagosAnteriores
        } = req.body;

        // 1. Validar que serviciosCotizacion no esté vacío
        if (!serviciosCotizacion || !Array.isArray(serviciosCotizacion) || serviciosCotizacion.length === 0) {
            return res.status(400).json({
            ok: false,
            msg: 'No se han registrado servicios en la cotización.'
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
    
        // 4. Validar faltaPagar >= 0
        if (typeof faltaPagar !== 'number' || faltaPagar < 0) {
            return res.status(400).json({
            ok: false,
            msg: 'El monto de "falta pagar" no puede ser negativo.'
            });
        }
      
        // Validar coherencia entre pagos y faltaPagar
        const totalPagado = detallePagos.reduce((acc, p) => acc + (p.monto || 0), 0);
        const totalFormulario = req.body.total;

        const diferencia = Math.abs((totalFormulario - totalPagado) - faltaPagar);
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
    
            await Pago.updateOne(
                { codCotizacion },
                { $push: { detallePagos: { $each: nuevosPagos } } },
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




        // Caso: primer pago -> crear nuevo documento sea parcial o total
        const detalleConAntiguedad = req.body.detallePagos.map(p => ({
            ...p,
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
        });

        console.log("Datos a grabar"+nuevoPago)

        await nuevoPago.save();

        await Cotizacion.findOneAndUpdate(
            { codCotizacion },
            { $set: { estadoCotizacion: estadoCotizacion } },
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

    if (nuevoNumero > 999999) {
        const error = new Error(`Se alcanzó el límite máximo de códigos de pago para el año ${anioActual}.`);
        error.name = 'LimitePagoError';
        throw error;  
    }

    const correlativo = nuevoNumero.toString().padStart(6, '0');
  
    return `${prefijo}-${correlativo}`;
};

const mostrarUltimasCotizaciones = async(req, res = response) => {
    
  console.log("entro a controlador mostrar cotizaciones")

    try {
        const cantidad = req.query.cant;
        const limite = parseInt(cantidad);

        const cotizaciones = await Cotizacion.find()
          .sort({createdAt: -1})
          .limit(limite)
          .lean();

         // 📌 Obtener solo la última versión del historial en cada cotización
        /*
         const cotizacionesConUltimaVersion = cotizaciones.map(cot => ({
            ...cot,
            historial: cot.historial.length > 0 ? [cot.historial[cot.historial.length - 1]] : [],
        }))*/

        return res.json({
            ok: true,
            cotizaciones : cotizaciones
        })

    } catch (error) {
        console.error("❌ Error al consultar cotizaciones:", error);
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

const crearNuevaVersionCotiPersona = async (req, res = response) => {
  
  try {

    const { codCotizacion, historial, estado } = req.body;

    const cotizacionExistente = await Cotizacion.findOne({ codCotizacion });
    
    if (!cotizacionExistente) {
        return res.status(404).json({
            ok: false,
            msg: "La cotización no existe.",
        });
    }

    console.log('Datos recibidos:', req.body);

    const ultimaVersion = cotizacionExistente.historial[cotizacionExistente.historial.length - 1];

    const nuevaVersion = {
        ...historial[0], // Tomamos el único historial enviado desde el frontend
        version: ultimaVersion ? ultimaVersion.version + 1 : 1, // Incrementamos la versión
        fechaModificacion: new Date(), // Generamos la nueva fecha
      };

    //Generar el JWT
    //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
    //Crear usuario de base de datos

    const objetosSonIguales = (obj1, obj2) => {

        // Clonamos los objetos profundamente para evitar mutaciones
        const obj1Clonado = JSON.parse(JSON.stringify(obj1));
        const obj2Clonado = JSON.parse(JSON.stringify(obj2));

        // Clonamos los objetos y eliminamos `fechaModificacion`
        delete obj1Clonado.fechaModificacion;
        delete obj2Clonado.fechaModificacion;
        delete obj1Clonado.version;
        delete obj2Clonado.version;
        delete obj1Clonado._id;
        delete obj2Clonado._id;
         // 📌 Si existe `serviciosCotizacion`, eliminamos `_id` en cada servicio
        if (obj1Clonado.serviciosCotizacion && obj2Clonado.serviciosCotizacion) {
            obj1Clonado.serviciosCotizacion.forEach(servicio => delete servicio._id);
            obj2Clonado.serviciosCotizacion.forEach(servicio => delete servicio._id);

             // 📌 Ordenamos los servicios para evitar diferencias por el orden
            obj1Clonado.serviciosCotizacion.sort((a, b) => a.codServicio.localeCompare(b.codServicio));
            obj2Clonado.serviciosCotizacion.sort((a, b) => a.codServicio.localeCompare(b.codServicio));
        }
      
        //console.log(JSON.stringify(obj1Clonado) === JSON.stringify(obj2Clonado))
        //console.log(JSON.stringify(obj1Clonado.serviciosCotizacion) === JSON.stringify(obj2Clonado.serviciosCotizacion))
        console.log("obj1",obj1Clonado)
        console.log("obj2",obj2Clonado)

        return JSON.stringify(obj1Clonado) === JSON.stringify(obj2Clonado)
    };

    
    // 🔄 Verificación opcional: Evitar versiones duplicadas si no hubo cambios
    if (objetosSonIguales(nuevaVersion, ultimaVersion)) {

        return res.status(400).json({
            ok: false,
            msg: "No hay cambios para generar una nueva versión.",
        });
    }
    
    
    const cotizacionActualizada = await Cotizacion.findOneAndUpdate(
        { codCotizacion },
        {
            $push: { historial: nuevaVersion }, // 📌 Agregar nueva versión al historial
            $set: { estado: estado || "modificada" } // 📌 Actualizar estado
        }
    );

    if (cotizacionActualizada) {
      //Generar respuesta exitosa
        return res.status(200).json({
            ok: true,
            msg: "Nueva versión de la cotización agregada con éxito.",
            //uid: dbPaciente.id,
            //token: token,
        });
    }
        
  } catch (error) {
    console.error("Error al generar nueva versión de la cotización:", error);
    return res.status(500).json({
        ok: false,
        msg: "Error interno al generar la nueva versión de la cotización.",
    });
  }
};


module.exports = {
    generarPagoPersona,
    mostrarUltimasCotizaciones,
    encontrarTermino,
    crearNuevaVersionCotiPersona,
    encontrarDetallePago
  }