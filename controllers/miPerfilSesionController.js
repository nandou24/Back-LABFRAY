const RecursoHumano = require('../models/Mantenimiento/RecHumano');
const { generarUrlTemporal } = require('../utils/aws/s3Storage');

// ====== Consultar exclusivamente el perfil vinculado al JWT validado ======
const obtenerMiPerfilSesion = async (req, res) => {
  try {
    const codigo = req.user?.uid;
    if (!codigo) return res.status(401).json({ ok: false, msg: 'Sesión no identificada' });
    const usuario = await RecursoHumano.findOne({ codRecHumano: codigo })
      .select('codRecHumano nombreRecHumano apePatRecHumano apeMatRecHumano ' +
        'datosLogueo.nombreUsuario fotoPerfil.mimeType +fotoPerfil.key +fotoPerfil.versionId')
      .lean();
    if (!usuario) return res.status(404).json({ ok: false, msg: 'Trabajador no encontrado' });

    const nombreCompleto = [usuario.apePatRecHumano, usuario.apeMatRecHumano,
      usuario.nombreRecHumano].filter(Boolean).join(' ').trim();
    let fotoUrl = null;
    if (usuario.fotoPerfil?.key) {
      try {
        fotoUrl = await generarUrlTemporal(usuario.fotoPerfil.key, 300,
          usuario.fotoPerfil.versionId || undefined);
      } catch (error) {
        console.warn('Fotografía de sesión no disponible:', error?.message);
      }
    }
    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      codRecHumano: usuario.codRecHumano,
      nombreUsuario: usuario.datosLogueo?.nombreUsuario || req.user.nombreUsuario,
      nombreCompleto,
      fotoUrl,
    });
  } catch (error) {
    console.error('Error consultando identidad de sesión:', error?.message);
    return res.status(500).json({ ok: false, msg: 'No se pudo consultar el perfil' });
  }
};

module.exports = { obtenerMiPerfilSesion };
