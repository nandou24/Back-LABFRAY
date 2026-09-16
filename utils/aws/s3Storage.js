const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { randomUUID } = require("crypto");

const { s3Client } = require("./s3Client");

const bucket = process.env.AWS_S3_BUCKET;

// ====== Subir archivo ======

const subirArchivo = async ({
  pacienteId,
  categoriaStorage,
  buffer,
  mimeType,
}) => {
  const extension = obtenerExtension(mimeType);

  const archivoId = randomUUID();

  const key =
    `pacientes/${pacienteId}/` +
    `${categoriaStorage}/` +
    `${archivoId}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  const respuesta = await s3Client.send(command);

  return {
    archivoId,
    key,
    versionId: respuesta.VersionId ?? null,
    etag: respuesta.ETag ?? null,
  };
};

// ====== Subir archivo con prefijo genérico ======

const subirArchivoStorage = async ({ keyPrefix, buffer, mimeType }) => {
  if (typeof keyPrefix !== "string" || !keyPrefix.trim()) {
    throw new Error("Debe indicar un prefijo de almacenamiento válido");
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("El archivo a almacenar no es válido");
  }

  if (typeof mimeType !== "string" || !mimeType.trim()) {
    throw new Error("Debe indicar el tipo MIME del archivo");
  }

  const prefixNormalizado = keyPrefix.trim().replace(/^\/+|\/+$/g, "");

  const extension = obtenerExtension(mimeType);

  const archivoId = randomUUID();

  const key = `${prefixNormalizado}/` + `${archivoId}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  const respuesta = await s3Client.send(command);

  return {
    archivoId,
    key,
    versionId: respuesta.VersionId ?? null,
    etag: respuesta.ETag ?? null,
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
  subirArchivoStorage,
  generarUrlTemporal,
  eliminarArchivo,
};
