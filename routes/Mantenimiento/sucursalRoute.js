const { Router } = require('express');
const multer = require('multer');
const { validarJWT } = require('../../middlewares/validar-token');
const controller = require('../../controllers/Mantenimiento/sucursalController');
const router = Router();

// ====== La autorización de ruta se valida también en API ======
router.use(validarJWT);
router.use((req, res, next) => {
  const permitido = req.user?.rutasPermitidas?.some((r) => r.urlRuta?.toLowerCase() === '/pages/sucursales');
  if (!permitido) return res.status(403).json({ ok: false, msg: 'No tiene permiso para administrar sucursales' });
  next();
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)),
});
const validarUpload = (req, res, next) => {
  upload.single('archivo')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, msg: err.code === 'LIMIT_FILE_SIZE' ? 'Archivo supera 5 MB' : err.message });
    next();
  });
};

router.get('/personal-disponible', controller.personalDisponible);
router.get('/', controller.listarSucursales);
router.get('/:id', controller.obtenerSucursal);
router.post('/', controller.crearSucursal);
router.put('/:id', controller.actualizarSucursal);
router.post('/:id/permisos/:permisoId/archivos', validarUpload, controller.subirArchivoPermiso);
router.get('/:id/permisos/:permisoId/archivos/:archivoId/url', controller.urlArchivoPermiso);
router.delete('/:id/permisos/:permisoId/archivos/:archivoId', controller.retirarArchivoPermiso);

module.exports = router;
