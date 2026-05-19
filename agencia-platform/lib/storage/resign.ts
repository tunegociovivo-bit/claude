/**
 * Re-firma URLs caducadas. Las URLs firmadas de R2/S3 expiran en 1h
 * (signedDownloadUrl en lib/storage/r2.ts). Hemos persistido en BD
 * URLs ya firmadas en EditorialPost.thumbnail y mediaUrls, así que
 * cuando un usuario abre un post pasada esa hora ve una imagen rota.
 *
 * Esta función toma una URL persistida, intenta extraer el `s3Key`
 * del path y devuelve una URL fresca. Soporta dos formatos:
 *
 *   1. URL pública (STORAGE_PUBLIC_URL/key)
 *       https://files.tudominio.com/<workspaceId>/editorial/<id>/abc.png
 *       → no requiere re-firma; se devuelve tal cual (sigue siendo
 *          válida indefinidamente).
 *
 *   2. URL firmada (STORAGE_ENDPOINT/bucket/key?X-Amz-…)
 *       https://abc.r2.cloudflarestorage.com/mybucket/<workspaceId>/...?X-Amz-...
 *       → extraemos `<workspaceId>/...` (tras el bucket) y firmamos
 *          de nuevo.
 *
 * Si no se puede extraer el key (URL ajena, http://image.jpg, lo
 * que sea), devolvemos la URL original — peor caso: sigue rota,
 * mejor caso: era válida y nadie la rompe.
 */

import { isStorageEnabled, signedDownloadUrl } from "./r2";

const ONE_HOUR_MS = 60 * 60 * 1000;
// Si la URL firmada original tiene `X-Amz-Date` reciente, no la
// refrescamos — ahorramos llamadas a R2 cuando los posts se acaban
// de generar y la URL todavía vale.
const FRESHNESS_MARGIN_MS = 10 * 60 * 1000;

/**
 * Detecta si una URL es de R2/S3-compatible y extrae la key.
 * Soporta:
 *   - path-style:         https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
 *   - virtual-host-style: https://<bucket>.<account>.r2.cloudflarestorage.com/<key>
 *   - S3 estándar:        https://<bucket>.s3.<region>.amazonaws.com/<key>
 *                         https://s3.<region>.amazonaws.com/<bucket>/<key>
 *   - Endpoint configurado en env (cualquier prefijo)
 * Devuelve null si no es URL S3-compatible o no se puede extraer key.
 */
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

  // Heurística 1: URL pertenece al endpoint configurado.
  if (endpoint && url.startsWith(endpoint)) {
    let key = path;
    if (bucket && key.startsWith(bucket + "/")) key = key.slice(bucket.length + 1);
    return key ? decodeURIComponent(key) : null;
  }

  // Heurística 2: host R2 virtual-host-style (<bucket>.<account>.r2...)
  if (host.endsWith(".r2.cloudflarestorage.com")) {
    const sub = host.slice(0, host.length - ".r2.cloudflarestorage.com".length);
    // Path-style: <account>.r2.cloudflarestorage.com/<bucket>/<key>
    //  (sub no contiene `.`, es solo el account id)
    if (!sub.includes(".")) {
      // Aquí el primer segmento del path ES el bucket. Si coincide con
      // el bucket configurado lo quitamos, si no, mantenemos el path
      // entero (puede ser un bucket distinto pero misma cuenta R2).
      if (bucket) {
        if (path.startsWith(bucket + "/")) {
          return decodeURIComponent(path.slice(bucket.length + 1));
        }
        // Bucket distinto — probablemente no recuperaremos pero intentamos
        const firstSlash = path.indexOf("/");
        if (firstSlash > 0) return decodeURIComponent(path.slice(firstSlash + 1));
      }
      return decodeURIComponent(path);
    }
    // Virtual-host-style: <bucket>.<account>.r2.cloudflarestorage.com/<key>
    // El path entero es la key.
    return decodeURIComponent(path);
  }

  // Heurística 3: S3 estándar amazonaws.com
  if (host.endsWith(".amazonaws.com")) {
    // Virtual-host: <bucket>.s3.<region>.amazonaws.com/<key>
    if (host.includes(".s3.") || host.startsWith("s3.")) {
      // Path-style: s3.<region>.amazonaws.com/<bucket>/<key>
      if (host.startsWith("s3.")) {
        if (bucket && path.startsWith(bucket + "/")) {
          return decodeURIComponent(path.slice(bucket.length + 1));
        }
        const firstSlash = path.indexOf("/");
        if (firstSlash > 0) return decodeURIComponent(path.slice(firstSlash + 1));
      }
      // Virtual-host: bucket.s3.region.amazonaws.com/<key>
      return decodeURIComponent(path);
    }
  }

  return null;
}

export async function resignUrlIfNeeded(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!isStorageEnabled()) return url; // sin storage configurado no hay nada que firmar

  // Caso URL pública (custom domain de R2 o bucket S3 público) — no
  // tiene query string de firma, no caduca.
  const publicBase = (process.env.STORAGE_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (publicBase && url.startsWith(publicBase + "/")) return url;

  // Si la URL todavía es fresca (signed < 50 min), no refrescamos.
  try {
    const u = new URL(url);
    const amzDate = u.searchParams.get("X-Amz-Date"); // formato YYYYMMDDTHHMMSSZ
    if (amzDate && amzDate.length >= 15) {
      const iso = `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`;
      const signedAt = Date.parse(iso);
      if (!Number.isNaN(signedAt) && Date.now() - signedAt < ONE_HOUR_MS - FRESHNESS_MARGIN_MS) {
        return url;
      }
    }
  } catch {
    // URL malformada, sigue al re-firmado.
  }

  // Extraer el s3Key — soporta path-style + virtual-host-style + S3 estándar.
  // Antes solo detectaba URLs que empezasen con STORAGE_ENDPOINT exacto,
  // así que las virtual-host (bucket.<accountid>.r2.cloudflarestorage.com)
  // caían fuera y NUNCA se re-firmaban → caducaban → 403 al renderizar.
  const s3Key = extractS3Key(url);
  if (!s3Key) return url;

  try {
    return await signedDownloadUrl(s3Key);
  } catch {
    return url;
  }
}

/**
 * Re-firma todas las URLs de un EditorialPost (thumbnail + mediaUrls).
 * Devuelve un nuevo objeto con las URLs vivas. Es seguro llamarlo a
 * cada lectura.
 */
export async function resignPostMedia<T extends { thumbnail?: string | null; mediaUrls?: string }>(
  post: T
): Promise<T> {
  const fresh: any = { ...post };
  if (post.thumbnail) {
    fresh.thumbnail = await resignUrlIfNeeded(post.thumbnail);
  }
  if (post.mediaUrls) {
    try {
      const arr = JSON.parse(post.mediaUrls);
      if (Array.isArray(arr)) {
        const fresh2 = await Promise.all(arr.map((u) => (typeof u === "string" ? resignUrlIfNeeded(u) : u)));
        fresh.mediaUrls = JSON.stringify(fresh2.filter(Boolean));
      }
    } catch {
      // mediaUrls no parsea, lo dejamos como está
    }
  }
  return fresh;
}
