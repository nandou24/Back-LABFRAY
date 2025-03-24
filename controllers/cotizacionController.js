const { response } = require("express");
const bcrypt = require('bcryptjs');
const { generarJWT } = require('../helpers/jwt');
const jwt = require("jsonwebtoken");
const Cotizacion = require("../models/CotizacionPaciente");

const crearCotizacion = async (req, res = response) => {  
  
    try {

        const {
            historial,
            codCotizacion
            } = req.body;

  
        // verificar si la prueba existe
        const cotizacion = await Cotizacion.findOne({ codCotizacion });
  
        if (cotizacion) {
            return res.status(400).json({
            ok: false,
            msg: "Ya existe una cotización con ese código",
            });
        }

        // 📌 Validación: Los servicios cotizados son requeridos
        if (!historial || historial.length === 0 || !historial[0].serviciosCotizacion || historial[0].serviciosCotizacion.length === 0) {
        return res.status(400).json({ ok: false, msg: 'Debe agregar al menos un servicio' });
        }
      

        console.log('Datos recibidos:', req.body);
 
        //Generar el JWT
        //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
        //Crear usuario de base de datos

        //creando codigo prueba
        // Buscar el última prueba creada en el área
        const anioActual = new Date().getFullYear();
        const ultimaCotizacion = await Cotizacion.findOne({ codCotizacion: new RegExp(`^${anioActual}-`)})
        .sort({codCotizacion:-1})
        .lean()
        
        console.log(ultimaCotizacion + ' último servicio del área')
      
        // Obtener el correlativo
        let correlativo = 1;
        if (ultimaCotizacion) {
        const ultimoCodigo  = ultimaCotizacion.codCotizacion;
        const ultimoNumero = parseInt(ultimoCodigo.split('-')[1], 10);
        console.log(ultimoNumero +' ultimoCorrelativo')
        correlativo = ultimoNumero  + 1;
        console.log(correlativo+' correlativo')
        }

        if (correlativo > 99999) {
        return res.status(400).json({
            ok: false,
            msg: "El número máximo de cotizacione ha sido alcanzado para este año.",
        });
        }

        //Crear el nuevo código (Ejemplo: 2024-000001)
        const nuevoCodigo = `${anioActual}-${String(correlativo).padStart(6, '0')}`;

        // Crear la prueba con el código
        const nuevaCotizacion = new Cotizacion({
        ...req.body,
        codCotizacion: nuevoCodigo, // Agregar el código de la prueba generado
        historial: [{
            ...historial[0], // Tomamos los datos de la primera versión del historial
            version: 1, // Primera versión
            fechaModificacion: new Date(), // Fecha de creación
            }]
        });

      console.log("Datos a grabar"+nuevaCotizacion)

        await nuevaCotizacion.save();
        // console.log(dbUser, "pasoo registro");
        //Generar respuesta exitosa
        return res.status(201).json({
        ok: true,
        msg: 'Cotización registrada con éxito',
        cotizacion: nuevaCotizacion,
        //token: token,
        });
    } catch (error) {
        console.error('Error al registrar la cotización:', error);
        return res.status(500).json({
            ok: false,
            msg: "Error al momento de registrar",
        });
    }
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

      const cotizaciones = await Cotizacion.find({       
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
    crearCotizacion,
    mostrarUltimasCotizaciones,
    encontrarTermino,
    crearNuevaVersionCotiPersona
  }