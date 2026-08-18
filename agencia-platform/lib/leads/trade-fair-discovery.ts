export type DiscoveredFair = { name: string; startsAt: string; endsAt: string; venue: string; url: string; catalogUrl: string | null; organizer: string };

export function discoverEventUrls(html: string, calendarUrl: string, pathPatterns: RegExp[]): string[] {
  const base = new URL(calendarUrl); const out = new Set<string>();
  const nonEvents = /^\/(contacto|calendario|agenda|prensa|noticias|blog|empleo|aviso-legal|privacidad|cookies|login)\/?$/i;
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], base);
      if (url.hostname !== base.hostname || nonEvents.test(url.pathname) || !pathPatterns.some((pattern) => pattern.test(url.pathname))) continue;
      url.search = ""; url.hash = ""; out.add(url.toString().replace(/\/$/, ""));
    } catch {}
  }
  return [...out];
}

function eventObjects(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(eventObjects);
  if (!value || typeof value !== "object") return [];
  const own = String(value["@type"] ?? "").toLowerCase() === "event" ? [value] : [];
  return [...own, ...eventObjects(value["@graph"]), ...eventObjects(value.itemListElement)];
}

function isoDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/); return match?.[0] ?? null;
}

export function extractFairFromPage(html: string, pageUrl: string, organizer: string): DiscoveredFair | null {
  let event: any = null;
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { event = eventObjects(JSON.parse(match[1])).find((item) => isoDay(item.startDate)); if (event) break; } catch {}
  }
  if (!event) return null;
  const startsAt = isoDay(event.startDate); const endsAt = isoDay(event.endDate) ?? startsAt;
  const name = String(event.name ?? "").replace(/<[^>]+>/g, "").trim();
  if (!startsAt || !endsAt || !name) return null;
  const venue = String(event.location?.name ?? event.location?.address?.addressLocality ?? organizer).trim() || organizer;
  const page = new URL(pageUrl); let catalogUrl: string | null = null;
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (!/(catálogo|catalogo|expositores|exhibitors|lista de empresas)/i.test(`${match[1]} ${label}`)) continue;
    try { const candidate = new URL(match[1], page); if (candidate.protocol === "https:") { candidate.hash = ""; catalogUrl = candidate.toString(); break; } } catch {}
  }
  return { name, startsAt, endsAt, venue, url: page.toString(), catalogUrl, organizer };
}

function normalized(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
export function filterUpcomingFairs(fairs: DiscoveredFair[], now = new Date(), keyword = ""): DiscoveredFair[] {
  const today = now.toISOString().slice(0, 10); const query = normalized(keyword.trim());
  const unique = new Map<string, DiscoveredFair>();
  for (const fair of fairs) {
    if (fair.endsAt < today || (query && !normalized(`${fair.name} ${fair.venue} ${fair.organizer}`).includes(query))) continue;
    const key = `${normalized(fair.name)}|${fair.startsAt}`; if (!unique.has(key)) unique.set(key, fair);
  }
  return [...unique.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
