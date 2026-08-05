import { decryptSecret } from "@/lib/crypto";
import { getWorkspaceSettings } from "@/lib/settings";

export type WahaConfig = {
  baseUrl: string;
  apiKey: string;
  session: string;
  countryCode: string;
};

export class WhatsappNotConfiguredError extends Error {
  constructor() {
    super("WhatsApp (WAHA) no está configurado en este workspace");
  }
}

export async function getWahaConfig(workspaceId: string): Promise<WahaConfig> {
  const settings = await getWorkspaceSettings(workspaceId);
  const w = settings.whatsapp;
  if (!w.wahaUrl) throw new WhatsappNotConfiguredError();
  return {
    baseUrl: w.wahaUrl.replace(/\/$/, ""),
    apiKey: w.wahaApiKeyEnc ? decryptSecret(w.wahaApiKeyEnc) : "",
    session: w.wahaSession || "default",
    countryCode: w.countryCode || "34",
  };
}

function headers(cfg: WahaConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) h["X-Api-Key"] = cfg.apiKey;
  return h;
}

// chatId: si el destinatario ya viene como chatId ("...@c.us" / "...@lid") se usa
// tal cual; si es un número normalizado se construye "<num>@c.us".
function toChatId(phoneOrChatId: string): string {
  return phoneOrChatId.includes("@") ? phoneOrChatId : `${phoneOrChatId}@c.us`;
}

function extractMessageId(data: any): string {
  return (
    data?.id?._serialized || data?.id?.id || data?.key?.id || data?.id || ""
  ).toString();
}

export async function sendText(opts: {
  workspaceId: string;
  to: string; // teléfono normalizado o chatId
  text: string;
}): Promise<{ messageId: string }> {
  const cfg = await getWahaConfig(opts.workspaceId);
  const res = await fetch(`${cfg.baseUrl}/api/sendText`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({
      session: cfg.session,
      chatId: toChatId(opts.to),
      text: opts.text,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WAHA sendText ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  const messageId = extractMessageId(data);
  // El motor NOWEB de WAHA puede devolver 200 sin id cuando la sesión no está
  // realmente operativa: tratarlo como fallo evita "enviados fantasma".
  if (!messageId) {
    throw new Error("WAHA devolvió 200 sin id de mensaje: la sesión no parece operativa");
  }
  return { messageId };
}

export async function getSessionStatus(workspaceId: string): Promise<string | null> {
  try {
    const cfg = await getWahaConfig(workspaceId);
    const res = await fetch(`${cfg.baseUrl}/api/sessions/${cfg.session}`, {
      headers: headers(cfg),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.status ?? null;
  } catch {
    return null;
  }
}
