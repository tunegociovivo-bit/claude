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

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, instance, countryCode };
}

function headers(apiKey: string) {
  return { "Content-Type": "application/json", apikey: apiKey, Accept: "application/json" };
}

/** Envía texto. Prueba el body de v2 ({number,text}) y cae a v1 si hace falta. */
export async function evoSendText(opts: {
  workspaceId: string;
  phoneNormalized: string;
  text: string;
}): Promise<{ messageId: string }> {
  const cfg = await getEvolutionConfig(opts.workspaceId);
  const url = `${cfg.baseUrl}/message/sendText/${encodeURIComponent(cfg.instance)}`;
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
}): Promise<{ messageId: string }> {
  const cfg = await getEvolutionConfig(opts.workspaceId);
  const url = `${cfg.baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(cfg.instance)}`;
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
export async function evoConnect(workspaceId: string): Promise<{
  ok: boolean;
  base64: string | null;
  pairingCode?: string | null;
  error?: string;
}> {
  let cfg: EvolutionConfig;
  try {
    cfg = await getEvolutionConfig(workspaceId);
  } catch (e: any) {
    return { ok: false, base64: null, error: e?.message ?? "no configurado" };
  }
  const inst = encodeURIComponent(cfg.instance);
  try {
    // 1) Intentar conectar una instancia existente.
    const resp = await fetch(`${cfg.baseUrl}/instance/connect/${inst}`, { headers: headers(cfg.apiKey) });
    if (resp.ok) {
      const data: any = await resp.json().catch(() => ({}));
      const base64 = data?.base64 ?? data?.qrcode?.base64 ?? null;
      const pairingCode = data?.pairingCode ?? data?.qrcode?.pairingCode ?? null;
      return { ok: true, base64: base64 ? String(base64) : null, pairingCode };
    }
    // 2) Si no existe (404), crearla — Evolution v2 devuelve el QR al crear.
    if (resp.status === 404) {
      const create = await fetch(`${cfg.baseUrl}/instance/create`, {
        method: "POST",
        headers: headers(cfg.apiKey),
        body: JSON.stringify({
          instanceName: cfg.instance,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true
        })
      });
      if (!create.ok) {
        return { ok: false, base64: null, error: `${create.status}: ${(await create.text().catch(() => "")).slice(0, 160)}` };
      }
      const data: any = await create.json().catch(() => ({}));
      const base64 = data?.qrcode?.base64 ?? data?.base64 ?? null;
      const pairingCode = data?.qrcode?.pairingCode ?? data?.pairingCode ?? null;
      return { ok: true, base64: base64 ? String(base64) : null, pairingCode };
    }
    return { ok: false, base64: null, error: `${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 160)}` };
  } catch (e: any) {
    return { ok: false, base64: null, error: e?.message ?? "error de red" };
  }
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
