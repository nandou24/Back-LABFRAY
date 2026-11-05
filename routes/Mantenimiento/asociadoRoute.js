const { Router } = require('express');
const { validarJWT } = require('../../middlewares/validar-token');
const controller = require('../../controllers/Mantenimiento/asociadoController');
const router = Router();

// ====== Permiso de mantenimiento de asociados ======
router.use(validarJWT);
router.use((req, res, next) => {
  const autorizado = req.user?.rutasPermitidas?.some(r => r.urlRuta?.toLowerCase() === '/pages/asociados');
  if (!autorizado) return res.status(403).json({ ok: false, msg: 'No tiene permiso para gestionar asociados' });
  next();
});

router.get('/catalogo-servicios', controller.catalogoServicios);
router.get('/', controller.listar);
router.get('/:id', controller.obtener);
router.post('/', controller.crear);
router.put('/:id', controller.actualizar);

module.exports = router;
