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

export async function resignUrlIfNeeded(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!isStorageEnabled()) return url; // sin storage configurado no hay nada que firmar

  // Caso URL pública (custom domain de R2 o bucket S3 público) — no
  // tiene query string de firma, no caduca.
  const publicBase = (process.env.STORAGE_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (publicBase && url.startsWith(publicBase + "/")) return url;

  // Si no es del propio endpoint, no la tocamos.
  const endpoint = (process.env.STORAGE_ENDPOINT ?? "").replace(/\/+$/, "");
  const bucket = process.env.STORAGE_BUCKET ?? "";
  if (!endpoint || !bucket || !url.startsWith(endpoint)) return url;

  // Si la URL todavía es fresca, no refrescamos (lectura del header
  // X-Amz-Date en la query). Esto evita una llamada a R2 por cada
  // imagen al cargar la lista del calendario editorial.
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

  // Extraer el s3Key del path: <endpoint>/<bucket>/<key>?...
  let s3Key: string;
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/^\/+/, "");
    if (path.startsWith(bucket + "/")) path = path.slice(bucket.length + 1);
    s3Key = decodeURIComponent(path);
  } catch {
    return url;
  }
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
