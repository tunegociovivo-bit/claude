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
import { collectBorme } from "./borme";
import { collectMetaAds } from "./meta-ads";

export type LeadSourceKey =
  | "places"
  | "borme"
  | "meta_ads"
  | "trustpilot"
  | "doctoralia"
  | "idealista"
  | "fotocasa"
  | "linkedin";

/** Token de Meta para la Ad Library: env primero, si no, Ajustes del workspace. */
async function metaAdsToken(workspaceId: string): Promise<string | null> {
  const env = process.env.META_ADS_TOKEN || process.env.META_AD_LIBRARY_TOKEN;
  if (env) return env;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const t = (ws?.settings as any)?.leads?.metaAdsToken;
  return typeof t === "string" && t.trim() ? t.trim() : null;
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
    case "borme":
      return collectBorme({
        // En BORME usamos scope como atajo: custom=1 día, spain=últimos 7.
        daysBack: ctx.scope === "spain" ? 7 : 1,
        // Si el usuario indicó "location" (p. ej. "Barcelona"), filtramos.
        provinceFilter: ctx.location?.trim() || undefined,
        // Keyword "ticket alto" / "premium" / "valor" → solo sectores de alto valor.
        highValueOnly: /\b(alto|premium|ticket|valor)\b/i.test(ctx.keyword ?? "")
      });
    case "meta_ads": {
      const token = await metaAdsToken(ctx.workspaceId);
      if (!token) {
        throw new Error(
          "Meta Ad Library necesita un token. Configura META_ADS_TOKEN (un app token APPID|APPSECRET sirve) o settings.leads.metaAdsToken."
        );
      }
      return collectMetaAds({ keyword: ctx.keyword, location: ctx.location, token });
    }
    case "places":
      // El motor places vive en search-manager por razones históricas.
      throw new Error("places no usa collectFromSource — ve directamente a google-places.ts");
    default:
      throw new Error(STUB_MSG[source] ?? `Fuente desconocida: ${source}`);
  }
}

export const LEAD_SOURCE_META: Record<LeadSourceKey, { label: string; status: "ready" | "stub"; help: string }> = {
  places: { label: "Google Places", status: "ready", help: "Negocios listados en Google Maps." },
  borme: {
    label: "BORME (constituciones)",
    status: "ready",
    help:
      "Sociedades recién constituidas en España. Captación a empresas día-1 sin web ni GMB. Tip: pon keyword \"ticket alto\" para filtrar solo sectores premium (dental, abogados, inmobiliaria, reformas…)."
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
    label: "Doctoralia",
    status: "stub",
    help: "Médicos, dentistas, fisios. Pendiente: configurar scraper."
  },
  idealista: {
    label: "Idealista",
    status: "stub",
    help: "Inmobiliarias listadas en Idealista. Pendiente: acuerdo de API."
  },
  fotocasa: {
    label: "Fotocasa",
    status: "stub",
    help: "Inmobiliarias listadas en Fotocasa. Pendiente: configurar scraper."
  },
  linkedin: {
    label: "LinkedIn Sales Navigator",
    status: "stub",
    help: "Leads B2B. Pendiente: integrar PhantomBuster/Apollo."
  }
};
