const { response } = require("express");
const Paciente = require("../models/Paciente");
const bcrypt = require('bcryptjs');
const { generarJWT } = require('../helpers/jwt');
const jwt = require("jsonwebtoken");

const crearPaciente = async (req, res = response) => {
    // console.log(req.body)
    //const { name, email, password, rol } = req.body;
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

      //Crear usuario con el modelo
      const dbPaciente = new Paciente(req.body); //name, email, password
      console.log('Preparando datos')
      //Hashear la contraseña mediante un hash
      //const numAletorio = bcrypt.genSaltSync();
      //dbPaciente.password = bcrypt.hashSync(password, numAletorio);
  
      //Generar el JWT
      //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
      //Crear usuario de base de datos
      await dbPaciente.save();
      // console.log(dbUser, "pasoo registro");
      //Generar respuesta exitosa
      return res.status(201).json({
        ok: true,
        uid: dbPaciente.id,
        //token: token,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        msg: "Error al momento de registrar",
      });
    }
  };


module.exports = {
    crearPaciente
  }