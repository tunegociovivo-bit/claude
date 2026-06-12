/**
 * Cliente WAHA (WhatsApp HTTP API). Auth con X-Api-Key.
 *
 * Migra NVL_Evolution_API + NVL_WhatsApp del plugin.
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

export type WahaConfig = {
  baseUrl: string;
  apiKey: string;
  session: string;
  countryCode: string;
};

/** Proveedor de WhatsApp activo para el workspace. */
export async function getWhatsappProvider(workspaceId: string): Promise<"waha" | "evolution"> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const p = (ws?.settings as any)?.leads?.whatsappProvider;
  return p === "evolution" ? "evolution" : "waha";
}

export async function getWahaConfig(workspaceId: string): Promise<WahaConfig> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = ws?.settings ?? {};
  const leads = settings?.leads ?? {};
  // Fallback a la config del plugin migrada por wp-import, que aterrizó en
  // settings.integrations.evolution.{url, apiKeyEnc}. Así reutilizamos el
  // MISMO servidor y API key con los que ya estaba vinculado el teléfono de
  // Sonia, sin reconfigurar ni reescanear el QR.
  const evo: any = settings?.integrations?.evolution ?? {};

  const baseUrl: string | null = leads.wahaUrl ?? evo.url ?? process.env.WAHA_URL ?? null;
  const leadsKey = leads.wahaApiKey ? decryptSecret(leads.wahaApiKey) : null;
  const evoKey = evo.apiKeyEnc ? decryptSecret(evo.apiKeyEnc) : null;
  const apiKey = leadsKey ?? evoKey ?? process.env.WAHA_API_KEY ?? null;
  // El nombre de sesión es lo único que el plugin no exportó; WAHA usa
  // "default" salvo que se indique otro (en Ajustes o por WAHA_SESSION).
  const session: string = leads.wahaSession ?? process.env.WAHA_SESSION ?? "default";
  const countryCode: string = leads.whatsappCountryCode ?? "34";

  if (!baseUrl) throw new Error("WAHA URL no configurada");
  if (!apiKey) throw new Error("WAHA API key no configurada");

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, session, countryCode };
}

/**
 * Extrae el ID de mensaje de la respuesta de WAHA de forma robusta. El motor
 * NOWEB lo devuelve a veces como string serializado ("true_...@c.us_XXX") y
 * otras como objeto { _serialized, id, ... }; WEBJS varía también. Devuelve ""
 * si no hay ninguno — señal de que el envío NO se materializó (sesión caída /
 * número no alcanzado), que el llamante debe tratar como FALLO y nunca marcar
 * "sent". Este es el origen del bug de "sent" fantasma con NOWEB.
 */
export function extractWahaMessageId(data: any): string {
  if (!data) return "";
  const cand = data.id ?? data.key?.id ?? data._data?.id ?? data.messageId ?? null;
  if (!cand) return "";
  if (typeof cand === "string") return cand;
  if (typeof cand === "object") return String(cand._serialized ?? cand.id ?? "");
  return String(cand);
}

/**
 * Normaliza un teléfono al formato E.164 sin "+" (que WAHA pide).
 * Ej: "+34 666 12 34 56" → "34666123456"
 */
export function normalizePhone(raw: string | null | undefined, defaultCountryCode = "34"): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  // Si no empieza con código de país y tiene 9 dígitos (España), prepend 34
  if (digits.length === 9 && !digits.startsWith(defaultCountryCode)) {
    digits = defaultCountryCode + digits;
  }
  return digits;
}

export async function sendText(opts: {
  workspaceId: string;
  phoneNormalized: string;
  text: string;
  session?: string;
}): Promise<{ messageId: string; raw?: any }> {
  if ((await getWhatsappProvider(opts.workspaceId)) === "evolution") {
    const { evoSendText } = await import("./evolution");
    return evoSendText(opts);
  }
  const cfg = await getWahaConfig(opts.workspaceId);
  // Si nos pasan el chatId completo (con @c.us / @lid / @g.us), se usa TAL CUAL
  // — imprescindible para responder a usuarios con LID (id privado de
  // WhatsApp), donde reconstruir `${num}@c.us` no enruta. Si es solo número,
  // se asume @c.us.
  const chatId = String(opts.phoneNormalized).includes("@")
    ? String(opts.phoneNormalized)
    : `${opts.phoneNormalized}@c.us`;
  const resp = await fetch(`${cfg.baseUrl}/api/sendText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": cfg.apiKey
    },
    body: JSON.stringify({
      session: opts.session ?? cfg.session,
      chatId,
      text: opts.text
    })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`WAHA sendText ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json().catch(() => null);
  const messageId = extractWahaMessageId(data);
  if (!messageId) {
    // 200 OK pero sin ID → el envío no se materializó (típico de una sesión
    // NOWEB que responde pero no entrega). Lo tratamos como fallo para que la
    // cola reintente y NO se marque "sent" en falso.
    throw new Error(
      `WAHA aceptó la petición (HTTP ${resp.status}) pero no devolvió ID de mensaje. ` +
        `Suele indicar que la sesión no está realmente operativa o que el número no recibió el mensaje. ` +
        `Respuesta: ${JSON.stringify(data ?? {}).slice(0, 200)}`
    );
  }
  return { messageId, raw: data };
}

/**
 * Envía una IMAGEN (PNG/JPG en base64) con caption opcional. Se usa para el
 * mockup de la ficha de Google. Enruta a Evolution si es el proveedor activo.
 */
export async function sendImage(opts: {
  workspaceId: string;
  phoneNormalized: string;
  imageBase64: string;
  caption?: string;
  filename?: string;
  session?: string;
}): Promise<{ messageId: string; raw?: any }> {
  if ((await getWhatsappProvider(opts.workspaceId)) === "evolution") {
    const { evoSendImage } = await import("./evolution");
    return evoSendImage(opts);
  }
  const cfg = await getWahaConfig(opts.workspaceId);
  const chatId = `${opts.phoneNormalized}@c.us`;
  const resp = await fetch(`${cfg.baseUrl}/api/sendImage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": cfg.apiKey },
    body: JSON.stringify({
      session: opts.session ?? cfg.session,
      chatId,
      file: { mimetype: "image/png", filename: opts.filename ?? "mockup.png", data: opts.imageBase64 },
      caption: opts.caption ?? ""
    })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`WAHA sendImage ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json().catch(() => null);
  const messageId = extractWahaMessageId(data);
  if (!messageId) {
    throw new Error(
      `WAHA aceptó sendImage (HTTP ${resp.status}) pero no devolvió ID de mensaje. ` +
        `Suele indicar que la sesión no está operativa. Respuesta: ${JSON.stringify(data ?? {}).slice(0, 200)}`
    );
  }
  return { messageId, raw: data };
}

/**
 * Envía una NOTA DE VOZ (PTT) por WhatsApp. WhatsApp solo acepta audio en
 * OGG/Opus; ElevenLabs nos da MP3, así que lo transcodificamos a Opus en
 * NUESTRO servidor (ffmpeg-static) y lo mandamos ya listo con convert:false.
 * Si la conversión local fallara, caemos a mandar el MP3 con convert:true
 * (que lo convierta WAHA).
 */
export async function sendVoice(opts: {
  workspaceId: string;
  phoneNormalized: string;
  audio: Buffer;
  mimetype?: string; // mimetype de ORIGEN, default audio/mpeg
  filename?: string;
  session?: string;
}): Promise<{ messageId: string; raw?: any }> {
  if ((await getWhatsappProvider(opts.workspaceId)) === "evolution") {
    const { evoSendVoice } = await import("./evolution");
    return evoSendVoice({ workspaceId: opts.workspaceId, phoneNormalized: opts.phoneNormalized, audio: opts.audio });
  }
  const cfg = await getWahaConfig(opts.workspaceId);
  const chatId = `${opts.phoneNormalized}@c.us`;

  let file: { mimetype: string; filename: string; data: string };
  let convert: boolean;
  try {
    const { mp3ToOpusOgg } = await import("@/lib/leads/audio");
    const ogg = await mp3ToOpusOgg(opts.audio);
    file = { mimetype: "audio/ogg; codecs=opus", filename: "voice.ogg", data: ogg.toString("base64") };
    convert = false;
  } catch {
    // Sin ffmpeg local: que convierta WAHA desde el MP3
    file = {
      mimetype: opts.mimetype ?? "audio/mpeg",
      filename: opts.filename ?? "voice.mp3",
      data: opts.audio.toString("base64")
    };
    convert = true;
  }

  const resp = await fetch(`${cfg.baseUrl}/api/sendVoice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": cfg.apiKey
    },
    body: JSON.stringify({
      session: opts.session ?? cfg.session,
      chatId,
      convert,
      file
    })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`WAHA sendVoice ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json().catch(() => null);
  const messageId = extractWahaMessageId(data);
  if (!messageId) {
    throw new Error(
      `WAHA sendVoice aceptó la petición pero no devolvió ID de mensaje. Respuesta: ${JSON.stringify(data ?? {}).slice(0, 200)}`
    );
  }
  return { messageId, raw: data };
}

export async function getSession(opts: { workspaceId: string; session?: string }): Promise<any> {
  const cfg = await getWahaConfig(opts.workspaceId);
  const resp = await fetch(`${cfg.baseUrl}/api/sessions/${opts.session ?? cfg.session}`, {
    headers: { "X-Api-Key": cfg.apiKey }
  });
  if (!resp.ok) throw new Error(`WAHA getSession ${resp.status}`);
  return resp.json();
}

export async function startSession(opts: { workspaceId: string; session?: string }): Promise<any> {
  const cfg = await getWahaConfig(opts.workspaceId);
  const resp = await fetch(`${cfg.baseUrl}/api/sessions/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": cfg.apiKey },
    body: JSON.stringify({ name: opts.session ?? cfg.session })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`WAHA startSession ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return resp.json();
}

/**
 * Devuelve la URL del QR para escanear y vincular el dispositivo.
 * El cliente debe hacer GET con header X-Api-Key.
 */
export function qrUrl(cfg: WahaConfig, session?: string): string {
  return `${cfg.baseUrl}/api/${session ?? cfg.session}/auth/qr?format=image`;
}

/**
 * Comprueba si UN número tiene WhatsApp, vía el endpoint oficial de WAHA
 * `/api/contacts/check-exists`. Devuelve:
 *   - true  → el número está en WhatsApp
 *   - false → NO está (descartable con seguridad)
 *   - null  → desconocido (error/timeout): el llamante debe enviar igual,
 *             nunca descartar por una comprobación que falló.
 */
export async function checkNumberExists(opts: {
  workspaceId: string;
  phone: string; // normalizado, sin "+"
  session?: string;
}): Promise<boolean | null> {
  if ((await getWhatsappProvider(opts.workspaceId)) === "evolution") {
    const { evoCheckNumber } = await import("./evolution");
    return evoCheckNumber({ workspaceId: opts.workspaceId, phone: opts.phone });
  }
  const cfg = await getWahaConfig(opts.workspaceId);
  const session = opts.session ?? cfg.session;
  try {
    const resp = await fetch(
      `${cfg.baseUrl}/api/contacts/check-exists?phone=${encodeURIComponent(opts.phone)}&session=${encodeURIComponent(session)}`,
      { headers: { "X-Api-Key": cfg.apiKey } }
    );
    if (!resp.ok) return null;
    const j: any = await resp.json();
    if (typeof j?.numberExists === "boolean") return j.numberExists;
    if (j?.chatId) return true;
    return null;
  } catch {
    return null;
  }
}

/**
 * Comprueba si un array de números tiene WhatsApp activo.
 * Útil para batch validation.
 */
export async function checkNumbers(opts: {
  workspaceId: string;
  phones: string[]; // ya normalizados (sin +)
}): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const phone of opts.phones) {
    const exists = await checkNumberExists({ workspaceId: opts.workspaceId, phone });
    out[phone] = exists === true;
    // Pequeño delay para no saturar
    await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}
