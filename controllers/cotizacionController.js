const { response } = require("express");
const bcrypt = require('bcryptjs');
const { generarJWT } = require('../helpers/jwt');
const jwt = require("jsonwebtoken");
const Cotizacion = require("../models/CotizacionPaciente");

const crearCotizacion = async (req, res = response) => {
   
    const {
        serviciosCotizacion,
        codCotizacion
        } = req.body;
    
  
    try {
  
        // verificar si la prueba existe
        const cotizacion = await Cotizacion.findOne({ codCotizacion });
  
        if (cotizacion) {
            return res.status(400).json({
            ok: false,
            msg: "Ya existe una cotización con ese código",
            });
        }

        if (!serviciosCotizacion || serviciosCotizacion.length === 0) {
            return res.status(400).json({ ok: false, msg: 'Debe agregar al menos un servicio' });
        }
      

        console.log('Datos recibidos:', req.body);
 
      //Generar el JWT
      //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
      //Crear usuario de base de datos

      //creando codigo prueba
      // Buscar el última prueba creada en el área
      const anioActual = new Date().getFullYear();
      const ultimaCotizacion = await Cotizacion.findOne({ codCotizacion: new RegExp(`^${anioActual}-`)}).sort({codCotizacion:-1}).lean()
       
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
      const nuevoServicio = new Cotizacion({
        ...req.body,
        codCotizacion: nuevoCodigo, // Agregar el código de la prueba generado
      });

      console.log("Datos a grabar"+nuevoServicio)

      await nuevoServicio.save();
      // console.log(dbUser, "pasoo registro");
      //Generar respuesta exitosa
      return res.status(201).json({
        ok: true,
        uid: nuevoServicio.id,
        //token: token,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        msg: "Error al momento de registrar",
      });
    }
};

const mostrarUltimosServicios = async(req, res = response) => {
    
  console.log("entro a controlador mostrar servicios")

    try {
        const cantidad = req.query.cant;
        const limite = parseInt(cantidad);

        const servicios = await Cotizacion.find()
          //.sort({createdAt: -1})
          .limit(limite);

        return res.json({
            ok: true,
            servicios
        })

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error en la consulta'
        })
    }
}


const encontrarTermino = async(req, res = response) => {
    
  const termino = req.query.search;

  try {

      const servicios = await Cotizacion.find({
        //nroDoc: { $regex: termino, $options: 'i'}
        
        $or: [
          { nombreServicio: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "nombre"
          { codServicio: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido paterno"
          // Agrega más campos si es necesario
        ]
      });
      return res.json({
          ok: true,
          servicios //! favoritos: favoritos
      })

  } catch (error) {
      console.log(error);
      return res.status(500).json({
          ok: false,
          msg: 'Error en la consulta'
      })
  }
}


const actualizarServicio = async (req, res = response) => {

  console.log(req)
  
  const codigoServicio = req.params.codServicio; //recupera el codPrueba
  console.log(codigoServicio)
  const datosActualizados = req.body; //recupera los datos a grabar
  delete datosActualizados._id; //quita los _id generados por el mongo y que no se pueden modificar
  delete datosActualizados.examenesServicio._id;

  try {
    
    console.log('Datos recibidos:', req.body);

    //Hashear la contraseña mediante un hash
    //const numAletorio = bcrypt.genSaltSync();
    //dbPaciente.password = bcrypt.hashSync(password, numAletorio);

    //Generar el JWT
    //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
    //Crear usuario de base de datos

    const servicio = await Cotizacion.findOneAndUpdate({codServicio:codigoServicio},datosActualizados);

    if (!servicio) {
      return res.status(404).json({
        ok: false,
        msg: 'Prueba no encontrada con ese código'
      });
    }

        
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      //uid: dbPaciente.id,
      //token: token,
    });
  } catch (error) {
    console.error("Error al actualizar servicio: ", error)
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};


module.exports = {
    crearCotizacion,
    mostrarUltimosServicios,
    encontrarTermino,
    actualizarServicio
  }