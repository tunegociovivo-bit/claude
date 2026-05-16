/**
 * Parser mínimo de iCalendar (RFC 5545). Suficiente para mostrar
 * eventos personales de Google Calendar, Outlook, iCloud, Proton en
 * el calendario de la plataforma.
 *
 * NO expande RRULE — pero no hace falta porque las URLs secretas .ics
 * de Google/Outlook/iCloud ya entregan los eventos recurrentes
 * pre-expandidos para un horizonte de ~1 año.
 */

export type ParsedIcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** ISO 8601. Para all-day, hora fijada a 00:00:00Z. */
  startIso: string;
  endIso?: string;
  allDay: boolean;
};

function unescapeIcs(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseDate(value: string, params: string[]): { iso: string; allDay: boolean } | null {
  const isDate = params.some((p) => p.toUpperCase() === "VALUE=DATE");
  // All-day: YYYYMMDD
  if (isDate || /^\d{8}$/.test(value)) {
    if (value.length < 8) return null;
    return {
      iso: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`,
      allDay: true
    };
  }
  // Datetime UTC: YYYYMMDDTHHMMSSZ
  // Datetime local: YYYYMMDDTHHMMSS (asumimos UTC para simplificar)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}Z`, allDay: false };
}

export function parseIcs(text: string): ParsedIcsEvent[] {
  if (!text) return [];
  // Unfold: RFC 5545 §3.1 — líneas que empiezan con espacio o tab
  // continúan la anterior. Normalizamos CRLF → LF.
  const unfolded = text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "");

  const events: ParsedIcsEvent[] = [];
  let cur: Partial<ParsedIcsEvent> | null = null;

  for (const raw of unfolded.split("\n")) {
    if (raw === "BEGIN:VEVENT") {
      cur = { allDay: false };
      continue;
    }
    if (raw === "END:VEVENT") {
      if (cur && cur.startIso && cur.summary) {
        events.push({
          uid: cur.uid ?? `${cur.startIso}-${cur.summary}`,
          summary: cur.summary,
          description: cur.description,
          location: cur.location,
          startIso: cur.startIso,
          endIso: cur.endIso,
          allDay: cur.allDay ?? false
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = raw.indexOf(":");
    if (colon < 0) continue;
    const head = raw.slice(0, colon);
    const value = raw.slice(colon + 1);
    const [keyRaw, ...params] = head.split(";");
    const key = keyRaw.toUpperCase();

    switch (key) {
      case "UID":
        cur.uid = value;
        break;
      case "SUMMARY":
        cur.summary = unescapeIcs(value);
        break;
      case "DESCRIPTION":
        cur.description = unescapeIcs(value);
        break;
      case "LOCATION":
        cur.location = unescapeIcs(value);
        break;
      case "DTSTART": {
        const d = parseDate(value, params);
        if (d) {
          cur.startIso = d.iso;
          cur.allDay = d.allDay;
        }
        break;
      }
      case "DTEND": {
        const d = parseDate(value, params);
        if (d) cur.endIso = d.iso;
        break;
      }
    }
  }
  return events;
}

/**
 * Descarga y parsea un .ics. Tira si falla la red.
 * - Google Calendar acepta http:// y https:// (la URL secreta empieza
 *   con webcal:// a veces; lo convertimos).
 */
export async function fetchAndParseIcs(url: string, signal?: AbortSignal): Promise<ParsedIcsEvent[]> {
  let cleaned = url.trim();
  if (cleaned.startsWith("webcal://")) cleaned = "https://" + cleaned.slice("webcal://".length);
  const r = await fetch(cleaned, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} al descargar ${cleaned}`);
  const text = await r.text();
  return parseIcs(text);
}
