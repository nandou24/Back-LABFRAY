const multer = require("multer");

const storage = multer.memoryStorage();
const LIMITE_PDF_BYTES = 10 * 1024 * 1024;

// ====== Validar PDF de informe ======
const uploadInformeDespacho = multer({
  storage,
  limits: {
    fileSize: LIMITE_PDF_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Solo se admite el informe en formato PDF"));
    }

    cb(null, true);
  },
});

const cargarInformeDespacho = (req, res, next) => {
  uploadInformeDespacho.single("informePdf")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          ok: false,
          msg: "El informe PDF no puede superar los 10 MB",
        });
      }

      return res.status(400).json({
        ok: false,
        msg: error.message || "No se pudo procesar el informe PDF",
      });
    }

    return res.status(400).json({
      ok: false,
      msg: error.message || "El informe PDF no es válido",
    });
  });
};

module.exports = {
  cargarInformeDespacho,
};
