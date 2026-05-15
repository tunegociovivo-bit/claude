/**
 * Cliente de almacenamiento S3-compatible (Cloudflare R2 / AWS S3 / MinIO).
 *
 * Configuración via env vars (todas obligatorias para que esté habilitado):
 *   STORAGE_ENDPOINT      → ej. https://<account_id>.r2.cloudflarestorage.com (R2)
 *                              o https://s3.amazonaws.com (S3 clásico)
 *                              o http://minio:9000 (self-hosted)
 *   STORAGE_REGION        → "auto" para R2, "us-east-1" para S3, "us-east-1" para MinIO
 *   STORAGE_ACCESS_KEY_ID
 *   STORAGE_SECRET_ACCESS_KEY
 *   STORAGE_BUCKET        → nombre del bucket
 *   STORAGE_PUBLIC_URL    → (opcional) base URL pública del bucket si se sirve
 *                              directo (R2 con custom domain, S3 público).
 *                              Si no, generamos URLs firmadas temporales.
 *
 * Sin estas variables, isStorageEnabled() devuelve false y los endpoints de
 * subida responden 503 ai_disabled-style. La app sigue funcionando sin adjuntos.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function isStorageEnabled(): boolean {
  return Boolean(
    process.env.STORAGE_ENDPOINT &&
      process.env.STORAGE_ACCESS_KEY_ID &&
      process.env.STORAGE_SECRET_ACCESS_KEY &&
      process.env.STORAGE_BUCKET
  );
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  if (!isStorageEnabled()) throw new Error("Storage no configurado");
  _client = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? "auto",
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!
    },
    // Necesario para MinIO y para R2 con paths style
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true"
  });
  return _client;
}

function bucket(): string {
  return process.env.STORAGE_BUCKET!;
}

/**
 * URL firmada para subir un objeto. Expira en 5 min.
 * El cliente hace PUT directo a esta URL con el binary del archivo.
 */
export async function signedUploadUrl(s3Key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: s3Key,
    ContentType: contentType
  });
  return getSignedUrl(client(), cmd, { expiresIn: 300 });
}

/**
 * URL firmada de descarga (GET). Expira en 1 hora.
 * Si STORAGE_PUBLIC_URL está definido, devolvemos URL pública directa.
 */
export async function signedDownloadUrl(s3Key: string): Promise<string> {
  if (process.env.STORAGE_PUBLIC_URL) {
    const base = process.env.STORAGE_PUBLIC_URL.replace(/\/+$/, "");
    return `${base}/${s3Key}`;
  }
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: s3Key
  });
  return getSignedUrl(client(), cmd, { expiresIn: 3600 });
}

export async function deleteObject(s3Key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: s3Key }));
}

/**
 * Genera una key S3 razonable: workspace/target/uuid-filename.
 */
export function buildS3Key(opts: {
  workspaceId: string;
  targetType?: string | null;
  targetId?: string | null;
  filename: string;
}): string {
  const safeName = opts.filename
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const folder =
    opts.targetType && opts.targetId
      ? `${opts.targetType.toLowerCase()}/${opts.targetId}`
      : "uploads";
  return `${opts.workspaceId}/${folder}/${uniq}-${safeName}`;
}
