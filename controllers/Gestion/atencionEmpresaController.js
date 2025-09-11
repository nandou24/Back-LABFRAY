const { response } = require("express");
const { AtencionEmpresa } = require("../../models/Gestion/atencionEmpresa").AtencionEmpresaModel;


// Registrar una nueva atención de empresa
const crearAtencionEmpresa = async (req, res = response) => {
	try {
		const datos = req.body;
		// Aquí podrías agregar validaciones según tus necesidades

        // Generación de código correlativo para empresa
    const anioActual = new Date().getFullYear();
    const ultimaAtencion = await AtencionEmpresa.findOne({
      codAtencion: new RegExp(`^AE-${anioActual}-`),
    })
      .sort({ codAtencion: -1 })
      .lean();

    // Obtener el correlativo
    let correlativo = 1;
    if (ultimaAtencion) {
      const ultimoCodigo = ultimaAtencion.codAtencion;
      const ultimoNumero = parseInt(ultimoCodigo.split("-")[2], 10);
      correlativo = ultimoNumero + 1;
    }

    if (correlativo > 999) {
      return res.status(400).json({
        ok: false,
        msg: "El número máximo de atenciones empresariales ha sido alcanzado para este año.",
      });
    }

    //Crear el nuevo código (Ejemplo: AE-2024-0001)
    const nuevoCodigo = `AE-${anioActual}-${String(correlativo).padStart(
      3,
      "0"
    )}`;

    // Crear el documento
    const nuevaAtencion = new AtencionEmpresa({
      ...datos,
      codAtencion: nuevoCodigo, // Agregar el código de la atención generado
      estado: 'BORRADOR', // Estado inicial
    });

		await nuevaAtencion.save();
		res.status(201).json({
			message: "Atención de empresa registrada correctamente",
			atencion: nuevaAtencion,
		});
	} catch (error) {
		console.error("Error al registrar atención de empresa:", error);
		res.status(500).json({ message: "Error interno del servidor" });
	}
};

module.exports = {
	crearAtencionEmpresa,
};
