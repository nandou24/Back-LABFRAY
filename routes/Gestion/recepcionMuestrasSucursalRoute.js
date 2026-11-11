const { Router } = require("express");
const { validarJWT } = require("../../middlewares/validar-token");
const controller = require("../../controllers/Gestion/recepcionMuestrasSucursalController");
const router = Router();

router.use(validarJWT);

// ====== Permiso exclusivo: no concede acceso a Recepción Central ======
router.use((req, res, next) => {
  const autorizado = req.user?.rutasPermitidas?.some(
    (r) =>
      String(r.urlRuta || "").toLowerCase() ===
      "/pages/recepcion-muestras-sucursal",
  );
  if (!autorizado)
    return res
      .status(403)
      .json({
        ok: false,
        msg: "No tiene permiso para recepción de asociados en sucursal",
      });
  next();
});
router.use(controller.contextoSucursal);

router.get("/catalogos", controller.catalogos);
router.get("/catalogos-recipientes", controller.catalogosRecipientes);
router.get("/pacientes", controller.buscarPacientes);
router.get("/pruebas", controller.buscarPruebas);
router.get("/", controller.listar);
router.get("/:id/historial", controller.historial);
router.get("/:id/edicion", controller.edicion);
router.get("/:id", controller.detalle);
router.post("/", controller.crear);
router.put("/:id", controller.actualizar);

module.exports = router;
