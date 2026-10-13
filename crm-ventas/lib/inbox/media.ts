import "server-only";
import { prisma } from "@/lib/prisma";
import { getWahaConfig } from "@/lib/waha";
import { buildS3Key, isS3Enabled, uploadBuffer } from "@/lib/storage/r2";
import { extensionFor, wahaFilePath, type ExtractedMedia, type StoredMedia } from "@/lib/inbox/media-core";

// Con bucket (R2/S3) se guardan archivos de hasta 30 MB; sin bucket van a la
// base de datos y el tope es menor para no inflarla (vídeos largos → móvil).
export const MAX_MEDIA_BYTES = 30 * 1024 * 1024;
export const MAX_MEDIA_BYTES_DB = 16 * 1024 * 1024;
export function mediaByteLimit() {
  return isS3Enabled() ? MAX_MEDIA_BYTES : MAX_MEDIA_BYTES_DB;
}
const THUMB_MAX_PX = 480;

class MediaDownloadError extends Error {
  constructor(message: string, public readonly transient: boolean) {
    super(message);
  }
}

async function readLimited(res: Response, limit: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    throw new MediaDownloadError(`Archivo demasiado grande (${(declared / 1048576).toFixed(1)} MB): ábrelo en el móvil`, false);
  }
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new MediaDownloadError(`Archivo demasiado grande (más de ${Math.round(limit / 1048576)} MB): ábrelo en el móvil`, false);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function downloadFromWaha(workspaceId: string, session: string, path: string): Promise<{ data: Buffer; contentType: string }> {
  const cfg = await getWahaConfig(workspaceId, session);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      headers: cfg.apiKey ? { "X-Api-Key": cfg.apiKey } : {},
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new MediaDownloadError(`WAHA no respondió al descargar el archivo: ${(error as Error).message}`, true);
  }
  if (!res.ok) {
    throw new MediaDownloadError(`WAHA devolvió ${res.status} al descargar el archivo`, res.status >= 500 || res.status === 429);
  }
  const data = await readLimited(res, mediaByteLimit());
  if (!data.length) throw new MediaDownloadError("WAHA devolvió un archivo vacío", true);
  return { data, contentType: res.headers.get("content-type") ?? "" };
}

async function makeThumbnail(data: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(data, { failOn: "none", limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
  } catch {
    return null;
  }
}

// Descarga el archivo de WAHA (los guarda poco tiempo) y lo copia al
// almacenamiento del CRM. Nunca lanza: si falla, el mensaje se guarda igual con
// el motivo, para no perder nunca el mensaje del cliente.
export async function storeWhatsappMedia(opts: {
  workspaceId: string;
  lineId: string;
  session: string;
  media: ExtractedMedia;
}): Promise<StoredMedia> {
  const { media } = opts;
  const base: StoredMedia = {
    kind: media.kind,
    mimetype: media.mimetype,
    filename: media.filename,
    caption: media.caption,
    size: null,
    key: null,
    thumbKey: null,
    error: null,
  };
  const path = wahaFilePath(media.url, opts.session);
  if (!path) {
    return {
      ...base,
      error:
        media.error ??
        "WhatsApp no ha entregado el archivo al CRM (revisa que WAHA tenga activada la descarga de multimedia). Ábrelo en el móvil.",
    };
  }
  let downloaded: { data: Buffer; contentType: string } | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !downloaded; attempt++) {
    try {
      downloaded = await downloadFromWaha(opts.workspaceId, opts.session, path);
    } catch (error) {
      lastError = (error as Error).message;
      if (!(error instanceof MediaDownloadError) || !error.transient) break;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!downloaded) return { ...base, error: lastError || "No se pudo descargar el archivo" };

  const mimetype = media.mimetype || downloaded.contentType || "application/octet-stream";
  const ext = extensionFor(mimetype, media.kind);
  const filename = media.filename ?? `${media.kind}.${ext}`;
  try {
    const key = buildS3Key({ workspaceId: opts.workspaceId, targetType: "whatsapp", targetId: opts.lineId, filename });
    await uploadBuffer({ s3Key: key, body: downloaded.data, contentType: mimetype.split(";")[0].trim() || "application/octet-stream" });
    let thumbKey: string | null = null;
    if (media.kind === "image") {
      const thumb = await makeThumbnail(downloaded.data);
      if (thumb && thumb.length < downloaded.data.length) {
        thumbKey = `${key}.thumb.webp`;
        await uploadBuffer({ s3Key: thumbKey, body: thumb, contentType: "image/webp" }).catch(() => {
          thumbKey = null;
        });
      }
    }
    return { ...base, mimetype, filename: media.filename, size: downloaded.data.length, key, thumbKey };
  } catch (error) {
    return { ...base, error: `No se pudo guardar el archivo: ${(error as Error).message}`.slice(0, 300) };
  }
}

// Guarda el resultado de la descarga en el mensaje sin pisar otros cambios de
// meta hechos mientras tanto (estado de respuesta, reenvíos…).
export async function attachStoredMedia(messageId: string, stored: StoredMedia) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ meta: unknown }>>`SELECT "meta" FROM "Message" WHERE "id" = ${messageId} FOR UPDATE`;
    if (!rows.length) return;
    const meta = { ...((rows[0].meta as Record<string, any>) ?? {}) };
    meta.media = { ...stored, pending: false };
    await tx.message.update({ where: { id: messageId }, data: { meta } });
  });
}

// Lo que se guarda al crear el mensaje, antes de descargar el archivo.
export function pendingMedia(media: ExtractedMedia): StoredMedia {
  return {
    kind: media.kind,
    mimetype: media.mimetype,
    filename: media.filename,
    caption: media.caption,
    size: null,
    key: null,
    thumbKey: null,
    error: null,
    pending: true,
  };
}
