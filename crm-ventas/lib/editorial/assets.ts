/**
 * Validación de URLs de recursos (logo, referencias, plantillas, fuentes,
 * imágenes de publicaciones) que el negocio guarda en BD.
 *
 * Motivo (multi-tenant): el servidor descarga estas URLs con
 * fetchAssetBuffer, que lee los archivos propios (/api/files/<key>) directo
 * de BD sin mirar la firma. Si un negocio pudiera guardar la URL de un
 * archivo de OTRO workspace, el servidor se lo leería. Por eso:
 *  · archivos propios → su key debe empezar por `${workspaceId}/`;
 *  · URLs externas → solo http(s) hacia hosts públicos (sin localhost ni IPs
 *    privadas), para no alcanzar servicios internos.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { isPrivateIp } from "@/lib/leads/email-extract";
import { keyFromFileUrl, signedDownloadUrl } from "@/lib/storage/r2";
import { workspaceKeyFromUrl } from "@/lib/storage/resign";
import { ASSET_URL_TTL } from "@/lib/content/brand";
import { editorialStorageKey } from "./media";

/** URL absoluta http(s) o ruta propia /api/files/... (sin PUBLIC_APP_URL las URLs firmadas son relativas). */
export const assetUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => /^https?:\/\//i.test(value) || value.startsWith("/api/files/"), "URL no válida");

function invalid(message: string): never {
  throw new ApiError(400, "invalid_asset_url", message);
}

function pointsToOwnStorageSafe(url: string): boolean {
  try {
    return pointsToOwnStorage(new URL(url));
  } catch {
    return false;
  }
}

/**
 * ¿Apunta la URL a nuestro almacenamiento S3/R2? (endpoint, URL pública o
 * hosts de R2/S3). Esas URLs solo se aceptan si la key es del propio negocio:
 * el re-firmado compartido (lib/storage/resign) firmaría cualquier key del
 * bucket y daría acceso a archivos de otro negocio.
 */
export function pointsToOwnStorage(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  const bases = [process.env.STORAGE_PUBLIC_URL, process.env.STORAGE_ENDPOINT].filter(Boolean) as string[];
  for (const base of bases) {
    try {
      const baseHost = new URL(base).hostname.toLowerCase();
      if (host === baseHost || host.endsWith(`.${baseHost}`)) return true;
    } catch {
      /* variable mal formada: se ignora */
    }
  }
  return host.endsWith(".r2.cloudflarestorage.com") || (host.endsWith(".amazonaws.com") && (host.includes(".s3.") || host.startsWith("s3.") || host.includes(".s3-")));
}

/**
 * Key de nuestro almacenamiento a la que apunta la URL, SOLO si pertenece al
 * negocio (prefijo `${workspaceId}/`). null si no es nuestra o es de otro.
 */
export function workspaceStorageKey(url: string, workspaceId: string): string | null {
  // Un único extractor para validar y para re-firmar (lib/storage/resign).
  return workspaceKeyFromUrl(url, workspaceId);
}

export async function assertWorkspaceAssetUrl(url: string, workspaceId: string): Promise<void> {
  if (keyFromFileUrl(url) || (/^https?:\/\//i.test(url) && pointsToOwnStorageSafe(url))) {
    if (!workspaceStorageKey(url, workspaceId)) invalid("Ese archivo no pertenece a tu cuenta. Súbelo de nuevo.");
    return;
  }
  // Archivo de nuestro bucket S3/R2 con URL pública configurada.
  if (editorialStorageKey(url, workspaceId)) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    invalid("URL no válida.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) invalid("Usa una URL que empiece por https://");
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || (isIP(host) && isPrivateIp(host))) {
    invalid("Esa dirección no es pública. Sube el archivo o usa una URL pública.");
  }
  if (!isIP(host)) {
    try {
      const addresses = await lookup(host, { all: true });
      if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) throw new Error("private_host");
    } catch {
      invalid(`No se puede acceder a ${host}. Sube el archivo o usa una URL pública.`);
    }
  }
}

/**
 * Normaliza una URL de recurso de marca antes de guardarla: valida que sea
 * del negocio (o pública) y, si es un archivo propio, la firma con validez
 * larga (ASSET_URL_TTL) para que siga funcionando al leerla más tarde.
 */
export async function persistBrandAssetUrl(url: string, workspaceId: string): Promise<string> {
  await assertWorkspaceAssetUrl(url, workspaceId);
  const key = workspaceStorageKey(url, workspaceId);
  if (!key) return url;
  try {
    return await signedDownloadUrl(key, ASSET_URL_TTL);
  } catch {
    // S3 sin URL pública no admite firmas de más de 7 días; se re-firma al leer.
    return signedDownloadUrl(key, 7 * 24 * 60 * 60);
  }
}
