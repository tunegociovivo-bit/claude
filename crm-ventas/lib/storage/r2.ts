/**
 * Almacenamiento de archivos de los módulos de contenidos (imágenes y vídeos
 * generados, referencias visuales, logos).
 *
 * Dos modos, mismas funciones:
 *  · S3/R2 (recomendado en producción) si están definidas STORAGE_ENDPOINT,
 *    STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY y STORAGE_BUCKET
 *    (opcional STORAGE_REGION, STORAGE_PUBLIC_URL, STORAGE_FORCE_PATH_STYLE).
 *    Son las mismas variables que usa el Hub.
 *  · Base de datos (por defecto): el archivo se guarda en StoredFile y se sirve
 *    desde /api/files/<key> con URL firmada (HMAC + caducidad). Así el módulo
 *    funciona sin configurar nada y las URLs son públicas para Meta/WordPress.
 */
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";

export const FILES_ROUTE = "/api/files/";
const DB_MAX_BYTES = 60 * 1024 * 1024;

export function isS3Enabled(): boolean {
  return Boolean(
    process.env.STORAGE_ENDPOINT &&
      process.env.STORAGE_ACCESS_KEY_ID &&
      process.env.STORAGE_SECRET_ACCESS_KEY &&
      process.env.STORAGE_BUCKET
  );
}

/** Siempre hay almacenamiento: S3/R2 si está configurado, si no la base de datos. */
export function isStorageEnabled(): boolean {
  return true;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? "auto",
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
  });
  return _client;
}

function bucket(): string {
  return process.env.STORAGE_BUCKET!;
}

export function appBaseUrl(): string {
  const raw = process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "";
  return raw.replace(/\/+$/, "");
}

function signingKey(): string {
  const secret = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Falta ENCRYPTION_KEY para firmar URLs de archivos");
  return secret;
}

export function fileSignature(key: string, exp: number): string {
  return crypto.createHmac("sha256", signingKey()).update(`file:${key}:${exp}`).digest("base64url").slice(0, 43);
}

export function verifyFileSignature(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(fileSignature(key, exp));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** URL firmada de un archivo guardado en BD (válida `expiresIn` segundos). */
export function dbFileUrl(s3Key: string, expiresIn = 3600): string {
  // Redondeo a la hora: la misma imagen pedida varias veces produce la misma URL
  // (cacheable por el navegador) sin acortar la validez pedida.
  const exp = Math.ceil((Date.now() / 1000 + expiresIn) / 3600) * 3600;
  return `${appBaseUrl()}${FILES_ROUTE}${encodeKeyPath(s3Key)}?e=${exp}&s=${fileSignature(s3Key, exp)}`;
}

/** Si la URL apunta a /api/files de esta app (relativa o con nuestro host), devuelve la key. */
export function keyFromFileUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "http://local.invalid");
    if (/^https?:\/\//i.test(url)) {
      const own = appBaseUrl();
      if (!own || parsed.host !== new URL(own).host) return null;
    }
    if (!parsed.pathname.startsWith(FILES_ROUTE)) return null;
    const rest = parsed.pathname.slice(FILES_ROUTE.length);
    const key = rest.split("/").map(decodeURIComponent).join("/");
    return key || null;
  } catch {
    return null;
  }
}

export async function signedDownloadUrl(s3Key: string, expiresIn = 3600): Promise<string> {
  if (!isS3Enabled()) return dbFileUrl(s3Key, expiresIn);
  if (process.env.STORAGE_PUBLIC_URL) {
    return `${process.env.STORAGE_PUBLIC_URL.replace(/\/+$/, "")}/${s3Key}`;
  }
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: s3Key }), { expiresIn });
}

export async function deleteObject(s3Key: string): Promise<void> {
  await prisma.storedFile.deleteMany({ where: { key: s3Key } });
  if (isS3Enabled()) await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: s3Key }));
}

export async function uploadBuffer(opts: { s3Key: string; body: Uint8Array | Buffer; contentType: string }): Promise<void> {
  if (isS3Enabled()) {
    await client().send(new PutObjectCommand({ Bucket: bucket(), Key: opts.s3Key, Body: opts.body, ContentType: opts.contentType }));
    return;
  }
  const data = Buffer.from(opts.body);
  if (data.length > DB_MAX_BYTES) {
    throw new Error("Archivo demasiado grande para guardarlo sin bucket (máx. 60 MB). Configura STORAGE_* (R2/S3).");
  }
  const workspaceId = opts.s3Key.split("/")[0] || null;
  await prisma.storedFile.upsert({
    where: { key: opts.s3Key },
    create: { key: opts.s3Key, workspaceId, contentType: opts.contentType, size: data.length, data },
    update: { contentType: opts.contentType, size: data.length, data },
  });
}

export async function downloadBuffer(s3Key: string): Promise<Buffer> {
  const stored = await prisma.storedFile.findUnique({ where: { key: s3Key }, select: { data: true } });
  if (stored) return Buffer.from(stored.data);
  if (!isS3Enabled()) throw new Error(`Archivo no encontrado: ${s3Key}`);
  const resp = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: s3Key }));
  if (!resp.Body) throw new Error(`Body vacío al descargar ${s3Key}`);
  const chunks: Buffer[] = [];
  // @ts-expect-error AsyncIterable en Node 18+
  for await (const chunk of resp.Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Lee un archivo propio a partir de su URL (sin pasar por HTTP). */
export async function readOwnFile(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const key = keyFromFileUrl(url);
  if (!key) return null;
  const stored = await prisma.storedFile.findUnique({ where: { key }, select: { data: true, contentType: true } });
  if (!stored) return null;
  return { buffer: Buffer.from(stored.data), contentType: stored.contentType };
}

export function buildS3Key(opts: { workspaceId: string; targetType?: string | null; targetId?: string | null; filename: string }): string {
  const safeName = opts.filename.replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const folder = opts.targetType && opts.targetId ? `${opts.targetType.toLowerCase()}/${opts.targetId}` : "uploads";
  return `${opts.workspaceId}/${folder}/${uniq}-${safeName}`;
}
