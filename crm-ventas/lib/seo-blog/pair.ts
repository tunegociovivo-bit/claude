/**
 * Emparejamiento del plugin puente con el CRM: el negocio copia un código en
 * «Web y conexión» y lo pega en WordPress → Ajustes → NV SEO Bridge. El plugin
 * crea la contraseña de aplicación y la envía al CRM (/api/public/seo-blog/pair).
 */
import { createHash, randomBytes } from "crypto";

export const PAIR_TTL_MS = 24 * 60 * 60 * 1000;

export function hashPairToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newPairToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Código autocontenido: NVP1.<base64url("crmUrl|siteId|token")> (mismo formato que el Hub). */
export function encodePairCode(appUrl: string, siteId: string, token: string): string {
  return "NVP1." + Buffer.from(`${appUrl}|${siteId}|${token}`).toString("base64url");
}

/** URL pública del CRM a la que el plugin enviará las credenciales. */
export function crmBaseUrl(req: Request): string {
  const env = process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return `${proto}://${host}`;
}
