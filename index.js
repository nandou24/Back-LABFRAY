const express = require("express"); //! EXPRESS(framework de NodeJs) => SENCILLA MODELO VISTA CONTROLADOR
const cors = require("cors"); //! Validación de origen de solicitudes
const path = require("path");
const { dbConexion } = require("./db/config");
//! import => ES6 modules
//! require => CommonJs

//Es para que tome la configuracion por defecto y lee el archivo de .env
require("dotenv").config(); //! lee el archivo .env

//Crear servidor/aplicacion de express
const app = express(); //! Nodejs Framework -> MVC

//Base de datos
dbConexion(); //! Conexion a la base de datos

//DIRECTORIO PUBLICO
app.use(express.static("public")); //! La carpeta public se use como default para recursos estaticos

//CORS
// localhost:4200
constObject = {
  origin: "http://localhost:4200",
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 20
};

app.use(
  // cors(constObject)
  cors()
  //! DOMINIO: .restaurantx.com
); //! Use cors, y se pueden filtrar origenes de peticiones

//Lectura del Body
app.use(express.json()); //! Puedo leer archivos JSON

// Ruta de healthcheck para Railway
app.get("/", (req, res) => {
  res.status(200).json({
    message: "API de LabFray funcionando correctamente",
    status: "OK",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    service: "back-labfray",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

//USE ES UN MIDDLEWARE: Un middleware no es más que una función
//que se ejecuta cuando el intérprete pase evaluando cada una de las líneas de código.

//RUTAS DE LAS PETICIONES: GET, POST, PUT
//! Usuario
//! Familia de rutas
app.use("/api/auth", require("./routes/authRoute"));

//! Paciente
app.use("/api/paciente", require("./routes/Mantenimiento/pacienteRoute"));

//! Prueba Lab
app.use("/api/pruebaLab", require("./routes/Mantenimiento/pruebaLabRoute"));

//! Item Lab
app.use("/api/itemLab", require("./routes/Mantenimiento/itemLabRoute"));

//! Servicio
app.use("/api/servicio", require("./routes/Mantenimiento/servicioRoute"));

//! Rec Humano
app.use("/api/recursoHumano", require("./routes/Mantenimiento/recHumanoRoute"));

//! Referencia Medico
app.use(
  "/api/referenciaMedico",
  require("./routes/Mantenimiento/refMedicoRoute")
);

//! Cotizacion
app.use("/api/cotizacion", require("./routes/Gestion/cotizacionRoute"));

//! Pago
app.use("/api/pagos", require("./routes/Gestion/pagoRoute"));

//! Rutas
app.use("/api/rutas", require("./routes/Mantenimiento/rutaRoute"));

//! Roles
app.use("/api/roles", require("./routes/Mantenimiento/rolRoute"));

//! Solicitud de Atención
app.use(
  "/api/solicitudAtencion",
  require("./routes/Gestion/solicitudAtencionRoute")
);

//! Profesiones
app.use("/api/profesion", require("./routes/Mantenimiento/profesionRoute"));

//! Especialidades
app.use(
  "/api/especialidad",
  require("./routes/Mantenimiento/especialidadRoute")
);

// app.get("*", (req, res) => {
//   res.sendFile(path.resolve(__dirname, "public/index.html"));
// });

//!Levantar el servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor levantando en el puerto ${PORT}`);
});
