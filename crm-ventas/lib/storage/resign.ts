/**
 * Re-firma URLs de archivos persistidas en BD (miniaturas, mediaUrls). Las
 * firmas caducan; al leer un post se devuelven URLs vivas.
 */
import { dbFileUrl, isS3Enabled, keyFromFileUrl, signedDownloadUrl } from "./r2";

const ONE_HOUR_MS = 60 * 60 * 1000;
const FRESHNESS_MARGIN_MS = 10 * 60 * 1000;
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

/**
 * Key de nuestro bucket S3/R2 a la que apunta una URL (path-style o
 * virtual-host). Compara hosts ya normalizados (minúsculas, sin puerto por
 * defecto) y solo quita el primer segmento si es el bucket configurado.
 */
export function extractS3Key(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  if (!path) return null;
  const bucket = process.env.STORAGE_BUCKET ?? "";
  const stripBucket = (p: string) => (bucket && p.startsWith(bucket + "/") ? p.slice(bucket.length + 1) : p);
  const hostOf = (raw?: string) => {
    try {
      return raw ? new URL(raw).hostname.toLowerCase() : "";
    } catch {
      return "";
    }
  };
  const endpointHost = hostOf(process.env.STORAGE_ENDPOINT);
  const publicHost = hostOf(process.env.STORAGE_PUBLIC_URL);
  if (publicHost && host === publicHost) {
    // STORAGE_PUBLIC_URL puede llevar ruta (https://cdn.x.com/media): se quita.
    let prefix = "";
    try {
      prefix = decodeURIComponent(new URL(process.env.STORAGE_PUBLIC_URL!).pathname).replace(/^\/+|\/+$/g, "");
    } catch {}
    if (!prefix) return path;
    return path.startsWith(prefix + "/") ? path.slice(prefix.length + 1) : null;
  }
  if (endpointHost && host === endpointHost) return stripBucket(path);
  if (endpointHost && bucket && host === `${bucket.toLowerCase()}.${endpointHost}`) return path;
  if (host.endsWith(".r2.cloudflarestorage.com") || (host.endsWith(".amazonaws.com") && (host.includes(".s3.") || host.startsWith("s3.") || host.includes(".s3-")))) {
    // Virtual-host (<bucket>.<cuenta>…/key) si el host empieza por el bucket; si no, path-style.
    if (bucket && host.startsWith(bucket.toLowerCase() + ".")) return path;
    return stripBucket(path);
  }
  return null;
}

/** Key propia (BD o bucket) a la que apunta la URL, o null si no es nuestra. */
export function storageKeyFromUrl(url: string): string | null {
  return keyFromFileUrl(url) ?? (isS3Enabled() ? extractS3Key(url) : null);
}

function belongsTo(key: string, workspaceId: string): boolean {
  return !!workspaceId && key.startsWith(`${workspaceId}/`) && !key.split("/").includes("..");
}

/** Key propia de la URL SOLO si es del negocio indicado (mismo extractor que la re-firma). */
export function workspaceKeyFromUrl(url: string, workspaceId: string): string | null {
  const key = storageKeyFromUrl(url);
  return key && belongsTo(key, workspaceId) ? key : null;
}

/**
 * Re-firma SOLO archivos del propio negocio: una URL que apunte a una key de
 * otro workspace se devuelve tal cual, sin firma nueva (aislamiento entre
 * negocios aunque alguien guarde a mano la URL de un archivo ajeno).
 */
async function resign(url: string, workspaceId: string, expiresIn: number, skipIfFresh: boolean): Promise<string> {
  const ownKey = keyFromFileUrl(url);
  if (ownKey) {
    if (!belongsTo(ownKey, workspaceId)) return url;
    if (skipIfFresh) {
      try {
        const exp = Number(new URL(url, "http://local.invalid").searchParams.get("e"));
        if (exp * 1000 - Date.now() > FRESHNESS_MARGIN_MS && /^https?:\/\//i.test(url)) return url;
      } catch {}
    }
    return dbFileUrl(ownKey, expiresIn);
  }
  if (!isS3Enabled()) return url;
  const s3Key = extractS3Key(url);
  if (!s3Key || !belongsTo(s3Key, workspaceId)) return url;
  const publicBase = (process.env.STORAGE_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (publicBase && url.startsWith(publicBase + "/")) return url;
  if (skipIfFresh) {
    try {
      const amzDate = new URL(url).searchParams.get("X-Amz-Date");
      if (amzDate && amzDate.length >= 15) {
        const iso = `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`;
        const signedAt = Date.parse(iso);
        if (!Number.isNaN(signedAt) && Date.now() - signedAt < ONE_HOUR_MS - FRESHNESS_MARGIN_MS) return url;
      }
    } catch {}
  }
  try {
    return await signedDownloadUrl(s3Key, Math.min(expiresIn, SEVEN_DAYS_SEC));
  } catch {
    return url;
  }
}

export async function resignUrlIfNeeded(url: string | null | undefined, workspaceId: string): Promise<string | null> {
  if (!url) return null;
  return resign(url, workspaceId, 3600, true);
}

/** Validez larga (7 días) para terceros que descargan después (Meta, Metricool, WordPress). */
export async function resignUrlLong(url: string | null | undefined, workspaceId: string): Promise<string | null> {
  if (!url) return null;
  return resign(url, workspaceId, SEVEN_DAYS_SEC, false);
}

type WithMedia = { workspaceId: string; thumbnail?: string | null; mediaUrls?: string };

async function resignMedia<T extends WithMedia>(post: T, fn: (u: string, ws: string) => Promise<string | null>): Promise<T> {
  const fresh: any = { ...post };
  if (post.thumbnail) fresh.thumbnail = await fn(post.thumbnail, post.workspaceId);
  if (post.mediaUrls) {
    try {
      const arr = JSON.parse(post.mediaUrls);
      if (Array.isArray(arr)) {
        const next = await Promise.all(arr.map((u) => (typeof u === "string" ? fn(u, post.workspaceId) : u)));
        fresh.mediaUrls = JSON.stringify(next.filter(Boolean));
      }
    } catch {}
  }
  return fresh;
}

export function resignPostMedia<T extends WithMedia>(post: T): Promise<T> {
  return resignMedia(post, resignUrlIfNeeded);
}

export function resignPostMediaLong<T extends WithMedia>(post: T): Promise<T> {
  return resignMedia(post, resignUrlLong);
}
