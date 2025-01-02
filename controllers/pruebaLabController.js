const { response } = require("express");
const PruebaLab = require("../models/PruebaLab");
const bcrypt = require('bcryptjs');
const { generarJWT } = require('../helpers/jwt');
const jwt = require("jsonwebtoken");

const crearPruebaLab = async (req, res = response) => {

    //debemos generar un número de historia clínica año-mes-correlativo-inicial de ape pater - inicial ape mat
    const { 
        areaLab, 
        nombrePruebaLab, 
        condPreAnalitPaciente, 
        condPreAnalitRefer,
        metodoPruebaLab,
        tipoMuestra,
        tipoTuboEnvase,
        tiempoEntrega,
        precioPrueba,
        observPruebas,
        estadoPrueba,
        compuestaPrueba,
        tipoResultado,
        valorRefCuali,
        valorRefCuantiLimInf,
        valorRefCuantiLimSup,
        unidadesRef,
        otrosValoresRef

        } = req.body;
    
  
    try {
      //   console.log(name, email, password, rol, "holaaa");
  
      // verificar si el nombre existe
      const pruebaLab = await PruebaLab.findOne({ nombrePruebaLab });
  
      if (pruebaLab) {
        return res.status(400).json({
          ok: false,
          msg: "Ya existe una prueba con ese nombre",
        });
      }
      
      console.log('Datos recibidos:', req.body);
 
      //Generar el JWT
      //const token = await generarJWT(dbPaciente.id, dbPaciente.name, dbPaciente.rol);
      //Crear usuario de base de datos

      //creando codigo prueba
      
      // Buscar el última prueba creada en el área
      const ultimoPrueba = await PruebaLab.findOne({
         where: { areaLab },
         order: [['codPruebaLab', 'DESC']],
        });
      console.log(ultimoPrueba + 'aquíi')
      
      // Obtener el correlativo
      let correlativo = 1;
      if (ultimoPrueba) {
        const ultimoCorrelativo = parseInt(ultimoPrueba.codPruebaLab.slice(2, 6));
        correlativo = ultimoCorrelativo + 1;
      }

      if (correlativo > 9999) {
        return res.status(400).json({
          ok: false,
          msg: "El número máximo de pruebas ha sido alcanzado para este área.",
        });
      }

      // Correlativo con seis dígitos, maximo 9999
      const correlativoStr = correlativo.toString().padStart(4, '0');
      console.log(correlativoStr+' correlativo')

      // Crear el número de código
      const codigoLab = `${areaLab}${correlativoStr}`;

      // Crear la prueba con el código
      const nuevaPruebaLab = new PruebaLab({
        ...req.body,
        codPruebaLab: codigoLab, // Agregar el código de la prueba generado
      });

      console.log("Datos a grabar"+nuevaPruebaLab)

      await nuevaPruebaLab.save();
      // console.log(dbUser, "pasoo registro");
      //Generar respuesta exitosa
      return res.status(201).json({
        ok: true,
        uid: nuevaPruebaLab.id,
        //token: token,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        msg: "Error al momento de registrar",
      });
    }
  };

  const mostrarUltimasPruebas = async(req, res = response) => {
    
    try {

        const pruebasLab = await PruebaLab.find()
          //.sort({createdAt: -1})
          .limit(30);

        return res.json({
            ok: true,
            pruebasLab
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

  try {

      const pruebasLab = await PruebaLab.find({
        //nroDoc: { $regex: termino, $options: 'i'}
        
        $or: [
          { nombreCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "nombre"
          { apePatCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido paterno"
          { apeMatCliente: { $regex: termino, $options: 'i' } },// Búsqueda en el campo "apellido materno"
          { nroDoc: { $regex: termino, $options: 'i' } }// Búsqueda en el campo "nro documento"
          // Agrega más campos si es necesario
        ]
      });
      return res.json({
          ok: true,
          pruebasLab //! favoritos: favoritos
      })

  } catch (error) {
      console.log(error);
      return res.status(500).json({
          ok: false,
          msg: 'Error en la consulta'
      })
  }
}

const actualizarPrueba = async (req, res = response) => {
  
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

    const pruebaLab = await PruebaLab.findOneAndUpdate({hc:idNroHC},datosActualizados);

    if (!pruebaLab) {
      return res.status(404).json({
        ok: false,
        msg: 'Prueba no encontrado con ese número de historia'
      });
    }

        
    //Generar respuesta exitosa
    return res.status(201).json({
      ok: true,
      //uid: dbPaciente.id,
      //token: token,
    });
  } catch (error) {
    console.error("Error al actualizar la prueba: ", error)
    return res.status(500).json({
      ok: false,
      msg: "Error al momento de actualizar back end",
    });
  }
};


module.exports = {
    crearPruebaLab,
    mostrarUltimasPruebas,
    encontrarTermino,
    actualizarPrueba
  }