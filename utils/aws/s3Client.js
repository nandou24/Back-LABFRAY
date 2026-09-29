const { S3Client } = require("@aws-sdk/client-s3");

// ====== Validar región AWS ======

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;

if (!region) {
  throw new Error("No se ha configurado AWS_REGION para el cliente S3");
}

// ====== Cliente S3 ======

const s3Client = new S3Client({
  region,
});

module.exports = {
  s3Client,
};
