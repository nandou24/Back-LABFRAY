const { response } = require("express");
const RecurHumano = require("../models/RecHumano");
const bcrypt = require('bcryptjs');
const { generarJWT } = require('../helpers/jwt');
const jwt = require("jsonwebtoken");

const crearRecursoHumano = async (req, res = response) => {

    //debemos generar un número de historia clínica año-mes-correlativo-inicial de ape pater - inicial ape mat
    const { 
        tipoDoc, 
        nroDoc, 
        nombreCliente, 
        apePatCliente,
        apeMatCliente,
        fechaNacimiento,
        sexoCliente,
        departamentoCliente,
        provinciaCliente,
        distritoCliente,
        direcCliente,
        mailCliente,
        phones,
        gradoInstruccion,
        profesionesRecurso,
        profesionSolicitante,
        especialidadesRecurso,
        esSolicitante
        } = req.body;
    
    //Para crear HC    
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = (fecha.getMonth() + 1).toString().padStart(2, '0');
  
    try {
      //   console.log(name, email, password, rol, "holaaa");
  
      // verificar el email si es que existe
      const recursoHumano = await RecurHumano.findOne({ tipoDoc, nroDoc });
  
      if (recursoHumano) {
        return res.status(400).json({
          ok: false,
          msg: "Ya existe un usuario con ese documento de identidad",
        });
      }
      
      console.log('Datos recibidos:', req.body);

      //Hashear la contraseña mediante un hash
      //const numAletorio = bcrypt.genSaltSync();
      //dbPaciente.password = bcrypt.hashSync(password, numAletorio);
  
      //Generar el JWT
      //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
      //Crear usuario de base de datos

      //creando codigo
      // Buscar el último recursoHumano creado
      const ultimoRecursoHumano = await RecurHumano.findOne({}, { codRecHumano: 1 }).sort({ codRecHumano: -1 }).lean();
      console.log(ultimoRecursoHumano + 'ultimo recurso aquíi')
      
      // Obtener el correlativo
      let correlativo = 1;

      if (ultimoRecursoHumano) {
        const ultimoCorrelativo = parseInt(ultimoRecursoHumano.codRecHumano.substring(2), 10);
        correlativo = ultimoCorrelativo + 1;
      }


      // Crear el número de historia clínica sin guiones
      const codigo = `RH${String(correlativo).padStart(4, '0')}`;

      // Crear el paciente con el número de historia clínica
      // Crear usuario con el modelo
      const nuevoRecursoHumano = new RecurHumano({
        ...req.body,
        codRecHumano: codigo, // Agregar el código generado
      });

      console.log(codigo)
      console.log(nuevoRecursoHumano+"nuevo paciente aquiii")

      await nuevoRecursoHumano.save();
      // console.log(dbUser, "pasoo registro");
      //Generar respuesta exitosa
      return res.status(201).json({
        ok: true,
        uid: nuevoRecursoHumano.id,
        //token: token,
      });
    } catch (error) {
      console.error("❌ Error al registrar el recurso humano:", error);
      return res.status(500).json({
        ok: false,
        msg: "Error al momento de registrar",
      });
    }
};

const mostrarUltimosRecurHumanos = async(req, res = response) => {

    try {
            const cantidad = req.query.cant;
            const limite = parseInt(cantidad);
            let recHumanos

            if(cantidad == 0){
              recHumanos = await RecurHumano.find()
            }
            else{
              recHumanos = await RecurHumano.find()
              //.sort({createdAt: -1})
              .limit(limite);
            }            
    
            return res.json({
                ok: true,
                recHumanos
            })
    
        } catch (error) {
            console.log(error);
            return res.status(500).json({
                ok: false,
                msg: 'Error en la consulta'
            })
        }

}

const obtenerSolicitantes = async (req, res = response) => {
  try {

            const cantidad = req.query.cant;
            const limite = parseInt(cantidad);

      // Filtrar solo los recursos humanos donde `esSolicitante` es `true`
      const recHumanos = await RecurHumano.find(
          { esSolicitante: true }, // Filtro
          { 
            codRecHumano: 1, 
            nombreRecHumano: 1, 
            apePatRecHumano: 1, 
            apeMatRecHumano: 1, 
            profesionSolicitante: 1,
            especialidadesRecurso: 1
          } // Solo los campos necesarios
      ).limit(limite).lean();

      res.status(200).json({
          ok: true,
          recHumanos
      });

  } catch (error) {
      console.error('Error al obtener los solicitantes:', error);
      res.status(500).json({
          ok: false,
          msg: "Error al obtener los solicitantes"
      });
  }
};

const encontrarTermino = async(req, res = response) => {
    
  const termino = req.query.search;
  console.log('TERMINO DE BUSQUEDA '+ termino)

  try {

      const recHumanos = await RecurHumano.find({
        //nroDoc: { $regex: termino, $options: 'i'}
        
        $or: [
          { nombreRecHumano: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "nombre"
          { apePatRecHumano: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido paterno"
          { apeMatRecHumano: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido materno"
          { nroDoc: { $regex: termino, $options: 'i' } }// Búsqueda en el campo "nro documento"
          // Agrega más campos si es necesario
        ]
      });
      return res.json({
          ok: true,
          recHumanos //! favoritos: favoritos
      })

  } catch (error) {
      console.log(error);
      return res.status(500).json({
          ok: false,
          msg: 'Error en la consulta'
      })
  }
}

const encontrarTerminoSolicitante = async(req, res = response) => {
    
  const termino = req.query.search;
  console.log('TERMINO DE BUSQUEDA '+ termino)

  if (!termino || termino.trim() === "") {
    return res.status(400).json({
        ok: false,
        msg: "Debe proporcionar un término de búsqueda válido"
    });
  }

  try {

      const regex = new RegExp(termino, 'i');
      const palabras = termino.trim().split(/\s+/); // 🔹 Divide el término en palabras

      const recHumanos = await RecurHumano.find(
        { $and: [
          {esSolicitante: true} ,
          {$or: [
            { codRecHumano: regex},
            { nombreRecHumano: regex},// Búsqueda en el campo "nombre"
            { apePatRecHumano: regex},// Búsqueda en el campo "apellido paterno"
            { apeMatRecHumano: regex},// Búsqueda en el campo "apellido materno"
            { 'profesionSolicitante.nroColegiatura': regex},// Búsqueda en el campo "nro documento"
            { $expr: { $regexMatch: { input: { $concat: ["$nombreRecHumano", " ", "$apePatRecHumano", " ", "$apeMatRecHumano"] }, regex: regex } } },
            { $expr: { $regexMatch: { input: { $concat: ["$apePatRecHumano", " ", "$apeMatRecHumano", " ", "$nombreRecHumano"] }, regex: regex } } },
            // Agrega más campos si es necesario
            // 🔹 Buscar si todas las palabras aparecen en diferentes campos
            ...palabras.map(palabra => ({
              $or: [
                { nombreRecHumano: { $regex: palabra, $options: 'i' } },
                { apePatRecHumano: { $regex: palabra, $options: 'i' } },
                { apeMatRecHumano: { $regex: palabra, $options: 'i' } }
              ]
              }))
            ]}
          ]
        }, // Filtro
        { 
          codRecHumano: 1, 
          nombreRecHumano: 1, 
          apePatRecHumano: 1, 
          apeMatRecHumano: 1, 
          profesionSolicitante: 1,
          especialidadesRecurso: 1
        }, // Solo los campos necesarios
      ).lean();

    return res.json({
        ok: true,
        recHumanos //! favoritos: favoritos
    })

  } catch (error) {
      console.log(error);
      return res.status(500).json({
          ok: false,
          msg: 'Error en la consulta'
      })
  }
}


const actualizarRecursoHumano = async (req, res = response) => {
  
  const codigo = req.params.codRecHumano; //recupera la hc
  const datosActualizados = req.body; //recupera los datos a grabar
  delete datosActualizados._id; //quita los _id generados por el mongo y que no se pueden modificar
  delete datosActualizados.phones._id;
  delete datosActualizados.profesionesRecurso._id;
  delete datosActualizados.especialidadesRecurso._id;
  if (datosActualizados.profesionSolicitante) {
    delete datosActualizados.profesionSolicitante._id;
  }

  try {
    console.log(req.params.codRecHumano);
    console.log('Datos recibidos:', req.body);

    //Hashear la contraseña mediante un hash
    //const numAletorio = bcrypt.genSaltSync();
    //dbPaciente.password = bcrypt.hashSync(password, numAletorio);

    //Generar el JWT
    //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
    //Crear usuario de base de datos

    const recHumano = await RecurHumano.findOneAndUpdate({codRecHumano:codigo},datosActualizados);
    console.log(recHumano)

    if (!recHumano) {
      return res.status(404).json({
        ok: false,
        msg: 'Recurso humano no encontrado con ese código'
      });
    }
        
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      //uid: dbPaciente.id,
      //token: token,
    });
  } catch (error) {
    console.error("Error al actualizar el recurso: ", error)
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};


module.exports = {
    crearRecursoHumano,
    mostrarUltimosRecurHumanos,
    encontrarTermino,
    actualizarRecursoHumano,
    obtenerSolicitantes,
    encontrarTerminoSolicitante
  }