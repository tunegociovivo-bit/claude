/**
 * Emparejamiento del plugin puente con el Hub: el usuario copia un código del Hub y lo pega en
 * WordPress → Ajustes → NV SEO Bridge. El plugin crea la Application Password y la envía al Hub.
 */
import { createHash, randomBytes } from "crypto";

export const PAIR_TTL_MS = 24 * 60 * 60 * 1000;

export function hashPairToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newPairToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Código autocontenido: NVP1.<base64url("hubUrl|siteId|token")> */
export function encodePairCode(hubUrl: string, siteId: string, token: string): string {
  return "NVP1." + Buffer.from(`${hubUrl}|${siteId}|${token}`).toString("base64url");
}

export function hubBaseUrl(req: Request): string {
  const env = process.env.NEXTAUTH_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "hub.negociovivo.app";
  return `${proto}://${host}`;
}
