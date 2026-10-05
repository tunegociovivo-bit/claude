/**
 * Utilidades puras del Publicador SEO (sin dependencias de BD).
 * Se testean en lib/seo-blog/__tests__.
 */

export const TZ = "Europe/Madrid";

export function stripTags(html: string): string {
  return String(html ?? "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeEntities(s: string): string {
  return String(s ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function plainText(html: string): string {
  return decodeEntities(stripTags(html));
}

export function wordCount(html: string): number {
  const t = plainText(html);
  return t ? t.split(/\s+/u).length : 0;
}

export function removeAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** Equivalente a sanitize_title de WordPress (minúsculas, sin acentos, guiones). */
export function slugify(s: string, max = 90): string {
  return removeAccents(String(s ?? "").toLowerCase())
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function untrailingslash(u: string): string {
  return String(u ?? "").replace(/\/+$/, "");
}

export function hostOf(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function asArray<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function asObject<T = Record<string, any>>(v: unknown): T {
  return (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as T;
}

/** JSON robusto desde respuestas de IA (bloques ```json, prosa alrededor…). */
export function extractJson(text: string): any | null {
  let t = String(text ?? "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {}
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = t.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(t.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Fechas en hora de Madrid                                           */
/* ------------------------------------------------------------------ */

function tzOffsetMinutes(date: Date, timeZone = TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * "2026-10-05" o "2026-10-05 09:30" / "2026-10-05T09:30" (hora de Madrid) → Date UTC.
 * Si solo viene la fecha, usa `defaultTime` (HH:MM).
 */
export function madridToUtc(input: string, defaultTime = "09:00"): Date | null {
  const s = String(input ?? "").trim().replace("T", " ");
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const [hh, mm] = m[4] ? [Number(m[4]), Number(m[5])] : defaultTime.split(":").map(Number);
  const guess = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh || 0, mm || 0));
  const off1 = tzOffsetMinutes(guess);
  const d = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(d);
  return off2 === off1 ? d : new Date(guess.getTime() - off2 * 60000);
}

/** Date UTC → "YYYY-MM-DD HH:MM" en hora de Madrid. */
export function utcToMadrid(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

export function todayMadrid(): string {
  return utcToMadrid(new Date()).slice(0, 10);
}
