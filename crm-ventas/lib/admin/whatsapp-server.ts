// Servidor de WhatsApp (WAHA) de cada cliente: estado visible en /admin.
// Puro (sin BD) para poder probarlo; el alta está en whatsapp-provision.ts.

export type WhatsappServerStatus = { configured: boolean; host: string | null };

export function whatsappServerStatus(settings: unknown): WhatsappServerStatus {
  const w = ((settings as any)?.whatsapp ?? {}) as Record<string, unknown>;
  const url = typeof w.wahaUrl === "string" ? w.wahaUrl.trim() : "";
  const configured = Boolean(url && typeof w.wahaApiKeyEnc === "string" && w.wahaApiKeyEnc);
  let host: string | null = null;
  try {
    host = url ? new URL(url).host : null;
  } catch {
    host = null;
  }
  return { configured, host };
}

// Ajustes de WhatsApp tras activar el servidor. En un alta nueva (sin servidor
// previo) la sesión principal pasa a ser la propia del cliente (paula-<id>),
// nunca "default", que es la sesión compartida del servidor.
export function applyWhatsappServer(
  settings: Record<string, any>,
  opts: { baseUrl: string; apiKeyEnc: string; ownSession: string; wasConfigured: boolean; webhookToken: string }
) {
  const w: Record<string, any> = { ...(settings.whatsapp ?? {}) };
  w.wahaUrl = opts.baseUrl;
  w.wahaApiKeyEnc = opts.apiKeyEnc;
  if (!opts.wasConfigured && (!w.wahaSession || w.wahaSession === "default")) w.wahaSession = opts.ownSession;
  if (!w.countryCode) w.countryCode = "34";
  settings.whatsapp = w;
  if (typeof settings.whatsappWebhookToken !== "string" || settings.whatsappWebhookToken.length < 16) {
    settings.whatsappWebhookToken = opts.webhookToken;
  }
}
