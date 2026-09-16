const multer = require("multer");

// ====== Tipos de imagen permitidos ======

const mimeTypesPermitidos = new Set(["image/jpeg", "image/png", "image/webp"]);

// ====== Almacenamiento temporal en memoria ======

const storage = multer.memoryStorage();

// ====== Validar archivo ======

const fileFilter = (req, file, cb) => {
  if (!mimeTypesPermitidos.has(file.mimetype)) {
    return cb(
      new Error(
        "Formato de imagen no permitido. Solo se admite JPEG, PNG o WebP",
      ),
    );
  }

  cb(null, true);
};

// ====== Configurar carga ======

const uploadEvidenciaMuestra = multer({
  storage,

  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
  },

  fileFilter,
});

// ====== Procesar evidencia ======

const cargarEvidenciaMuestra = (req, res, next) => {
  uploadEvidenciaMuestra.single("imagen")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          ok: false,
          msg: "La imagen no puede superar los 2 MB",
        });
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          ok: false,
          msg: "Solo se permite cargar una imagen por operación",
        });
      }

      return res.status(400).json({
        ok: false,
        msg: error.message || "No se pudo procesar la imagen",
      });
    }

    return res.status(400).json({
      ok: false,
      msg: error.message || "El archivo enviado no es válido",
    });
  });
};

module.exports = {
  cargarEvidenciaMuestra,
};
