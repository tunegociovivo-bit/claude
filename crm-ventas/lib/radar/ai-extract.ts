import "server-only";
import { completeJson } from "@/lib/ai/anthropic";
import { FAST_MODEL } from "@/lib/ai/anthropic";
import { cleanText, normalizeCountry, normalizeFuel, normalizeGearbox, parseInteger, parseYear, safeHttpUrl } from "./normalize";
import { hashId, type ExtractedVehicle, type VehicleMapOptions } from "./extract-json";

// Respaldo: cuando un portal no expone un JSON reconocible, se le pasa a Claude
// el texto visible de la lista y devuelve los coches. Es más caro y menos
// fiable que el JSON, por eso solo se usa si lo demás falla.

const MAX_HTML = 120_000;

/** Deja solo el texto y los enlaces (quita scripts, estilos y atributos largos). */
function toReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?!\/?(a|h1|h2|h3|li|tr|td|th|span|div|p|b|strong)\b)[^>]+>/gi, " ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_HTML);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vehicles"],
  properties: {
    vehicles: {
      type: "array",
      maxItems: 120,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          externalId: { type: ["string", "null"], description: "id/referencia/lote si aparece" },
          url: { type: ["string", "null"], description: "enlace a la ficha del coche" },
          title: { type: "string" },
          make: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          version: { type: ["string", "null"] },
          year: { type: ["integer", "null"] },
          km: { type: ["integer", "null"] },
          price: { type: ["integer", "null"], description: "precio o puja en euros, solo el número" },
          priceLabel: { type: ["string", "null"] },
          fuel: { type: ["string", "null"] },
          gearbox: { type: ["string", "null"] },
          powerCv: { type: ["integer", "null"] },
          country: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

type AiVehicle = {
  externalId: string | null;
  url: string | null;
  title: string;
  make: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  priceLabel: string | null;
  fuel: string | null;
  gearbox: string | null;
  powerCv: number | null;
  country: string | null;
  location: string | null;
};

export async function aiExtractVehicles(opts: {
  workspaceId: string;
  html: string;
  pageUrl: string;
  map?: VehicleMapOptions;
}): Promise<ExtractedVehicle[]> {
  const text = toReadableText(opts.html);
  if (text.length < 200) return [];
  const result = await completeJson<{ vehicles: AiVehicle[] }>({
    workspaceId: opts.workspaceId,
    feature: "radar_extract",
    model: FAST_MODEL,
    maxTokens: 8000,
    schema: SCHEMA,
    system:
      "Extraes coches de la lista de resultados de un portal de subastas B2B. Devuelve solo los coches realmente listados en esta página (no menús, anuncios ni enlaces del pie). Para cada coche, copia los datos tal cual aparecen: no inventes ni estimes. Si un dato no está, déjalo en null. El precio y los km solo como número entero en euros/kilómetros.",
    user: `URL de la página: ${opts.pageUrl}\n\nContenido:\n${text}`,
  });
  const base = opts.map?.baseUrl ?? opts.pageUrl;
  const out = new Map<string, ExtractedVehicle>();
  for (const v of result.vehicles ?? []) {
    const title = cleanText(v.title, 200);
    if (!title) continue;
    const externalId = (cleanText(v.externalId, 120) || "").replace(/\s+/g, "") || hashId(title, v.km, v.year, v.price);
    if (out.has(externalId)) continue;
    const km = parseInteger(v.km);
    const price = parseInteger(v.price);
    out.set(externalId, {
      externalId,
      url: safeHttpUrl(v.url, base),
      title,
      make: cleanText(v.make, 60),
      model: cleanText(v.model, 80),
      version: cleanText(v.version, 160),
      year: parseYear(v.year),
      km: km !== null && km >= 0 && km < 2_000_000 ? km : null,
      price: price !== null && price > 0 && price < 10_000_000 ? price : null,
      priceLabel: cleanText(v.priceLabel, 40),
      fuel: normalizeFuel(v.fuel),
      gearbox: normalizeGearbox(v.gearbox),
      powerCv: parseInteger(v.powerCv),
      bodyType: null,
      color: null,
      country: normalizeCountry(v.country) ?? normalizeCountry(v.location) ?? opts.map?.defaultCountry ?? null,
      location: cleanText(v.location, 120),
      auctionEndsAt: null,
      imageUrl: null,
      raw: { ai: true },
    });
  }
  return [...out.values()];
}
