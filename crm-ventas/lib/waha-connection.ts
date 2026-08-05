import "server-only";
import { decryptSecret, randomToken } from "@/lib/crypto";
import {
  getWorkspaceSettings,
  publicBaseUrl,
  saveWorkspaceSettings,
} from "@/lib/settings";
import { assertAllowedWahaUrl } from "@/lib/waha";

// ---------------------------------------------------------------------------
// Autoservicio de la sesión de WhatsApp (WAHA) por workspace.
//
// Reglas de seguridad:
//  - El nombre de sesión SIEMPRE se deriva del workspace (paula-<id>); nunca
//    se acepta desde la UI.
//  - Las sesiones protegidas (default, cualquier "sonia", WAHA_PROTECTED_SESSIONS)
//    no se tocan jamás desde aquí.
//  - Antes de desvincular se comprueba el teléfono de la sesión: si es un
//    número protegido (WAHA_PROTECTED_E164) se aborta. Si el estado no se
//    puede leer (ni 2xx ni 404), se aborta también: fail closed.
//  - La API key nunca sale del servidor; el QR se sirve por proxy same-origin.
// ---------------------------------------------------------------------------

const WEBHOOK_EVENTS = ["message", "message.any", "message.ack"];
const DEFAULT_PROTECTED_E164 = "34613068550";

export class WahaSelfServiceError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
  }
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function protectedSessionNames(): Set<string> {
  const names = new Set<string>();
  for (const item of (process.env.WAHA_PROTECTED_SESSIONS || "").split(",")) {
    const v = item.trim().toLowerCase();
    if (v) names.add(v);
  }
  return names;
}

export function isProtectedSessionName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (n === "default") return true;
  if (n.includes("sonia")) return true;
  return protectedSessionNames().has(n);
}

function protectedPhoneDigits(): Set<string> {
  const raw = process.env.WAHA_PROTECTED_E164 || DEFAULT_PROTECTED_E164;
  const phones = new Set<string>();
  for (const item of raw.split(",")) {
    const d = digits(item);
    if (d) phones.add(d);
  }
  return phones;
}

// Teléfono vinculado a una sesión según GET /api/sessions/<name>. El id llega
// como "34600111222@c.us" o "34600111222:12@s.whatsapp.net" según el motor.
function sessionPhoneDigits(sessionInfo: any): string {
  const id = String(sessionInfo?.me?.id ?? "");
  return digits(id.split("@")[0].split(":")[0]);
}

function isProtectedPhone(sessionInfo: any): boolean {
  const phone = sessionPhoneDigits(sessionInfo);
  return Boolean(phone) && protectedPhoneDigits().has(phone);
}

export function derivedSessionName(workspaceId: string): string {
  const clean = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  if (!clean) throw new WahaSelfServiceError("Workspace no válido", 400);
  const name = `paula-${clean}`;
  // Defensa en profundidad: el nombre derivado nunca debería ser protegido.
  if (isProtectedSessionName(name)) {
    throw new WahaSelfServiceError("Nombre de sesión no permitido", 403);
  }
  return name;
}

type WahaCtx = { baseUrl: string; apiKey: string; session: string };

async function wahaCtx(workspaceId: string): Promise<WahaCtx> {
  const settings = await getWorkspaceSettings(workspaceId);
  const w = settings.whatsapp;
  if (!w.wahaUrl || !w.wahaApiKeyEnc) {
    throw new WahaSelfServiceError(
      "Configura y guarda primero la URL y la API key de WAHA",
      409
    );
  }
  return {
    baseUrl: assertAllowedWahaUrl(w.wahaUrl),
    apiKey: decryptSecret(w.wahaApiKeyEnc),
    session: derivedSessionName(workspaceId),
  };
}

async function wahaFetch(
  ctx: WahaCtx,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  try {
    return await fetch(`${ctx.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": ctx.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new WahaSelfServiceError("No se pudo conectar con el servidor WAHA");
  }
}

async function getSession(ctx: WahaCtx): Promise<{ status: number; body: any }> {
  const res = await wahaFetch(
    ctx,
    `/api/sessions/${encodeURIComponent(ctx.session)}`
  );
  const body = res.ok ? await res.json().catch(() => null) : null;
  return { status: res.status, body };
}

export type WahaConnectionState = {
  configured: boolean;
  session: string;
  status: string; // NO_SESSION | STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED…
  phone: string | null;
};

export async function getConnectionState(
  workspaceId: string
): Promise<WahaConnectionState> {
  let ctx: WahaCtx;
  try {
    ctx = await wahaCtx(workspaceId);
  } catch (error) {
    if (error instanceof WahaSelfServiceError && error.status === 409) {
      return {
        configured: false,
        session: derivedSessionName(workspaceId),
        status: "NOT_CONFIGURED",
        phone: null,
      };
    }
    throw error;
  }
  const { status, body } = await getSession(ctx);
  if (status === 404) {
    return { configured: true, session: ctx.session, status: "NO_SESSION", phone: null };
  }
  if (status < 200 || status >= 300) {
    throw new WahaSelfServiceError(
      `WAHA no devolvió el estado de la sesión (HTTP ${status})`
    );
  }
  const phone = sessionPhoneDigits(body);
  return {
    configured: true,
    session: ctx.session,
    status: String(body?.status ?? "UNKNOWN"),
    phone: phone || null,
  };
}

async function ensureWebhookToken(workspaceId: string): Promise<string> {
  const settings = await getWorkspaceSettings(workspaceId);
  if (settings.whatsappWebhookToken) return settings.whatsappWebhookToken;
  const token = randomToken();
  await saveWorkspaceSettings(workspaceId, { whatsappWebhookToken: token });
  return token;
}

function sessionConfig(webhookUrl: string) {
  return {
    webhooks: [{ url: webhookUrl, events: WEBHOOK_EVENTS }],
  };
}

// Crea (o reconfigura) y arranca la sesión derivada del workspace. Si ya
// estaba arrancada, la reinicia para renovar el QR. Nunca toca otra sesión.
export async function ensureSessionStarted(
  workspaceId: string
): Promise<WahaConnectionState> {
  const ctx = await wahaCtx(workspaceId);
  const token = await ensureWebhookToken(workspaceId);
  const webhookUrl = `${publicBaseUrl()}/api/webhooks/whatsapp/${token}`;
  const config = sessionConfig(webhookUrl);
  const encoded = encodeURIComponent(ctx.session);

  const { status } = await getSession(ctx);
  if (status === 404) {
    const created = await wahaFetch(ctx, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: ctx.session, start: true, config }),
    });
    if (!created.ok) {
      // WAHA antiguos no tienen el CRUD de sesiones: usar el endpoint clásico.
      const legacy = await wahaFetch(ctx, "/api/sessions/start", {
        method: "POST",
        body: JSON.stringify({ name: ctx.session, config }),
      });
      if (!legacy.ok) {
        throw new WahaSelfServiceError(
          `WAHA no pudo crear la sesión (HTTP ${created.status})`
        );
      }
    }
  } else if (status >= 200 && status < 300) {
    // Reconfigurar webhook (best-effort) y reiniciar para renovar el QR.
    await wahaFetch(ctx, `/api/sessions/${encoded}`, {
      method: "PUT",
      body: JSON.stringify({ config }),
    }).catch(() => undefined);
    const restarted = await wahaFetch(ctx, `/api/sessions/${encoded}/restart`, {
      method: "POST",
      body: "{}",
    });
    if (!restarted.ok) {
      const started = await wahaFetch(ctx, `/api/sessions/${encoded}/start`, {
        method: "POST",
        body: "{}",
      });
      // 422 = "ya está arrancada" en WAHA sin endpoint de restart: no es fallo.
      if (!started.ok && started.status !== 422) {
        throw new WahaSelfServiceError(
          `WAHA no pudo arrancar la sesión (HTTP ${restarted.status})`
        );
      }
    }
  } else {
    // Estado desconocido: no seguir a ciegas.
    throw new WahaSelfServiceError(
      `WAHA no devolvió el estado de la sesión (HTTP ${status})`
    );
  }

  // A partir de ahora este workspace envía por su sesión derivada.
  await saveWorkspaceSettings(workspaceId, {
    whatsapp: { wahaSession: ctx.session } as any,
  });

  return getConnectionState(workspaceId);
}

// Desvincula (logout) la sesión derivada. Fail closed: si no se puede leer el
// estado, o el teléfono vinculado es un número protegido, se aborta.
export async function unlinkSession(workspaceId: string): Promise<{ ok: true }> {
  const ctx = await wahaCtx(workspaceId);
  const { status, body } = await getSession(ctx);

  if (status === 404) return { ok: true }; // no hay nada que desvincular
  if (status < 200 || status >= 300) {
    throw new WahaSelfServiceError(
      `No se pudo verificar el estado de la sesión (HTTP ${status}); desvinculación abortada`
    );
  }
  if (isProtectedPhone(body)) {
    throw new WahaSelfServiceError(
      "La sesión está vinculada a un número protegido; desvinculación abortada",
      403
    );
  }

  const encoded = encodeURIComponent(ctx.session);
  const res = await wahaFetch(ctx, `/api/sessions/${encoded}/logout`, {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) {
    // Endpoint clásico de WAHA antiguos.
    const legacy = await wahaFetch(ctx, "/api/sessions/logout", {
      method: "POST",
      body: JSON.stringify({ name: ctx.session }),
    });
    if (!legacy.ok) {
      throw new WahaSelfServiceError(
        `WAHA no pudo desvincular la sesión (HTTP ${res.status})`
      );
    }
  }
  return { ok: true };
}

// QR de vinculación, proxied: nunca exponemos la URL ni la API key de WAHA.
const QR_MAX_BYTES = 1024 * 1024;

export async function fetchQrPng(workspaceId: string): Promise<ArrayBuffer> {
  const ctx = await wahaCtx(workspaceId);
  const res = await wahaFetch(
    ctx,
    `/api/${encodeURIComponent(ctx.session)}/auth/qr`,
    { headers: { Accept: "image/png" } }
  );
  if (!res.ok) {
    throw new WahaSelfServiceError(
      `El QR no está disponible todavía (HTTP ${res.status})`,
      res.status === 404 ? 404 : 502
    );
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/png")) {
    throw new WahaSelfServiceError("WAHA no devolvió una imagen PNG");
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > QR_MAX_BYTES) {
    throw new WahaSelfServiceError("El QR recibido no es válido");
  }
  return buf;
}
