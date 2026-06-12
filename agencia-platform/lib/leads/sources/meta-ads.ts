/**
 * Collector de leads desde la Meta Ad Library (biblioteca de anuncios de
 * Facebook/Instagram). La señal nº1 de "ticket alto": un negocio que YA paga
 * publicidad tiene presupuesto y está abierto a marketing → conversación
 * caliente desde el minuto 1.
 *
 * Usa la API pública de transparencia (`ads_archive` del Graph API). En la UE,
 * por la DSA, son consultables TODOS los anunciantes activos por país +
 * término de búsqueda. Devolvemos cada ANUNCIANTE (page_name) como un lead con
 * rawData.runsAds=true; el teléfono se enriquece después vía Google Places.
 *
 * Requiere un token de acceso de Meta en META_ADS_TOKEN (un app token
 * `APPID|APPSECRET` sirve) o en Ajustes del workspace (settings.leads.metaAdsToken).
 */

import type { PlacesResult } from "../google-places";
import { detectSector } from "../ticket-score";

const GRAPH = "https://graph.facebook.com/v21.0/ads_archive";

export async function collectMetaAds(opts: {
  keyword: string;
  location?: string;
  token: string;
  limit?: number;
}): Promise<PlacesResult[]> {
  const term = opts.keyword?.trim();
  if (!term) throw new Error("Meta Ad Library necesita un término de búsqueda (keyword).");

  const params = new URLSearchParams({
    access_token: opts.token,
    ad_reached_countries: JSON.stringify(["ES"]),
    ad_active_status: "ACTIVE",
    ad_type: "ALL",
    search_terms: term,
    fields: "page_id,page_name,ad_delivery_start_time,publisher_platforms",
    limit: String(Math.min(opts.limit ?? 200, 250))
  });

  let json: any;
  try {
    const resp = await fetch(`${GRAPH}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    json = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = json?.error?.message ?? `HTTP ${resp.status}`;
      throw new Error(`Meta Ad Library: ${msg}`);
    }
  } catch (e: any) {
    throw new Error(`Meta Ad Library: ${e?.message ?? e}`);
  }

  const ads: any[] = Array.isArray(json?.data) ? json.data : [];
  const loc = opts.location?.trim();

  // Agrupamos por anunciante (page): un negocio con 30 anuncios es UN lead.
  const byPage = new Map<string, { pageId: string; name: string; platforms: Set<string>; ads: number }>();
  for (const a of ads) {
    const name = String(a?.page_name ?? "").trim();
    if (!name) continue;
    const pageId = String(a?.page_id ?? name);
    let p = byPage.get(pageId);
    if (!p) {
      p = { pageId, name, platforms: new Set(), ads: 0 };
      byPage.set(pageId, p);
    }
    p.ads++;
    for (const pl of arr(a?.publisher_platforms)) p.platforms.add(String(pl));
  }

  const out: PlacesResult[] = [];
  for (const p of byPage.values()) {
    const sector = detectSector({ name: p.name });
    out.push({
      placeId: `meta_ads:${p.pageId}`,
      name: p.name,
      formattedAddress: loc ? `${loc} (anunciante Meta)` : null,
      province: loc ?? null,
      types: ["meta_ads.advertiser", ...Array.from(p.platforms).map((x) => `platform.${x}`)],
      category: sector ? sector.label : "Anunciante activo (Meta)",
      latitude: null,
      longitude: null,
      rating: null,
      userRatingCount: 0,
      priceLevel: null,
      businessStatus: "OPERATIONAL",
      gmbUrl: `https://www.facebook.com/${p.pageId}`,
      website: null,
      phone: null,
      internationalPhone: null,
      // runsAds=true → +25 en el ticket score; activeAds para priorizar a los
      // que más invierten (más anuncios activos = más presupuesto).
      rawData: { source: "meta_ads", runsAds: true, pageId: p.pageId, activeAds: p.ads, sector: sector?.key ?? null }
    });
  }

  // Los que más anuncios tienen primero (más presupuesto).
  out.sort((a, b) => ((b.rawData as any).activeAds ?? 0) - ((a.rawData as any).activeAds ?? 0));
  return out;
}

function arr<T = any>(x: any): T[] {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  return [x];
}
