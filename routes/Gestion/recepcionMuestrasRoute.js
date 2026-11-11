const { Router } = require('express');
const { validarJWT } = require('../../middlewares/validar-token');
const controller = require('../../controllers/Gestion/recepcionMuestrasController');
const router = Router();

router.use(validarJWT);

// ====== Acceso ligado a la ruta del módulo, no al mantenimiento de maestros ======
router.use((req, res, next) => {
  const autorizado = req.user?.rutasPermitidas?.some(
    ruta => String(ruta.urlRuta || '').toLowerCase() === '/pages/recepcion-muestras-central',
  );
  if (!autorizado) return res.status(403).json({ ok: false, msg: 'No tiene permiso para recepción de muestras en Central' });
  next();
});

router.get('/catalogos', controller.obtenerCatalogos);
router.get('/catalogos-recipientes', controller.catalogosRecipientes);
router.get('/pacientes', controller.buscarPacientes);
router.get('/pruebas', controller.buscarPruebas);
router.get('/muestras', controller.buscarMuestras);
router.get('/', controller.listarRecepciones);
router.get('/:id', controller.obtenerRecepcion);
router.post('/contingencia', controller.crearContingencia);
router.get('/:id/edicion', controller.obtenerBorradorCentral);
router.put('/:id', controller.actualizarContingencia);
router.post('/:id/recepcion', controller.confirmarRecepcion);

module.exports = router;
