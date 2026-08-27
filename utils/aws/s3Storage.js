const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { randomUUID } = require("crypto");

const { s3Client } = require("./s3Client");

const bucket = process.env.AWS_S3_BUCKET;

// ==========================================
// SUBIR ARCHIVO
// ==========================================

const subirArchivo = async ({ pacienteId, categoriaStorage, buffer, mimeType }) => {
  const extension = obtenerExtension(mimeType);

  const archivoId = randomUUID();

  const key = `pacientes/${pacienteId}/${categoriaStorage}/${archivoId}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  const respuesta = await s3Client.send(command);

  return {
    key,
    versionId: respuesta.VersionId,
    etag: respuesta.ETag,
  };
};

// ==========================================
// URL TEMPORAL PARA VISUALIZAR
// ==========================================

const generarUrlTemporal = async (key, expiresIn = 300) => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, {
    expiresIn,
  });
};

// ==========================================
// ELIMINAR ARCHIVO
// ==========================================

const eliminarArchivo = async (key, versionId = undefined) => {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,

    ...(versionId && {
      VersionId: versionId,
    }),
  });

  return await s3Client.send(command);
};

// ==========================================
// UTIL
// ==========================================

const obtenerExtension = (mimeType) => {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";

    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    default:
      return "bin";
  }
};

module.exports = {
  subirArchivo,
  generarUrlTemporal,
  eliminarArchivo,
};
