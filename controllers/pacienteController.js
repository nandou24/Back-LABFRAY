const { response } = require("express");
const Paciente = require("../models/Paciente");
const bcrypt = require('bcryptjs');
const { generarJWT } = require('../helpers/jwt');
const jwt = require("jsonwebtoken");

const crearPaciente = async (req, res = response) => {

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
        phones
        } = req.body;
    
    //Para crear HC    
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = (fecha.getMonth() + 1).toString().padStart(2, '0');
  
    try {
      //   console.log(name, email, password, rol, "holaaa");
  
      // verificar el email si es que existe
      const paciente = await Paciente.findOne({ tipoDoc, nroDoc });
  
      if (paciente) {
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

      //creando codigo HC
      // Buscar el último paciente creado en el año actual
      const ultimoPaciente = await Paciente.findOne({ hc: new RegExp(`^${anio}${mes}`) }).sort({ hc: -1 });
      console.log(ultimoPaciente + 'aquíi')
      
      // Obtener el correlativo
      let correlativo = 1;
      if (ultimoPaciente) {
        const ultimoCorrelativo = parseInt(ultimoPaciente.hc.slice(7, 13));
        correlativo = ultimoCorrelativo + 1;
      }

      // Correlativo con seis dígitos, maximo 999 999
      const correlativoStr = correlativo.toString().padStart(6, '0');
      console.log(correlativoStr+' correlativo')

      // Generar las iniciales de los apellidos
      const inicialApePat = apePatCliente.charAt(0).toUpperCase();
      console.log(inicialApePat)
      const inicialApeMat = apeMatCliente.charAt(0).toUpperCase();
      console.log(inicialApeMat)

      // Crear el número de historia clínica sin guiones
      const historiaClinica = `${anio}${mes}-${correlativoStr}${inicialApePat}${inicialApeMat}`;

      // Crear el paciente con el número de historia clínica
      // Crear usuario con el modelo
      const nuevoPaciente = new Paciente({
        ...req.body,
        hc: historiaClinica, // Agregar el número de historia clínica generado
      });

      console.log(historiaClinica)
      console.log(nuevoPaciente+"nuevo paciente aquiii")

      await nuevoPaciente.save();
      // console.log(dbUser, "pasoo registro");
      //Generar respuesta exitosa
      return res.status(201).json({
        ok: true,
        uid: nuevoPaciente.id,
        //token: token,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        msg: "Error al momento de registrar",
      });
    }
  };


const mostrarUltimosPacientes = async(req, res = response) => {

    try {
            const cantidad = req.query.cant;
            const limite = parseInt(cantidad);
    
            const pacientes = await Paciente.find()
              .sort({createdAt: -1})
              .limit(limite);
    
            return res.json({
                ok: true,
                pacientes
            })
    
        } catch (error) {
            console.log(error);
            return res.status(500).json({
                ok: false,
                msg: 'Error en la consulta'
            })
        }
}

const mostrarUltimosPacientesCotizacion = async(req, res = response) => {

  try {
          const cantidad = req.query.cant;
          const limite = parseInt(cantidad);
  
          const pacientes = await Paciente.find(
            {}, // Filtro
            { 
              hc: 1, 
              nombreCliente: 1, 
              apePatCliente: 1, 
              apeMatCliente: 1,
              tipoDoc: 1, 
              nroDoc: 1
            } // Solo los campos necesarios
        ).sort({createdAt: -1})
        .limit(limite).lean();
  
          return res.json({
              ok: true,
              pacientes
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
  console.log('TERMINO DE BUSQUEDA '+ termino)

  if (!termino || termino.trim() === "") {
    return res.status(400).json({
        ok: false,
        msg: "Debe proporcionar un término de búsqueda válido"
    });
  }


  try {

      const regex = new RegExp(termino, 'i');
      const pacientes = await Paciente.find({
        //nroDoc: { $regex: termino, $options: 'i'}
        
        $or: [
          { nombreCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "nombre"
          { apePatCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido paterno"
          { apeMatCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido materno"
          { nroDoc: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "nro documento"
          { $expr: { $regexMatch: { input: { $concat: ["$apePatCliente", " ", "$apeMatCliente", " ", "$nombreCliente"] }, regex: regex } } },
          { $expr: { $regexMatch: { input: { $concat: ["$nombreCliente", " ", "$apePatCliente", " ", "$apeMatCliente"] }, regex: regex } } }

          // Agrega más campos si es necesario
        ]
      });
      return res.json({
          ok: true,
          pacientes //! favoritos: favoritos
      })

  } catch (error) {
      console.log(error);
      return res.status(500).json({
          ok: false,
          msg: 'Error en la consulta'
      })
  }
}

const encontrarTerminoCotizaicon = async(req, res = response) => {
    
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
      const pacientes = await Paciente.find({
        //nroDoc: { $regex: termino, $options: 'i'}
        
        $or: [
          { nombreCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "nombre"
          { apePatCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido paterno"
          { apeMatCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido materno"
          { nroDoc: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "nro documento"
          { $expr: { $regexMatch: { input: { $concat: ["$apePatCliente", " ", "$apeMatCliente", " ", "$nombreCliente"] }, regex: regex } } },
          { $expr: { $regexMatch: { input: { $concat: ["$nombreCliente", " ", "$apePatCliente", " ", "$apeMatCliente"] }, regex: regex } } }

          // Agrega más campos si es necesario
          ]
        }, 
        { 
          hc: 1, 
          nombreCliente: 1, 
          apePatCliente: 1, 
          apeMatCliente: 1,
          tipoDoc: 1, 
          nroDoc: 1, 
        }    
      ).lean();
      return res.json({
          ok: true,
          pacientes //! favoritos: favoritos
      })

  } catch (error) {
      console.log(error);
      return res.status(500).json({
          ok: false,
          msg: 'Error en la consulta'
      })
  }
}



const actualizarPaciente = async (req, res = response) => {
  
  const idNroHC = req.params.nroHC; //recupera la hc
  const datosActualizados = req.body; //recupera los datos a grabar
  delete datosActualizados._id; //quita los _id generados por el mongo y que no se pueden modificar
  delete datosActualizados.phones._id;

  try {
    console.log(req.params.nroHC);
    console.log('Datos recibidos:', req.body);

    //Hashear la contraseña mediante un hash
    //const numAletorio = bcrypt.genSaltSync();
    //dbPaciente.password = bcrypt.hashSync(password, numAletorio);

    //Generar el JWT
    //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
    //Crear usuario de base de datos

    const paciente = await Paciente.findOneAndUpdate({hc:idNroHC},datosActualizados);

    if (!paciente) {
      return res.status(404).json({
        ok: false,
        msg: 'Paciente no encontrado con ese número de historia'
      });
    }

        
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      //uid: dbPaciente.id,
      //token: token,
    });
  } catch (error) {
    console.error("Error al actualizar el paciente: ", error)
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};


module.exports = {
    crearPaciente,
    mostrarUltimosPacientes,
    encontrarTermino,
    actualizarPaciente,
    encontrarTerminoCotizaicon,
    mostrarUltimosPacientesCotizacion
  }