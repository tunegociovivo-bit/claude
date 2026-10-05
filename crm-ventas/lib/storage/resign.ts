/**
 * Re-firma URLs de archivos persistidas en BD (miniaturas, mediaUrls). Las
 * firmas caducan; al leer un post se devuelven URLs vivas.
 */
import { dbFileUrl, isS3Enabled, keyFromFileUrl, signedDownloadUrl } from "./r2";

const ONE_HOUR_MS = 60 * 60 * 1000;
const FRESHNESS_MARGIN_MS = 10 * 60 * 1000;
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

function extractS3Key(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.host.toLowerCase();
  const path = parsed.pathname.replace(/^\/+/, "");
  if (!path) return null;
  const endpoint = (process.env.STORAGE_ENDPOINT ?? "").replace(/\/+$/, "");
  const bucket = process.env.STORAGE_BUCKET ?? "";
  if (endpoint && url.startsWith(endpoint)) {
    let key = path;
    if (bucket && key.startsWith(bucket + "/")) key = key.slice(bucket.length + 1);
    return key ? decodeURIComponent(key) : null;
  }
  if (host.endsWith(".r2.cloudflarestorage.com")) {
    const sub = host.slice(0, host.length - ".r2.cloudflarestorage.com".length);
    if (!sub.includes(".")) {
      if (bucket && path.startsWith(bucket + "/")) return decodeURIComponent(path.slice(bucket.length + 1));
      const firstSlash = path.indexOf("/");
      if (firstSlash > 0) return decodeURIComponent(path.slice(firstSlash + 1));
      return decodeURIComponent(path);
    }
    return decodeURIComponent(path);
  }
  if (host.endsWith(".amazonaws.com") && (host.includes(".s3.") || host.startsWith("s3."))) {
    if (host.startsWith("s3.")) {
      if (bucket && path.startsWith(bucket + "/")) return decodeURIComponent(path.slice(bucket.length + 1));
      const firstSlash = path.indexOf("/");
      if (firstSlash > 0) return decodeURIComponent(path.slice(firstSlash + 1));
    }
    return decodeURIComponent(path);
  }
  return null;
}

async function resign(url: string, expiresIn: number, skipIfFresh: boolean): Promise<string> {
  // Archivos guardados en la BD de esta app (/api/files/...).
  const ownKey = keyFromFileUrl(url);
  if (ownKey) {
    if (skipIfFresh) {
      try {
        const exp = Number(new URL(url, "http://local.invalid").searchParams.get("e"));
        if (exp * 1000 - Date.now() > FRESHNESS_MARGIN_MS && /^https?:\/\//i.test(url)) return url;
      } catch {}
    }
    return dbFileUrl(ownKey, expiresIn);
  }
  if (!isS3Enabled()) return url;
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
  const s3Key = extractS3Key(url);
  if (!s3Key) return url;
  try {
    return await signedDownloadUrl(s3Key, expiresIn);
  } catch {
    return url;
  }
}

export async function resignUrlIfNeeded(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  return resign(url, 3600, true);
}

/** Validez larga (7 días) para terceros que descargan más tarde (Meta, Metricool, WordPress). */
export async function resignUrlLong(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  return resign(url, SEVEN_DAYS_SEC, false);
}

async function resignMedia<T extends { thumbnail?: string | null; mediaUrls?: string }>(
  post: T,
  fn: (u: string) => Promise<string | null>
): Promise<T> {
  const fresh: any = { ...post };
  if (post.thumbnail) fresh.thumbnail = await fn(post.thumbnail);
  if (post.mediaUrls) {
    try {
      const arr = JSON.parse(post.mediaUrls);
      if (Array.isArray(arr)) {
        const next = await Promise.all(arr.map((u) => (typeof u === "string" ? fn(u) : u)));
        fresh.mediaUrls = JSON.stringify(next.filter(Boolean));
      }
    } catch {}
  }
  return fresh;
}

export function resignPostMedia<T extends { thumbnail?: string | null; mediaUrls?: string }>(post: T): Promise<T> {
  return resignMedia(post, resignUrlIfNeeded);
}

export function resignPostMediaLong<T extends { thumbnail?: string | null; mediaUrls?: string }>(post: T): Promise<T> {
  return resignMedia(post, resignUrlLong);
}
