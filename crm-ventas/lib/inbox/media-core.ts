// Multimedia de WhatsApp (WAHA): detección pura a partir del evento, sin E/S.
// Los motores de WAHA (NOWEB, WEBJS, GOWS) dejan el tipo en sitios distintos;
// el archivo llega en payload.media.url (si WAHA tiene activada la descarga).

export type MediaKind = "image" | "video" | "voice" | "audio" | "document" | "sticker";

export type ExtractedMedia = {
  kind: MediaKind;
  url: string | null;
  mimetype: string;
  filename: string | null;
  caption: string;
  error: string | null;
};

// Lo que se guarda en Message.meta.media
export type StoredMedia = {
  kind: MediaKind;
  mimetype: string;
  filename: string | null;
  caption: string;
  size: number | null;
  key: string | null; // archivo guardado (BD o bucket)
  thumbKey: string | null; // miniatura (solo fotos)
  error: string | null; // por qué no se pudo guardar
  pending?: boolean; // se está descargando de WAHA
};

// Lo que llega al navegador: nunca las claves internas del almacenamiento.
export type PublicMedia = Omit<StoredMedia, "key" | "thumbKey"> & { hasFile: boolean; hasThumb: boolean };

export function publicMedia(media: StoredMedia): PublicMedia {
  const { key, thumbKey, ...rest } = media;
  return { ...rest, hasFile: Boolean(key), hasThumb: Boolean(thumbKey) };
}

// Quita las claves de almacenamiento del meta de un mensaje antes de enviarlo al cliente.
export function publicMessageMeta(meta: unknown): unknown {
  if (!meta || typeof meta !== "object") return meta;
  const m = meta as Record<string, any>;
  if (!m.media || typeof m.media !== "object") return meta;
  return { ...m, media: publicMedia(m.media as StoredMedia) };
}

function innerMessage(payload: any): Record<string, any> {
  const m = payload?._data?.message ?? payload?._data?.Message ?? payload?.message ?? {};
  // documentWithCaptionMessage / viewOnce envuelven el mensaje real
  return (
    m?.documentWithCaptionMessage?.message ??
    m?.viewOnceMessage?.message ??
    m?.viewOnceMessageV2?.message ??
    m?.ephemeralMessage?.message ??
    m
  );
}

function kindFromHints(payload: any, mimetype: string): MediaKind | null {
  const inner = innerMessage(payload);
  const type = String(payload?._data?.type ?? payload?.type ?? "").toLowerCase();
  if (inner?.stickerMessage || type === "sticker") return "sticker";
  if (inner?.imageMessage || type === "image") return "image";
  if (inner?.videoMessage || type === "video" || type === "gif") return "video";
  if (inner?.audioMessage) return inner.audioMessage.ptt ? "voice" : "audio";
  if (type === "ptt") return "voice";
  if (type === "audio") return "audio";
  if (inner?.documentMessage || type === "document") return "document";
  if (mimetype.startsWith("image/")) return mimetype === "image/webp" ? "sticker" : "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return /ogg|opus/.test(mimetype) ? "voice" : "audio";
  if (mimetype) return "document";
  return null;
}

function cleanMime(value: unknown): string {
  const m = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+(\s*;\s*[a-z0-9=._+ -]+)*$/.test(m) ? m : "";
}

export function cleanFilename(value: unknown): string | null {
  const f = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f/\\<>:"|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return f || null;
}

export function extractCaption(payload: any): string {
  const inner = innerMessage(payload);
  return String(
    payload?.media?.caption ??
      inner?.imageMessage?.caption ??
      inner?.videoMessage?.caption ??
      inner?.documentMessage?.caption ??
      payload?._data?.caption ??
      ""
  ).trim();
}

export function extractMedia(payload: any): ExtractedMedia | null {
  const media = payload?.media && typeof payload.media === "object" ? payload.media : null;
  const hasMedia = payload?.hasMedia === true || Boolean(media?.url);
  const inner = innerMessage(payload);
  const mimetype =
    cleanMime(media?.mimetype) ||
    cleanMime(inner?.imageMessage?.mimetype) ||
    cleanMime(inner?.videoMessage?.mimetype) ||
    cleanMime(inner?.audioMessage?.mimetype) ||
    cleanMime(inner?.documentMessage?.mimetype) ||
    cleanMime(inner?.stickerMessage?.mimetype) ||
    cleanMime(payload?._data?.mimetype);
  const kind = kindFromHints(payload, mimetype);
  if (!hasMedia && !(kind && (inner?.imageMessage || inner?.videoMessage || inner?.audioMessage || inner?.documentMessage || inner?.stickerMessage))) {
    return null;
  }
  if (!kind) return null;
  const url = typeof media?.url === "string" && media.url ? media.url : null;
  return {
    kind,
    url,
    mimetype: mimetype || defaultMime(kind),
    filename: cleanFilename(media?.filename ?? inner?.documentMessage?.fileName ?? payload?._data?.filename),
    caption: extractCaption(payload),
    error: media?.error ? String(typeof media.error === "string" ? media.error : media.error?.message ?? "error").slice(0, 200) : null,
  };
}

function defaultMime(kind: MediaKind): string {
  switch (kind) {
    case "image":
      return "image/jpeg";
    case "sticker":
      return "image/webp";
    case "video":
      return "video/mp4";
    case "voice":
      return "audio/ogg; codecs=opus";
    case "audio":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

export const MEDIA_LABEL: Record<MediaKind, string> = {
  image: "📷 Foto",
  video: "🎥 Vídeo",
  voice: "🎤 Nota de voz",
  audio: "🎵 Audio",
  document: "📄 Documento",
  sticker: "Sticker",
};

// Texto que se guarda como cuerpo del mensaje (vista previa y búsqueda).
export function mediaBody(media: Pick<ExtractedMedia, "kind" | "filename" | "caption">): string {
  const label = media.kind === "document" && media.filename ? `📄 ${media.filename}` : MEDIA_LABEL[media.kind];
  return media.caption ? `${label}\n${media.caption}` : label;
}

// Lo que ve la IA en el historial (no puede ver ni escuchar el archivo).
export function mediaAiText(media: Pick<StoredMedia, "kind" | "filename" | "caption">, direction: "in" | "out"): string {
  const who = direction === "in" ? "El cliente ha enviado" : "Se ha enviado";
  const what: Record<MediaKind, string> = {
    image: "una foto (no puedes verla)",
    video: "un vídeo (no puedes verlo)",
    voice: "una nota de voz (no puedes escucharla; si hace falta, pide amablemente que lo escriba)",
    audio: "un audio (no puedes escucharlo)",
    document: `un documento${media.filename ? ` llamado «${media.filename}»` : ""} (no puedes abrirlo)`,
    sticker: "un sticker",
  };
  const base = `[${who} ${what[media.kind]}]`;
  return media.caption ? `${base}\n${media.caption}` : base;
}

// Ubicación y tarjetas de contacto: se guardan como texto.
export function extractSpecialText(payload: any): string {
  const inner = innerMessage(payload);
  const loc = payload?.location ?? inner?.locationMessage ?? inner?.liveLocationMessage ?? null;
  if (loc && typeof loc === "object") {
    const lat = Number(loc.latitude ?? loc.degreesLatitude);
    const lng = Number(loc.longitude ?? loc.degreesLongitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const name = [loc.name, loc.address, loc.description].filter((v) => typeof v === "string" && v.trim()).join(" · ");
      return `📍 Ubicación${name ? `: ${name}` : ""}\nhttps://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    }
  }
  const vcards: string[] = Array.isArray(payload?.vCards)
    ? payload.vCards
    : inner?.contactMessage?.vcard
      ? [inner.contactMessage.vcard]
      : Array.isArray(inner?.contactsArrayMessage?.contacts)
        ? inner.contactsArrayMessage.contacts.map((c: any) => c?.vcard).filter(Boolean)
        : [];
  if (vcards.length) {
    const lines = vcards.slice(0, 5).map((v) => {
      const fn = /\nFN[^:]*:(.+)/i.exec(`\n${v}`)?.[1]?.trim() ?? "Contacto";
      const tel = /\nTEL[^:]*:([+\d\s().-]+)/i.exec(`\n${v}`)?.[1]?.trim() ?? "";
      return `👤 ${fn}${tel ? ` · ${tel}` : ""}`;
    });
    return lines.join("\n");
  }
  return "";
}

// Ruta interna del archivo en WAHA. WAHA puede anunciar la URL con un host
// interno (localhost); se usa solo la ruta /api/files/… contra el servidor
// WAHA configurado (que ya está en la lista blanca anti-SSRF). Si la ruta
// incluye sesión (/api/files/<sesión>/<archivo>), debe ser la del evento.
export function wahaFilePath(url: string | null, session?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "http://waha.invalid");
    const path = parsed.pathname;
    if (!path.startsWith("/api/files/")) return null;
    if (path.includes("..") || path.includes("%2e%2e") || path.includes("%2E%2E")) return null;
    const segments = path.slice("/api/files/".length).split("/").filter(Boolean);
    if (segments.length === 0 || segments.length > 2) return null;
    if (segments.length === 2 && session && decodeURIComponent(segments[0]) !== session) return null;
    return path;
  } catch {
    return null;
  }
}

// Extensión razonable para guardar el archivo.
export function extensionFor(mimetype: string, kind: MediaKind): string {
  const m = mimetype.split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "video/quicktime": "mov",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "application/pdf": "pdf",
  };
  return map[m] ?? (kind === "document" ? "bin" : kind === "voice" ? "ogg" : "dat");
}

// Tipo MIME seguro para servir al navegador (nunca HTML/SVG/JS).
export function safeServeType(mimetype: string): string {
  const m = mimetype.split(";")[0].trim().toLowerCase();
  if (/^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp|quicktime|webm)|audio\/(ogg|mpeg|mp4|aac|amr|webm|wav|x-m4a)|application\/pdf)$/.test(m)) {
    return mimetype.includes("codecs") && m === "audio/ogg" ? "audio/ogg" : m;
  }
  return "application/octet-stream";
}

// ¿Se puede mostrar dentro de la página o debe descargarse?
export function isInlineType(mimetype: string): boolean {
  return safeServeType(mimetype) !== "application/octet-stream";
}

// Contenedor de audio por sus primeros bytes. Solo se aceptan formatos de
// audio reales: así ffmpeg nunca interpreta listas de reproducción (HLS/DASH,
// concat…) que podrían hacerle leer archivos del servidor o pedir URLs.
export function sniffAudioFormat(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "matroska"; // webm/mkv
  if (buf.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (buf.toString("ascii", 4, 8) === "ftyp") return "mov"; // mp4/m4a (iPhone)
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (buf.toString("ascii", 0, 6) === "#!AMR\n") return "amr";
  if (buf.toString("ascii", 0, 3) === "ID3") return "mp3";
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return "aac"; // ADTS
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

