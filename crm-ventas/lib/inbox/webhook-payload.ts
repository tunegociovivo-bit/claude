// Extracción pura de campos de los eventos de WAHA (probado en el Hub).
import { normalizePhone } from "@/lib/phone";

export function extractBody(payload: any): string {
  return (
    payload?.body ??
    payload?._data?.body ??
    payload?.message?.conversation ??
    payload?.message?.extendedTextMessage?.text ??
    payload?.message?.imageMessage?.caption ??
    ""
  )
    .toString()
    .trim();
}

export function extractMessageId(payload: any): string {
  const id = payload?.id;
  return (
    (typeof id === "object" ? id?._serialized ?? id?.id : id) ??
    payload?.key?.id ??
    ""
  ).toString();
}

export function extractAlternatePhone(payload: any, countryCode: string): string | null {
  const candidates = [
    payload?._data?.Info?.SenderAlt,
    payload?._data?.Info?.RemoteJidAlt,
    payload?._data?.senderAlt,
    payload?.senderAlt,
    payload?.remoteJidAlt,
  ];
  for (const candidate of candidates) {
    const raw = String(candidate ?? "");
    if (!raw || raw.includes("@lid")) continue;
    const normalized = normalizePhone(raw.replace(/@(c\.us|s\.whatsapp\.net)$/, ""), countryCode);
    if (normalized) return normalized;
  }
  return null;
}

// Nombre de la sesión WAHA que emitió el evento (= número del negocio).
export function extractSession(body: any): string | null {
  const session = body?.session ?? body?.instance ?? body?.payload?.session ?? null;
  return typeof session === "string" && session.trim() ? session.trim() : null;
}

// Ack: -1 error · 0 pendiente · 1 servidor · 2 entregado · 3 leído · 4 reproducido
export function extractAck(payload: any): number | null {
  const ack = payload?.ack ?? payload?._data?.ack;
  const n = Number(ack);
  return Number.isFinite(n) ? n : null;
}

// WAHA marca con source="api" lo enviado por API (el CRM, el Hub…) y con
// "app" lo escrito a mano en el móvil. Solo lo escrito a mano enseña estilo.
export function isApiSent(payload: any): boolean {
  const source = String(payload?.source ?? payload?._data?.source ?? "").toLowerCase();
  return source === "api";
}

// Nombre de perfil del remitente. Cada motor de WAHA lo pone en un sitio:
// NOWEB → _data.pushName, WEBJS → _data.notifyName, GOWS → _data.Info.PushName.
export function extractPushName(payload: any): string | undefined {
  const candidates = [
    payload?._data?.pushName,
    payload?._data?.notifyName,
    payload?._data?.Info?.PushName,
    payload?.pushName,
    payload?.notifyName,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}
