/**
 * Autocompletado de perfil del negocio con IA + datos reales.
 *
 * Al darse de alta (o desde Ajustes), reúne datos REALES para no inventar:
 *  1) Google Places (por nombre + ciudad) → placeId real (reseñas), web, tel.
 *  2) Scraping ligero de su web → enlaces a Instagram/Facebook/TikTok/Trustpilot.
 *  3) La IA elige/normaliza los mejores enlaces a partir de esos candidatos.
 * Devuelve un BORRADOR para que el dueño lo verifique antes de guardar.
 */
import { completeJson, AIDisabledError } from "@/lib/ai/anthropic";

export type AutofillDraft = {
  googlePlaceId: string | null;
  googleReviewUrl: string | null;
  website: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  trustpilotUrl: string | null;
  phone: string | null;
  address: string | null;
  sources: Record<string, string>; // campo → "places" | "web" | "ia"
};

/** Busca el negocio en Google Places (API New) con la key de entorno. */
async function placesLookup(query: string): Promise<{ id?: string; website?: string; phone?: string; address?: string } | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.websiteUri,places.internationalPhoneNumber,places.formattedAddress"
      },
      body: JSON.stringify({ textQuery: query, languageCode: "es", regionCode: "ES", pageSize: 1 }),
      signal: AbortSignal.timeout(12000)
    });
    if (!resp.ok) return null;
    const data: any = await resp.json().catch(() => null);
    const p = data?.places?.[0];
    if (!p) return null;
    return { id: p.id, website: p.websiteUri, phone: p.internationalPhoneNumber, address: p.formattedAddress };
  } catch {
    return null;
  }
}

/** Descarga la web del negocio y extrae enlaces a redes/Trustpilot. */
async function scrapeSocialLinks(website: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const url = /^https?:/.test(website) ? website : `https://${website}`;
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 BubuiBot" }, signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return out;
    const html = (await resp.text()).slice(0, 400_000);
    const grab = (re: RegExp) => {
      const m = html.match(re);
      return m ? m[0].replace(/["'<>\\)]+$/, "") : null;
    };
    const ig = grab(/https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.\/]+/i);
    const fb = grab(/https?:\/\/(www\.)?facebook\.com\/[A-Za-z0-9_.\-\/]+/i);
    const tt = grab(/https?:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.\/]+/i);
    const tp = grab(/https?:\/\/(www\.)?(es\.)?trustpilot\.com\/review\/[A-Za-z0-9_.\-\/]+/i);
    if (ig) out.instagramUrl = ig;
    if (fb) out.facebookUrl = fb;
    if (tt) out.tiktokUrl = tt;
    if (tp) out.trustpilotUrl = tp;
  } catch {}
  return out;
}

const SYSTEM = `Eres un asistente que normaliza los perfiles online de un negocio local español.
Te paso datos del negocio y enlaces candidatos encontrados en su web. Devuelve SOLO el JSON con
las URLs definitivas (o null si no hay una razonable). NO inventes perfiles que no encajen con el
negocio; ante la duda, null. Normaliza las URLs (https, sin parámetros de seguimiento).`;

const SCHEMA = {
  type: "object",
  properties: {
    instagramUrl: { type: ["string", "null"] },
    facebookUrl: { type: ["string", "null"] },
    tiktokUrl: { type: ["string", "null"] },
    trustpilotUrl: { type: ["string", "null"] }
  },
  required: ["instagramUrl", "facebookUrl", "tiktokUrl", "trustpilotUrl"]
};

export async function autofillBusinessProfile(input: {
  name: string;
  city?: string | null;
  category?: string | null;
  website?: string | null;
  address?: string | null;
}): Promise<AutofillDraft> {
  const query = `${input.name} ${input.city ?? ""} ${input.category ?? ""}`.trim();
  const places = await placesLookup(query);
  const website = input.website || places?.website || null;
  const scraped = website ? await scrapeSocialLinks(website) : {};

  const sources: Record<string, string> = {};
  if (places?.id) sources.googlePlaceId = "places";
  for (const k of Object.keys(scraped)) sources[k] = "web";

  // La IA afina/normaliza a partir de los candidatos reales (no inventa).
  let aiLinks: any = {};
  try {
    aiLinks = await completeJson({
      workspaceId: "bubui",
      model: "claude-haiku-4-5-20251001",
      system: SYSTEM,
      user: `Negocio: ${input.name}\nCiudad: ${input.city ?? "—"}\nSector: ${input.category ?? "—"}\nWeb: ${website ?? "—"}\n\nEnlaces candidatos (de su web):\n${JSON.stringify(scraped)}`,
      schema: SCHEMA,
      maxTokens: 300
    });
  } catch (e) {
    if (!(e instanceof AIDisabledError)) aiLinks = {};
  }

  const pick = (key: string): string | null => {
    const scrapedVal = (scraped as any)[key];
    const aiVal = aiLinks?.[key];
    if (scrapedVal) return scrapedVal; // lo real de la web manda
    if (aiVal) { sources[key] = "ia"; return aiVal; }
    return null;
  };

  const googleReviewUrl = places?.id ? `https://search.google.com/local/writereview?placeid=${places.id}` : null;

  return {
    googlePlaceId: places?.id ?? null,
    googleReviewUrl,
    website,
    instagramUrl: pick("instagramUrl"),
    facebookUrl: pick("facebookUrl"),
    tiktokUrl: pick("tiktokUrl"),
    trustpilotUrl: pick("trustpilotUrl"),
    phone: places?.phone ?? null,
    address: places?.address ?? input.address ?? null,
    sources
  };
}
