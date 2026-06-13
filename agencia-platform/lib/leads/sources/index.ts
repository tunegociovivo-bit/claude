/**
 * Registro de fuentes de leads. Cada `source` (places, borme, trustpilot,
 * doctoralia, idealista, fotocasa, linkedin) tiene un collector que devuelve
 * PlacesResult[] compatible con upsertLead.
 *
 * - "places" tiene su flujo histórico en search-manager.ts directamente
 *   (loop por provincias con google-places.ts); no pasa por aquí.
 * - El resto SÍ pasan por este dispatcher.
 */

import type { PlacesResult } from "../google-places";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";
import { collectBorme } from "./borme";
import { collectMetaAds } from "./meta-ads";
import { collectBdns } from "./bdns";
import { scrapeDirectory } from "./scrape";
import { detectSector } from "../ticket-score";

export type LeadSourceKey =
  | "places"
  | "borme"
  | "bdns"
  | "meta_ads"
  | "trustpilot"
  | "doctoralia"
  | "idealista"
  | "fotocasa"
  | "linkedin";

/** Token de Meta para la Ad Library: env primero, si no, Ajustes del workspace
 *  (cifrado metaAdsTokenEnc o, legacy, texto plano metaAdsToken). */
async function metaAdsToken(workspaceId: string): Promise<string | null> {
  const env = process.env.META_ADS_TOKEN || process.env.META_AD_LIBRARY_TOKEN;
  if (env) return env;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const leads: any = (ws?.settings as any)?.leads ?? {};
  const dec = leads.metaAdsTokenEnc ? decryptSecret(leads.metaAdsTokenEnc) : null;
  const plain = typeof leads.metaAdsToken === "string" ? leads.metaAdsToken : null;
  const t = dec ?? plain;
  return t && t.trim() ? t.trim() : null;
}

/** API key de Scrapfly: env primero, si no, Ajustes del workspace (cifrado). */
async function scrapflyKey(workspaceId: string): Promise<string | null> {
  const env = process.env.SCRAPFLY_API_KEY;
  if (env) return env;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const leads: any = (ws?.settings as any)?.leads ?? {};
  const dec = leads.scrapflyApiKeyEnc ? decryptSecret(leads.scrapflyApiKeyEnc) : null;
  return dec && dec.trim() ? dec.trim() : null;
}

export type CollectorContext = {
  workspaceId: string;
  keyword: string;
  location: string;
  scope: "custom" | "spain";
};

const STUB_MSG: Record<string, string> = {
  trustpilot:
    "Trustpilot necesita acceso al scraper externo. Configura SCRAPFLY_API_KEY o equivalente en Ajustes para activar.",
  doctoralia:
    "Doctoralia necesita acceso al scraper externo. Configura el scraper de Doctoralia en Ajustes para activar.",
  idealista:
    "Idealista requiere acuerdo de API (api.idealista.com). Configura IDEALISTA_API_KEY en Ajustes para activar.",
  fotocasa:
    "Fotocasa necesita acceso al scraper externo. Configura el scraper de Fotocasa en Ajustes para activar.",
  linkedin:
    "LinkedIn requiere PhantomBuster / Apollo / Scrapfly. Configura LINKEDIN_SCRAPER_KEY en Ajustes para activar."
};

export async function collectFromSource(
  source: LeadSourceKey,
  ctx: CollectorContext
): Promise<PlacesResult[]> {
  switch (source) {
    case "borme": {
      // Keyword "capital" o "capital 60000" → filtra por capital social mínimo
      // (baja el detalle de cada anuncio). Default 30.000 € si no se indica nº.
      const kw = ctx.keyword ?? "";
      let minCapital: number | undefined;
      if (/\bcapital\b/i.test(kw)) {
        const m = kw.match(/\bcapital\D*([\d.]{4,})/i);
        minCapital = m ? parseInt(m[1].replace(/\./g, ""), 10) : 30000;
        if (!Number.isFinite(minCapital)) minCapital = 30000;
      }
      // Keyword "directivos"/"cargos"/"administradores" → mina los nombramientos
      // del Registro Mercantil para captar al DIRECTIVO por su nombre.
      const cargosMode = /\b(directiv|cargos?|administrador|consejero|nombramiento)/i.test(kw);
      // Si el keyword nombra un sector (p.ej. "clínica dental"), filtramos el
      // BORME a ese sector — si no, traería TODAS las constituciones del día.
      const sectorFilter = detectSector({ name: kw })?.key;
      return collectBorme({
        // `daysBack` = nº de DÍAS PUBLICADOS a reunir (cruza findes/festivos).
        // custom=4 días hábiles recientes; spain=8 (más muestra para sectores).
        daysBack: ctx.scope === "spain" ? 8 : 4,
        // Si el usuario indicó "location" (p. ej. "Barcelona"), filtramos.
        provinceFilter: ctx.location?.trim() || undefined,
        // Keyword "ticket alto" / "premium" / "valor" → solo sectores de alto valor.
        highValueOnly: /\b(alto|premium|ticket|valor)\b/i.test(kw),
        minCapital,
        mode: cargosMode ? "cargos" : "constituciones",
        sectorFilter
      });
    }
    case "bdns": {
      // Negocios que acaban de cobrar una subvención (presupuesto fresco).
      // Keyword con un número (p.ej. "20000") → importe mínimo concedido.
      const kw = ctx.keyword ?? "";
      const m = kw.match(/(\d[\d.]{3,})/);
      const minImporte = m ? parseInt(m[1].replace(/\./g, ""), 10) : undefined;
      return enrichMissingPhones(
        ctx.workspaceId,
        await collectBdns({
          daysBack: ctx.scope === "spain" ? 30 : 14,
          provinceFilter: ctx.location?.trim() || undefined,
          minImporte: Number.isFinite(minImporte as number) ? minImporte : undefined
        })
      );
    }
    case "meta_ads": {
      const token = await metaAdsToken(ctx.workspaceId);
      if (!token) {
        throw new Error(
          "Meta Ad Library necesita un token. Configura META_ADS_TOKEN (un app token APPID|APPSECRET sirve) o settings.leads.metaAdsToken."
        );
      }
      return collectMetaAds({ keyword: ctx.keyword, location: ctx.location, token, workspaceId: ctx.workspaceId });
    }
    case "doctoralia": {
      const key = await scrapflyKey(ctx.workspaceId);
      if (!key) throw new Error("Doctoralia necesita la API key de Scrapfly. Configúrala en Ajustes de Leads.");
      return enrichMissingPhones(
        ctx.workspaceId,
        await scrapeDirectory(
          {
            idPrefix: "doctoralia",
            defaultCategory: "Clínica / profesional sanitario",
            buildUrl: (kw, loc) => `https://www.doctoralia.es/buscar?q=${encodeURIComponent(kw)}&loc=${encodeURIComponent(loc)}`
          },
          ctx.keyword,
          ctx.location || "España",
          key
        )
      );
    }
    case "idealista": {
      const key = await scrapflyKey(ctx.workspaceId);
      if (!key) throw new Error("Idealista necesita la API key de Scrapfly. Configúrala en Ajustes de Leads.");
      return enrichMissingPhones(
        ctx.workspaceId,
        await scrapeDirectory(
          {
            idPrefix: "idealista",
            defaultCategory: "Inmobiliaria / promotora",
            buildUrl: (kw, loc) =>
              `https://www.idealista.com/buscar/venta-viviendas/${encodeURIComponent(slug(loc || "espana"))}/?q=${encodeURIComponent(kw)}`
          },
          ctx.keyword,
          ctx.location || "España",
          key
        )
      );
    }
    case "fotocasa": {
      const key = await scrapflyKey(ctx.workspaceId);
      if (!key) throw new Error("Fotocasa necesita la API key de Scrapfly. Configúrala en Ajustes de Leads.");
      return enrichMissingPhones(
        ctx.workspaceId,
        await scrapeDirectory(
          {
            idPrefix: "fotocasa",
            defaultCategory: "Inmobiliaria / promotora",
            buildUrl: (kw, loc) =>
              `https://www.fotocasa.es/es/comprar/viviendas/${encodeURIComponent(slug(loc || "espana"))}/todas-las-zonas/l?q=${encodeURIComponent(kw)}`
          },
          ctx.keyword,
          ctx.location || "España",
          key
        )
      );
    }
    case "places":
      // El motor places vive en search-manager por razones históricas.
      throw new Error("places no usa collectFromSource — ve directamente a google-places.ts");
    default:
      throw new Error(STUB_MSG[source] ?? `Fuente desconocida: ${source}`);
  }
}

/** Slug simple para URLs de directorio ("A Coruña" → "a-coruna"). */
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Rellena el teléfono de los leads que llegan sin él (típico de directorios y
 * Meta Ads) cruzándolos con Google Places por nombre + zona. Best-effort y
 * acotado por coste; los que no tengan key de Places o match se quedan igual.
 */
async function enrichMissingPhones(workspaceId: string, leads: PlacesResult[], max = 40): Promise<PlacesResult[]> {
  const { placesTextSearch } = await import("../google-places");
  const targets = leads.filter((l) => !l.phone).slice(0, max);
  for (const lead of targets) {
    try {
      const hits = await placesTextSearch({
        workspaceId,
        query: `${lead.name} ${lead.province ?? "España"}`,
        maxPages: 1,
        pageSize: 1,
        province: lead.province ?? undefined
      });
      const g = hits[0];
      if (!g) continue;
      lead.placeId = g.placeId; // dedup con leads de Places
      lead.phone = g.phone ?? lead.phone;
      lead.internationalPhone = g.internationalPhone ?? lead.internationalPhone;
      lead.website = lead.website ?? g.website;
      lead.formattedAddress = lead.formattedAddress ?? g.formattedAddress;
      lead.latitude = lead.latitude ?? g.latitude;
      lead.longitude = lead.longitude ?? g.longitude;
      lead.rating = lead.rating ?? g.rating;
      if (!lead.userRatingCount) lead.userRatingCount = g.userRatingCount;
      lead.priceLevel = lead.priceLevel ?? g.priceLevel;
      (lead.rawData as any).enrichedFromPlaces = true;
    } catch {
      // sin key/ match → se queda sin teléfono
    }
  }
  return leads;
}

export const LEAD_SOURCE_META: Record<LeadSourceKey, { label: string; status: "ready" | "stub"; help: string }> = {
  places: { label: "Google Places", status: "ready", help: "Negocios listados en Google Maps." },
  borme: {
    label: "BORME (constituciones)",
    status: "ready",
    help:
      "Sociedades recién constituidas en España. Captación a empresas día-1 sin web ni GMB. Tip: pon keyword \"ticket alto\" para filtrar solo sectores premium (dental, abogados, inmobiliaria, reformas…)."
  },
  bdns: {
    label: "BDNS (acaban de recibir subvención)",
    status: "ready",
    help:
      "Negocios que acaban de cobrar una subvención pública → presupuesto fresco y ganas de invertir. Fuente pública gratuita. Tip: pon un número en el keyword (p.ej. \"20000\") para exigir un importe mínimo. El teléfono se enriquece con Google Places."
  },
  meta_ads: {
    label: "Meta Ad Library (ya anuncian)",
    status: "ready",
    help:
      "Negocios que YA pagan anuncios en Facebook/Instagram por tu sector → ticket alto y abiertos a marketing. Requiere META_ADS_TOKEN. El teléfono se enriquece después con Google Places."
  },
  trustpilot: {
    label: "Trustpilot (reseñas bajas)",
    status: "stub",
    help: "Negocios con reseñas <3,5 → leads urgentes. Pendiente: configurar scraper."
  },
  doctoralia: {
    label: "Doctoralia (clínicas)",
    status: "ready",
    help: "Médicos, dentistas, fisios (ticket alto). Requiere SCRAPFLY_API_KEY. El teléfono se enriquece con Google Places."
  },
  idealista: {
    label: "Idealista (inmobiliarias)",
    status: "ready",
    help: "Inmobiliarias y promotoras listadas en Idealista. Requiere SCRAPFLY_API_KEY. El teléfono se enriquece con Google Places."
  },
  fotocasa: {
    label: "Fotocasa (inmobiliarias)",
    status: "ready",
    help: "Inmobiliarias listadas en Fotocasa. Requiere SCRAPFLY_API_KEY. El teléfono se enriquece con Google Places."
  },
  linkedin: {
    label: "LinkedIn Sales Navigator",
    status: "stub",
    help: "Leads B2B. Pendiente: integrar PhantomBuster/Apollo."
  }
};
