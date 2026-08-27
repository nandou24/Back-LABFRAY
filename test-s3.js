require('dotenv').config();

const {
    subirArchivo,
    eliminarArchivo
} = require('./utils/aws/s3Storage');


const probarEliminacionVersion = async () => {

    try {

        // ==========================================
        // 1. SUBIR ARCHIVO
        // ==========================================

        const archivo = await subirArchivo({

            pacienteId: 'prueba',

            tipoArchivo: 'rollback',

            buffer: Buffer.from(
                'Prueba de eliminacion por VersionId'
            ),

            mimeType: 'image/jpeg'

        });


        console.log(
            'Archivo subido correctamente:'
        );

        console.log(archivo);


        // ==========================================
        // 2. ELIMINAR ESA VERSIÓN EXACTA
        // ==========================================

        const respuestaEliminar =
            await eliminarArchivo(
                archivo.key,
                archivo.versionId
            );


        console.log(
            'Versión eliminada correctamente:'
        );

        console.log(respuestaEliminar);


    } catch (error) {

        console.error(
            'Error durante la prueba:',
            error
        );

    }

};


probarEliminacionVersion();