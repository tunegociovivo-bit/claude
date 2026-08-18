/**
 * OAuth de Google Business Profile (estilo Make): estado firmado de un solo uso, scope mínimo
 * (business.manage + identidad básica), tokens en servidor. Reutiliza GOOGLE_CLIENT_ID/SECRET.
 *
 * Estado = HMAC firmado {workspaceId,userId,nonce,ts}. El nonce se registra en BD (GmbOAuthState) y
 * se consume en el callback → un solo uso + anti-replay + expiración. Sin secretos en el cliente.
 * Todas las llamadas de red son inyectables (`deps.fetch`) para test sin red.
 */
import crypto from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage openid email";
export const STATE_TTL_MS = 10 * 60 * 1000;

export function gbpOAuthConfigurationIssue(): "server" | "google_credentials" | null {
  if (!process.env.NEXTAUTH_SECRET?.trim()) return "server";
  if (!process.env.GOOGLE_CLIENT_ID?.trim() || !process.env.GOOGLE_CLIENT_SECRET?.trim()) return "google_credentials";
  return null;
}
export function gbpOAuthConfigured(): boolean {
  return gbpOAuthConfigurationIssue() === null;
}

function stateSecret(): string {
  return process.env.NEXTAUTH_SECRET || "insecure-dev-secret";
}
export function baseUrl(fallbackOrigin?: string): string {
  return (process.env.NEXTAUTH_URL?.trim() || fallbackOrigin || "").replace(/\/$/, "");
}
export function gbpRedirectUri(fallbackOrigin?: string): string {
  return `${baseUrl(fallbackOrigin)}/api/integrations/gmb-google/callback`;
}

export type GbpStatePayload = { workspaceId: string; userId: string; nonce: string; ts: number };

export function newNonce(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function signGbpState(payload: GbpStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Verifica firma + expiración (NO consume el nonce; eso lo hace el store en el callback). */
export function verifyGbpState(state: string, now: number = Date.now()): GbpStatePayload | null {
  const [body, sig] = String(state ?? "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  // Comparación en tiempo constante.
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: GbpStatePayload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!payload?.nonce || !payload.workspaceId || !payload.userId) return null;
  if (now - payload.ts > STATE_TTL_MS || payload.ts > now + 60_000) return null;
  return payload;
}

export function gbpAuthorizeUrl(state: string, fallbackOrigin?: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: gbpRedirectUri(fallbackOrigin),
    response_type: "code",
    scope: GBP_SCOPE,
    access_type: "offline",
    include_granted_scopes: "false", // no mezclar scopes de otras conexiones sin consentimiento
    prompt: "consent",
    state
  });
  return `${AUTH_URL}?${p}`;
}

export function hasBusinessScope(scope?: string | null): boolean {
  return !!scope && scope.split(/\s+/).includes("https://www.googleapis.com/auth/business.manage");
}

type FetchLike = typeof fetch;
export type OAuthDeps = { fetch?: FetchLike; now?: () => number };

export type TokenResult = { refresh_token?: string; access_token: string; scope?: string; expires_in?: number; id_token?: string };

/** Intercambia el code por tokens. Lanza si faltan credenciales o la respuesta no es OK. */
export async function exchangeGbpCode(code: string, fallbackOrigin: string | undefined, deps: OAuthDeps = {}): Promise<TokenResult> {
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: gbpRedirectUri(fallbackOrigin), grant_type: "authorization_code" })
  });
  if (!res.ok) throw new Error(`token_exchange_${res.status}`);
  return (await res.json()) as TokenResult;
}

export async function refreshGbpToken(refreshToken: string, deps: OAuthDeps = {}): Promise<{ access_token: string; expires_in?: number; scope?: string }> {
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", grant_type: "refresh_token" })
  });
  if (res.status === 400 || res.status === 401) throw new Error("revoked_or_expired");
  if (!res.ok) throw new Error(`refresh_${res.status}`);
  return (await res.json()) as any;
}

/** Revoca el token en Google (best-effort). No lanza. */
export async function revokeGoogleToken(token: string, deps: OAuthDeps = {}): Promise<boolean> {
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    return res.ok;
  } catch { return false; }
}

/** Extrae el email del id_token (sin verificar firma; solo lectura del payload). */
export function emailFromIdToken(idToken?: string): string {
  if (!idToken) return "";
  try { const p = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")); return typeof p?.email === "string" ? p.email : ""; } catch { return ""; }
}
