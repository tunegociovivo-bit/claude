/**
 * Cliente Evolution API (alternativa a WAHA). A diferencia de WAHA Core,
 * Evolution envía AUDIO/medios gratis, así que es el proveedor recomendado
 * para notas de voz.
 *
 * Config en workspace.settings.leads.{ evolutionUrl, evolutionApiKey(cifrada),
 * evolutionInstance } con fallback a settings.integrations.evolution.{ url,
 * apiKeyEnc, instance } (lo que migró wp-import del plugin original).
 *
 * Auth: header `apikey: <API_KEY>`.
 * Endpoints (tolerante a v1/v2):
 *   - POST /message/sendText/{instance}
 *   - POST /message/sendWhatsAppAudio/{instance}   (nota de voz PTT)
 *   - GET  /instance/connectionState/{instance}
 *   - GET  /instance/connect/{instance}            (QR para vincular)
 *   - POST /chat/whatsappNumbers/{instance}        (comprobar números)
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

export type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instance: string;
  countryCode: string;
};

export async function getEvolutionConfig(workspaceId: string): Promise<EvolutionConfig> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = ws?.settings ?? {};
  const leads = settings?.leads ?? {};
  const evo = settings?.integrations?.evolution ?? {};

  const baseUrl: string | null = leads.evolutionUrl ?? evo.url ?? process.env.EVOLUTION_API_URL ?? null;
  const apiKey: string | null =
    (leads.evolutionApiKey ? decryptSecret(leads.evolutionApiKey) : null) ??
    (evo.apiKeyEnc ? decryptSecret(evo.apiKeyEnc) : null) ??
    process.env.EVOLUTION_API_KEY ??
    null;
  const instance: string = leads.evolutionInstance ?? evo.instance ?? process.env.EVOLUTION_INSTANCE ?? "default";
  const countryCode: string = leads.whatsappCountryCode ?? "34";

  if (!baseUrl) throw new Error("Evolution URL no configurada");
  if (!apiKey) throw new Error("Evolution API key no configurada");

  return { baseUrl: normalizeBaseUrl(baseUrl), apiKey, instance, countryCode };
}

/** Limpia errores típicos al pegar la URL: prefijo "URL:", espacios,
 *  barra final y esquema ausente. */
function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/^url\s*:\s*/i, "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

function headers(apiKey: string) {
  return { "Content-Type": "application/json", apikey: apiKey, Accept: "application/json" };
}

/** Envía texto. Prueba el body de v2 ({number,text}) y cae a v1 si hace falta. */
export async function evoSendText(opts: {
  workspaceId: string;
  phoneNormalized: string;
  text: string;
  /** Instancia concreta (multi-número). Si no, la de la config. */
  session?: string;
}): Promise<{ messageId: string }> {
  const cfg = await getEvolutionConfig(opts.workspaceId);
  const instance = opts.session?.trim() || cfg.instance;
  const url = `${cfg.baseUrl}/message/sendText/${encodeURIComponent(instance)}`;
  const bodies = [
    { number: opts.phoneNormalized, text: opts.text },
    { number: opts.phoneNormalized, textMessage: { text: opts.text } }
  ];
  let lastErr = "";
  for (const body of bodies) {
    const resp = await fetch(url, { method: "POST", headers: headers(cfg.apiKey), body: JSON.stringify(body) });
    if (resp.ok) {
      const data: any = await resp.json().catch(() => ({}));
      return { messageId: String(data?.key?.id ?? data?.id ?? data?.message?.key?.id ?? "") };
    }
    lastErr = `${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`;
    if (resp.status !== 400) break; // solo reintenta el otro shape si fue 400 (validación)
  }
  throw new Error(`Evolution sendText ${lastErr}`);
}

/**
 * Envía una NOTA DE VOZ (PTT). Evolution acepta base64 y la entrega como nota
 * de voz, convirtiéndola internamente. Mandamos el MP3 de ElevenLabs.
 */
export async function evoSendVoice(opts: {
  workspaceId: string;
  phoneNormalized: string;
  audio: Buffer;
  /** Instancia concreta (multi-número). Si no, la de la config. */
  session?: string;
}): Promise<{ messageId: string }> {
  const cfg = await getEvolutionConfig(opts.workspaceId);
  const instance = opts.session?.trim() || cfg.instance;
  const url = `${cfg.baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`;
  const b64 = opts.audio.toString("base64");
  const bodies = [
    { number: opts.phoneNormalized, audio: b64 },
    { number: opts.phoneNormalized, audioMessage: { audio: b64 } }
  ];
  let lastErr = "";
  for (const body of bodies) {
    const resp = await fetch(url, { method: "POST", headers: headers(cfg.apiKey), body: JSON.stringify(body) });
    if (resp.ok) {
      const data: any = await resp.json().catch(() => ({}));
      return { messageId: String(data?.key?.id ?? data?.id ?? data?.message?.key?.id ?? "") };
    }
    lastErr = `${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`;
    if (resp.status !== 400) break;
  }
  throw new Error(`Evolution sendWhatsAppAudio ${lastErr}`);
}

/** Envía una IMAGEN (base64) con caption opcional. Tolerante a v1/v2. */
export async function evoSendImage(opts: {
  workspaceId: string;
  phoneNormalized: string;
  imageBase64: string;
  caption?: string;
  filename?: string;
  session?: string;
}): Promise<{ messageId: string }> {
  const cfg = await getEvolutionConfig(opts.workspaceId);
  const instance = opts.session?.trim() || cfg.instance;
  const url = `${cfg.baseUrl}/message/sendMedia/${encodeURIComponent(instance)}`;
  const bodies = [
    {
      number: opts.phoneNormalized,
      mediatype: "image",
      media: opts.imageBase64,
      caption: opts.caption ?? "",
      fileName: opts.filename ?? "mockup.png"
    }, // v2
    {
      number: opts.phoneNormalized,
      mediaMessage: { mediatype: "image", media: opts.imageBase64, caption: opts.caption ?? "" }
    } // v1
  ];
  let lastErr = "";
  for (const body of bodies) {
    const resp = await fetch(url, { method: "POST", headers: headers(cfg.apiKey), body: JSON.stringify(body) });
    if (resp.ok) {
      const data: any = await resp.json().catch(() => ({}));
      return { messageId: String(data?.key?.id ?? data?.id ?? data?.message?.key?.id ?? "") };
    }
    lastErr = `${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`;
    if (resp.status !== 400) break;
  }
  throw new Error(`Evolution sendMedia ${lastErr}`);
}

/** Estado de conexión de la instancia. "open" = vinculada/operativa. */
export async function evoConnectionState(workspaceId: string): Promise<{
  reachable: boolean;
  state: string | null;
  raw?: any;
  error?: string;
}> {
  let cfg: EvolutionConfig;
  try {
    cfg = await getEvolutionConfig(workspaceId);
  } catch (e: any) {
    return { reachable: false, state: null, error: e?.message ?? "no configurado" };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(`${cfg.baseUrl}/instance/connectionState/${encodeURIComponent(cfg.instance)}`, {
      headers: headers(cfg.apiKey),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!resp.ok) {
      return { reachable: true, state: null, error: `${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 160)}` };
    }
    const data: any = await resp.json().catch(() => ({}));
    const state = data?.instance?.state ?? data?.state ?? null;
    return { reachable: true, state: state ? String(state) : null, raw: data };
  } catch (e: any) {
    clearTimeout(t);
    return { reachable: false, state: null, error: e?.message ?? "error de red" };
  }
}

/** Inicia/recupera la conexión y devuelve el QR (base64 data URL) para vincular.
 *  Si la instancia aún no existe en el servidor Evolution, la crea (v2). */
export async function evoConnect(
  workspaceId: string,
  instanceOverride?: string
): Promise<{
  ok: boolean;
  base64: string | null;
  pairingCode?: string | null;
  count?: number | null;
  state?: string | null;
  error?: string;
}> {
  let cfg: EvolutionConfig;
  try {
    cfg = await getEvolutionConfig(workspaceId);
  } catch (e: any) {
    return { ok: false, base64: null, error: e?.message ?? "no configurado" };
  }
  // Multi-número: conectar una instancia concreta (se crea si no existe).
  if (instanceOverride?.trim()) cfg = { ...cfg, instance: instanceOverride.trim() };
  const inst = encodeURIComponent(cfg.instance);
  const pick = (d: any) => ({
    base64: (d?.base64 ?? d?.qrcode?.base64 ?? null) as string | null,
    pairingCode: (d?.pairingCode ?? d?.qrcode?.pairingCode ?? null) as string | null
  });
  const getConnect = () => fetch(`${cfg.baseUrl}/instance/connect/${inst}`, { headers: headers(cfg.apiKey) });

  try {
    // 1) Intentar conectar una instancia existente.
    let resp = await getConnect();

    // 2) Si no existe (404), crearla. Evolution v2 a veces devuelve el QR aquí,
    //    pero Baileys lo genera async: si llega vacío, lo recogemos en el bucle.
    if (resp.status === 404) {
      // Proxy por número (anti-baneo): la instancia sale por su proxy
      // residencial/móvil en vez de la IP de datacenter del servidor.
      const { resolveProxyForSession } = await import("./proxy");
      const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
      const proxy = resolveProxyForSession((ws?.settings as any)?.leads ?? {}, cfg.instance);
      const create = await fetch(`${cfg.baseUrl}/instance/create`, {
        method: "POST",
        headers: headers(cfg.apiKey),
        body: JSON.stringify({
          instanceName: cfg.instance,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
          ...(proxy
            ? {
                proxyHost: proxy.host,
                proxyPort: proxy.port,
                proxyProtocol: proxy.protocol,
                ...(proxy.username ? { proxyUsername: proxy.username } : {}),
                ...(proxy.password ? { proxyPassword: proxy.password } : {})
              }
            : {})
        })
      });
      if (create.ok) {
        const got = pick(await create.json().catch(() => ({})));
        if (got.base64) return { ok: true, base64: String(got.base64), pairingCode: got.pairingCode };
      } else if (create.status !== 403 && create.status !== 409) {
        // 403/409 = "ya existe" (carrera) → seguimos a /connect; otro error sí corta.
        return { ok: false, base64: null, error: `${create.status}: ${(await create.text().catch(() => "")).slice(0, 160)}` };
      }
      resp = await getConnect();
    }

    if (!resp.ok) {
      return { ok: false, base64: null, error: `${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 160)}` };
    }

    // 3) El QR de Baileys puede tardar un par de segundos: reintenta /connect
    //    hasta que aparezca el base64 (en vez de devolver una imagen vacía).
    let raw: any = await resp.json().catch(() => ({}));
    let got = pick(raw);
    for (let i = 0; i < 6 && !got.base64; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const r2 = await getConnect();
      if (r2.ok) {
        raw = await r2.json().catch(() => ({}));
        got = pick(raw);
      }
    }
    if (got.base64) {
      return { ok: true, base64: String(got.base64), pairingCode: got.pairingCode };
    }

    // Sin QR: diagnostica el porqué para que la UI no se quede en "imagen rota".
    // `count` lo da /connect (0 = Baileys aún no ha emitido ningún QR); el
    // estado de la instancia distingue "ya conectada" de "no arranca el socket".
    const count = typeof raw?.count === "number" ? raw.count : null;
    let state: string | null = null;
    try {
      const stResp = await fetch(`${cfg.baseUrl}/instance/connectionState/${inst}`, { headers: headers(cfg.apiKey) });
      if (stResp.ok) {
        const stData: any = await stResp.json().catch(() => ({}));
        state = stData?.instance?.state ?? stData?.state ?? null;
      }
    } catch {
      /* estado desconocido */
    }
    let error: string;
    if (state === "open") {
      error = "La instancia ya está vinculada (no necesita QR).";
    } else if (count === 0) {
      error =
        `Evolution devolvió count:0 — Baileys no ha generado el QR (estado "${state ?? "?"}"). ` +
        "Suele indicar que el socket a WhatsApp no arranca: revisa LOG_BAILEYS=debug, la versión " +
        "de WhatsApp Web (CONFIG_SESSION_PHONE_VERSION) o un posible bloqueo de red/IP.";
    } else {
      error = `Evolution no devolvió QR (count:${count ?? "?"}, estado "${state ?? "?"}").`;
    }
    return { ok: false, base64: null, pairingCode: got.pairingCode, count, state, error };
  } catch (e: any) {
    return { ok: false, base64: null, error: e?.message ?? "error de red" };
  }
}

/**
 * Registra el webhook de mensajes entrantes en Evolution para que reenvíe los
 * mensajes a nuestro endpoint. Sin esto, la pestaña Inbox no recibe nada
 * cuando el proveedor activo es Evolution (a diferencia de WAHA, que tenía
 * auto-setup). Tolerante a v1 y v2 (cambia la forma del body).
 *
 * Evolution: POST /webhook/set/{instance}
 *   v2: { webhook: { enabled, url, byEvents, base64, events: ["MESSAGES_UPSERT"] } }
 *   v1: { url, enabled, webhook_by_events, events: ["MESSAGES_UPSERT"] }
 */
export async function evoSetWebhook(opts: {
  workspaceId: string;
  url: string;
}): Promise<{ ok: boolean; instance: string; error?: string }> {
  const cfg = await getEvolutionConfig(opts.workspaceId);
  const endpoint = `${cfg.baseUrl}/webhook/set/${encodeURIComponent(cfg.instance)}`;
  const events = ["MESSAGES_UPSERT"];
  const bodies = [
    { webhook: { enabled: true, url: opts.url, byEvents: false, base64: false, events } }, // v2
    { url: opts.url, enabled: true, webhook_by_events: false, events } // v1
  ];
  let lastErr = "";
  for (const body of bodies) {
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: headers(cfg.apiKey),
        body: JSON.stringify(body)
      });
      if (resp.ok) return { ok: true, instance: cfg.instance };
      lastErr = `${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`;
      if (resp.status !== 400) break; // solo reintenta el otro shape si fue validación
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      break;
    }
  }
  return { ok: false, instance: cfg.instance, error: lastErr };
}

/** Comprueba si un número tiene WhatsApp. null = desconocido (no descartar). */
export async function evoCheckNumber(opts: { workspaceId: string; phone: string }): Promise<boolean | null> {
  let cfg: EvolutionConfig;
  try {
    cfg = await getEvolutionConfig(opts.workspaceId);
  } catch {
    return null;
  }
  try {
    const resp = await fetch(`${cfg.baseUrl}/chat/whatsappNumbers/${encodeURIComponent(cfg.instance)}`, {
      method: "POST",
      headers: headers(cfg.apiKey),
      body: JSON.stringify({ numbers: [opts.phone] })
    });
    if (!resp.ok) return null;
    const data: any = await resp.json().catch(() => null);
    const arr = Array.isArray(data) ? data : Array.isArray(data?.numbers) ? data.numbers : null;
    if (!arr || arr.length === 0) return null;
    const first = arr[0];
    if (typeof first?.exists === "boolean") return first.exists;
    if (typeof first?.numberExists === "boolean") return first.numberExists;
    return null;
  } catch {
    return null;
  }
}
