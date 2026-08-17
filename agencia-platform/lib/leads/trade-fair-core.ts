export type FairInput = { name: string; url: string; venue: string; startsAt: string; endsAt: string; autoQueue?: boolean; maxExhibitors?: number };
export type NormalizedFair = FairInput & { url: string; startsAt: string; endsAt: string; maxExhibitors: number };
export type ExhibitorContact = { name: string; url: string; phone: string | null; email: string | null; website: string | null; stand: string | null };

export function normalizeFairInput(input: FairInput): NormalizedFair {
  const name = input.name.trim(); const venue = input.venue.trim(); const url = new URL(input.url);
  if (url.protocol !== "https:" || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error("La URL del catálogo debe ser HTTPS y pública");
  const starts = new Date(`${input.startsAt}T12:00:00Z`); const ends = new Date(`${input.endsAt}T12:00:00Z`);
  if (!name || !venue || !Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends < starts) throw new Error("Nombre, recinto y fechas de la feria no son válidos");
  return { ...input, name, venue, url: url.toString(), startsAt: input.startsAt, endsAt: input.endsAt, maxExhibitors: Math.min(Math.max(input.maxExhibitors ?? 100, 1), 300) };
}

export function discoverExhibitorUrls(html: string, catalogUrl: string): string[] {
  const base = new URL(catalogUrl); const out = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try { const url = new URL(match[1], base); if (url.hostname !== base.hostname || !/(expositor|exhibitor|empresa|company|marca|firma)/i.test(url.pathname)) continue; url.search = ""; url.hash = ""; if (url.pathname.replace(/\/$/, "") === base.pathname.replace(/\/$/, "")) continue; out.add(url.toString().replace(/\/$/, "")); } catch {}
  }
  return [...out];
}

function strip(value: string): string { return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }
export function extractExhibitor(html: string, url: string): ExhibitorContact | null {
  const title = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const name = strip(title).replace(/\s*[|–-].*$/, "").trim(); if (!name || name.length > 180) return null;
  const phone = html.match(/href=["']tel:([^"']+)/i)?.[1]?.trim() ?? html.match(/(?:\+34\s*)?[6789](?:[ .-]*\d){8}/)?.[0]?.trim() ?? null;
  const email = html.match(/href=["']mailto:([^"'?]+)/i)?.[1]?.trim().toLowerCase() ?? null;
  const stand = strip(html).match(/(?:stand|pabell[oó]n)\s*[:#-]?\s*([A-Z0-9][A-Z0-9 .\/-]{0,18})/i)?.[1]?.trim() ?? null;
  let website: string | null = null; const host = new URL(url).hostname;
  for (const match of html.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["']/gi)) { try { const candidate = new URL(match[1]); if (candidate.hostname !== host && !/(facebook|instagram|linkedin|youtube|twitter|x\.com)/i.test(candidate.hostname)) { website = candidate.toString(); break; } } catch {} }
  return { name, url, phone, email, website, stand };
}

function esDate(date: string): string { return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "Europe/Madrid" }).format(new Date(`${date}T12:00:00Z`)); }
export function buildFairOutreach(data: { exhibitor: string; fair: string; venue: string; startsAt: string; endsAt: string; stand?: string | null }): string {
  const from = esDate(data.startsAt); const to = esDate(data.endsAt); const range = data.startsAt === data.endsAt ? `el ${from}` : `del ${from.replace(/ de [a-záéíóú]+$/i, "")} al ${to}`; const stand = data.stand ? ` en vuestro stand ${data.stand}` : " en vuestro stand";
  return `Hola ${data.exhibitor}, soy David de Negocio Vivo. He visto que exponéis en ${data.fair} ${range}${stand}. Podemos preparar una estrategia de anuncios geolocalizados alrededor de ${data.venue} para que, durante los días de la feria, los visitantes vean vuestra marca en Instagram y Facebook y sepan dónde encontraros. Así aprovecháis mucho más la inversión del stand y aumentáis las oportunidades de contacto. ¿Te enseño en una llamada breve cómo lo plantearíamos para ${data.fair}?`;
}
