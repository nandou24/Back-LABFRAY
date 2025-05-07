const { response } = require("express");
const bcrypt = require('bcryptjs');
const PruebaLab = require("../models/PruebaLab");
const { generarJWT } = require('../helpers/jwt');
const jwt = require("jsonwebtoken");
const Servicio = require("../models/Servicio");

const crearServicio = async (req, res = response) => {
   
    const { 
        tipoServicio,
        nombreServicio
    } = req.body;
    
  
    try {
  
      console.log('tipoServicio',tipoServicio)

      let tipo = ''

      switch (tipoServicio) {
        case 'Laboratorio':
          tipo = 'LAB'
          break;
        case 'Ecografía':
          tipo = 'ECO'
          break;
        case 'Consulta Médica':
          tipo = 'CON'
          break;
        case 'Procedimiento':
          tipo = 'PRO'
          break;
        default:
          return res.status(400).json({
            ok: false,
            msg: 'Tipo de examen no válido',
          });
      }

      console.log('tipo',tipo)

      // verificar si la prueba existe
      const servicio = await Servicio.findOne({ nombreServicio });
  
      if (servicio) {
        return res.status(400).json({
          ok: false,
          msg: "Ya existe una servicio con ese nombre",
        });
      }
      
      console.log('Datos recibidos:', req.body);
 
      //Generar el JWT
      //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
      //Crear usuario de base de datos

      //creando codigo prueba
      // Buscar el última prueba creada en el área
      const ultimoServicio = await Servicio.findOne({ tipoServicio: tipoServicio}).sort({codServicio:-1})
       
      console.log(ultimoServicio + ' último servicio del área')
      
      // Obtener el correlativo
      let correlativo = 1;
      if (ultimoServicio) {
        const ultimoCorrelativo = parseInt(ultimoServicio.codServicio.slice(3, 7));
        console.log(ultimoCorrelativo+' ultimoCorrelativo')
        correlativo = ultimoCorrelativo + 1;
        console.log(correlativo+' correlativo')
      }

      if (correlativo > 9999) {
        return res.status(400).json({
          ok: false,
          msg: "El número máximo de servicios ha sido alcanzado para este tipo de servicio.",
        });
      }

      // Correlativo con seis dígitos, maximo 9999
      const correlativoStr = correlativo.toString().padStart(4, '0');
      console.log(correlativoStr+' correlativo')

      // Crear el número de código
      const codigoServicio = `${tipo}${correlativoStr}`;
      console.log(codigoServicio+' codigo generado')

      // Crear la prueba con el código
      const nuevoServicio = new Servicio({
        ...req.body,
        codServicio: codigoServicio, // Agregar el código de la prueba generado
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
      console.error(error);
      return res.status(500).json({
        ok: false,
        msg: "Error al momento de registrar",
      });
    }
};

const mostrarUltimosServicios = async(req, res = response) => {
    
  console.log("entro a controlador mostrar servicios")

    try {
        // const cantidad = req.query.cant;
        // const limite = parseInt(cantidad);

        const servicios = await Servicio.find()
          //.sort({createdAt: -1})
          //.limit(limite);

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

      const servicios = await Servicio.find({
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

const encontrarTipoExamen = async(req, res = response) => {
    
  const tipo = req.query.search;

  try {
      let examenes = [];
  
      // // 🔥 Escoger la colección correcta según el tipo de servicio
      // if (termino === 'Laboratorio') {
      //   examenes = await PruebaLab.find();  // Colección de pruebas de laboratorio
      // } else if (termino === 'Ecografía') {
      //   examenes = await Ecografia.find();  // Colección de ecografías
      // } else if (termino === 'Consulta Médica') {
      //   examenes = await Consulta.find();  // Colección de consultas médicas
      // } else if (termino === 'Procedimiento') {
      //   examenes = await Procedimiento.find();  // Colección de procedimientos médicos
      // }

      switch (tipo) {
        case 'Laboratorio':
          examenes = await PruebaLab.find();
          break;
        case 'Ecografía':
          examenes = await Ecografia.find();
          break;
        case 'Consulta Médica':
          examenes = await Consulta.find();
          break;
        case 'Procedimiento':
          examenes = await Procedimiento.find();
          break;
        default:
          return res.status(400).json({
            ok: false,
            msg: 'Tipo de examen no válido',
          });
      }
  
      return res.json({
        ok: true,
        examenes
      })

    } catch (error) {
      console.error('[ERROR encontrarExamenesPorTipo]:', error);
      return res.status(500).json({ 
        ok: false,
        msg: 'Error interno al obtener exámenes por tipo'
       });
    }
}

const actualizarServicio = async (req, res = response) => {
  
  const codigoServicio = req.params.codServicio; //recupera el codPrueba
  console.log(codigoServicio)
  const datosActualizados = req.body; //recupera los datos a grabar
  const nombreServicio =req.body.nombreServicio
  console.log(codigoServicio)
  delete datosActualizados._id; //quita los _id generados por el mongo y que no se pueden modificar
  delete datosActualizados.examenesServicio._id;

  try {

    // verificar si la prueba existe
    const nombre = await Servicio.findOne({ nombreServicio });
  
    if (nombre) {
      return res.status(400).json({
        ok: false,
        msg: "Ya existe un servicio con ese nombre",
      });
    }
    
    console.log('Datos recibidos:', req.body);

    //Hashear la contraseña mediante un hash
    //const numAletorio = bcrypt.genSaltSync();
    //dbPaciente.password = bcrypt.hashSync(password, numAletorio);

    //Generar el JWT
    //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
    //Crear usuario de base de datos

    const servicio = await Servicio.findOneAndUpdate({codServicio:codigoServicio},datosActualizados);

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
    crearServicio,
    mostrarUltimosServicios,
    encontrarTermino,
    encontrarTipoExamen,
    actualizarServicio
  }