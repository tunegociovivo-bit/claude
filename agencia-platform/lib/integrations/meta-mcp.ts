/**
 * Conector al MCP oficial de Meta Ads (https://mcp.facebook.com/ads) desde
 * el Hub, vía "remote MCP server" de la API de Anthropic. Autentica como el
 * USUARIO (acceso total a todas sus cuentas) → resuelve el problema de
 * permisos del token de Usuario del Sistema.
 *
 * OAuth "conectar una vez" (descubierto de los metadatos del propio MCP):
 *   - registro dinámico de cliente (RFC 7591): mcp.facebook.com/.well-known/register/ads
 *   - authorization_endpoint: facebook.com/v25.0/dialog/oauth  (PKCE S256)
 *   - token_endpoint:         graph.facebook.com/v25.0/oauth/access_token
 *   - grant types: authorization_code + refresh_token (refresco automático)
 *
 * Todo se guarda cifrado en Workspace.settings.integrations.metaMcp.
 */
import crypto from "crypto";
import { getAnthropicForWorkspace, DEFAULT_MODEL } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";

const FB_MCP_URL = "https://mcp.facebook.com/ads";
const MCP_BETA = "mcp-client-2025-04-04";
const AUTH_ENDPOINT = "https://www.facebook.com/v25.0/dialog/oauth";
const TOKEN_ENDPOINT = "https://graph.facebook.com/v25.0/oauth/access_token";
const REGISTRATION_ENDPOINT = "https://mcp.facebook.com/.well-known/register/ads";
const SCOPES = "ads_management ads_read catalog_management business_management pages_show_list";

export class MetaMcpNotConfiguredError extends Error {
  constructor(msg = "El conector de Meta (MCP) no está configurado en el Hub.") {
    super(msg);
  }
}

export function metaMcpRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.negociovivo.app").replace(/\/+$/, "");
  return `${base}/api/v1/admin/integrations/meta-mcp/callback`;
}

type McpStore = {
  clientId?: string;
  clientSecretEnc?: string;
  accessTokenEnc?: string;
  refreshTokenEnc?: string;
  expiresAt?: string; // ISO
  tokenEnc?: string; // token pegado a mano (fallback)
  pkce?: { verifier: string; state: string; at: number };
  redirectUri?: string;
  updatedAt?: string;
};

async function loadStore(workspaceId: string): Promise<McpStore> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  return ((ws?.settings as any)?.integrations?.metaMcp as McpStore) ?? {};
}

async function saveStore(workspaceId: string, patch: Partial<McpStore>): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.metaMcp = {
    ...(settings.integrations.metaMcp ?? {}),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Cliente OAuth ──
// Orden: (1) App de Facebook propia configurada por env (META_APP_ID/SECRET),
// (2) cliente ya registrado por DCR, (3) intento de DCR (Meta lo tiene
// DESACTIVADO para terceros → suele fallar con invalid_client_metadata).
async function ensureClient(workspaceId: string): Promise<{ clientId: string; clientSecret: string }> {
  const envId = process.env.META_APP_ID;
  const envSecret = process.env.META_APP_SECRET;
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };

  const s = await loadStore(workspaceId);
  if (s.clientId && s.clientSecretEnc) {
    return { clientId: s.clientId, clientSecret: decryptSecret(s.clientSecretEnc) ?? "" };
  }
  const redirectUri = metaMcpRedirectUri();
  const resp = await fetch(REGISTRATION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Hub Negocio Vivo",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: SCOPES
    })
  });
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 300);
    if (/invalid_client_metadata|not available|registration/i.test(body)) {
      throw new Error(
        "Meta tiene desactivado el registro automático de apps para su MCP. Crea una App de Facebook y define META_APP_ID y META_APP_SECRET en Railway (con redirect URI " +
          redirectUri +
          "); luego vuelve a pulsar Conectar."
      );
    }
    throw new Error(`Registro de cliente MCP falló (${resp.status}): ${body}`);
  }
  const data = await resp.json();
  const clientId = String(data.client_id ?? "");
  const clientSecret = String(data.client_secret ?? "");
  if (!clientId) throw new Error("El registro de cliente MCP no devolvió client_id.");
  await saveStore(workspaceId, { clientId, clientSecretEnc: encryptSecret(clientSecret), redirectUri });
  return { clientId, clientSecret };
}

/** Construye la URL de autorización (PKCE) y guarda el verifier+state. */
export async function buildMcpAuthUrl(workspaceId: string): Promise<string> {
  const { clientId } = await ensureClient(workspaceId);
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  await saveStore(workspaceId, { pkce: { verifier, state, at: Date.now() } });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: metaMcpRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: FB_MCP_URL
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Intercambia el code por tokens y los guarda. Valida el state. */
export async function handleMcpCallback(workspaceId: string, code: string, state: string): Promise<void> {
  const s = await loadStore(workspaceId);
  if (!s.pkce || s.pkce.state !== state) throw new Error("State inválido o expirado. Reinicia la conexión.");
  if (Date.now() - s.pkce.at > 15 * 60 * 1000) throw new Error("La conexión caducó. Reinténtala.");
  const clientId = s.clientId;
  const clientSecret = s.clientSecretEnc ? decryptSecret(s.clientSecretEnc) ?? "" : "";
  if (!clientId) throw new Error("Falta el cliente registrado. Reinicia la conexión.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: metaMcpRedirectUri(),
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: s.pkce.verifier,
    resource: FB_MCP_URL
  });
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!resp.ok) throw new Error(`Intercambio de token falló (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  await persistTokens(workspaceId, data);
  await saveStore(workspaceId, { pkce: undefined });
}

async function persistTokens(workspaceId: string, data: any): Promise<void> {
  const accessToken = String(data.access_token ?? "");
  if (!accessToken) throw new Error("El proveedor no devolvió access_token.");
  const expiresIn = Number(data.expires_in ?? 0);
  await saveStore(workspaceId, {
    accessTokenEnc: encryptSecret(accessToken),
    refreshTokenEnc: data.refresh_token ? encryptSecret(String(data.refresh_token)) : undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined
  });
}

async function refreshIfNeeded(workspaceId: string, s: McpStore): Promise<string | null> {
  if (!s.accessTokenEnc) return null;
  const exp = s.expiresAt ? Date.parse(s.expiresAt) : 0;
  // Token aún válido (margen 2 min) o sin expiry conocido → úsalo.
  if (!exp || exp - Date.now() > 120_000) return decryptSecret(s.accessTokenEnc);
  // Caducado/por caducar: intentar refresh.
  if (s.refreshTokenEnc && s.clientId) {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptSecret(s.refreshTokenEnc) ?? "",
        client_id: s.clientId,
        client_secret: s.clientSecretEnc ? decryptSecret(s.clientSecretEnc) ?? "" : "",
        resource: FB_MCP_URL
      });
      const resp = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      });
      if (resp.ok) {
        const data = await resp.json();
        await persistTokens(workspaceId, data);
        return String(data.access_token ?? "") || null;
      }
    } catch {
      /* cae a devolver el token actual */
    }
  }
  // Sin refresh disponible: devolvemos el token actual (puede seguir valiendo).
  return decryptSecret(s.accessTokenEnc);
}

async function getMcpAccessToken(workspaceId: string): Promise<string | null> {
  const s = await loadStore(workspaceId);
  const oauth = await refreshIfNeeded(workspaceId, s);
  if (oauth) return oauth;
  if (s.tokenEnc) {
    try {
      const t = decryptSecret(s.tokenEnc);
      if (t) return t;
    } catch {
      /* fallthrough */
    }
  }
  return process.env.META_MCP_TOKEN ?? null;
}

export async function isMetaMcpConfigured(workspaceId: string): Promise<boolean> {
  return !!(await getMcpAccessToken(workspaceId));
}

export async function disconnectMetaMcp(workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  if (settings.integrations?.metaMcp) {
    delete settings.integrations.metaMcp;
    await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
  }
}

/** Guarda un token pegado a mano (fallback / pruebas). */
export async function setManualMcpToken(workspaceId: string, token: string): Promise<void> {
  await saveStore(workspaceId, { tokenEnc: encryptSecret(token.trim()) });
}

/**
 * Ejecuta una instrucción de Meta Ads a través del MCP oficial de Meta.
 */
export async function runMetaViaMcp(opts: {
  workspaceId: string;
  instruction: string;
}): Promise<{ ok: boolean; text: string }> {
  const token = await getMcpAccessToken(opts.workspaceId);
  if (!token) throw new MetaMcpNotConfiguredError();
  const client = await getAnthropicForWorkspace(opts.workspaceId);

  const messages: any[] = [{ role: "user", content: opts.instruction }];
  for (let i = 0; i < 12; i++) {
    const resp = await (client as any).beta.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      betas: [MCP_BETA],
      mcp_servers: [{ type: "url", url: FB_MCP_URL, name: "facebook_ads", authorization_token: token }],
      system:
        "Eres Sonia, la gestora de Meta Ads de la agencia Negocio Vivo. Ejecuta la " +
        "instrucción usando las herramientas de Meta disponibles (autenticadas con acceso " +
        "total del usuario). Sé precisa y reporta SIEMPRE el resultado real. Los cambios que " +
        "gastan dinero (crear/activar/pausar campañas, presupuestos) hazlos SOLO si la " +
        "instrucción lo pide explícitamente; si hay duda, describe lo que harías sin ejecutarlo.",
      messages
    });
    if (resp.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: resp.content });
      continue;
    }
    const text = (resp.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { ok: true, text: text || "(sin respuesta)" };
  }
  return { ok: false, text: "El agente de Meta (MCP) no terminó a tiempo. Acota la gestión y reintenta." };
}
