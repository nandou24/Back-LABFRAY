const multer = require('multer');


// ==========================================
// ALMACENAMIENTO EN MEMORIA
// ==========================================

const storage = multer.memoryStorage();


// ==========================================
// TIPOS DE ARCHIVO PERMITIDOS
// ==========================================

const tiposPermitidos = [
    'image/jpeg',
    'image/png',
    'image/webp'
];


// ==========================================
// FILTRO
// ==========================================

const fileFilter = (req, file, cb) => {

    if (!tiposPermitidos.includes(file.mimetype)) {

        return cb(
            new Error(
                'Formato de archivo no permitido. Solo se permiten imágenes JPG, PNG o WEBP.'
            ),
            false
        );

    }

    cb(null, true);
};


// ==========================================
// CONFIGURACIÓN DE MULTER
// ==========================================

const uploadArchivoPaciente = multer({

    storage,

    limits: {
        fileSize: 2 * 1024 * 1024
    },

    fileFilter

});


module.exports = uploadArchivoPaciente;