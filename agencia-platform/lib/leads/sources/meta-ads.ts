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
import { placesTextSearch } from "../google-places";
import { detectSector } from "../ticket-score";

const GRAPH = "https://graph.facebook.com/v21.0/ads_archive";

export async function collectMetaAds(opts: {
  keyword: string;
  location?: string;
  token: string;
  limit?: number;
  /** Si se pasa, enriquece cada anunciante con Google Places (teléfono, web,
   *  rating…) para dejarlos listos para contactar por WhatsApp. */
  workspaceId?: string;
  /** Máx anunciantes a enriquecer (controla coste de Places). Default 40. */
  enrichMax?: number;
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

  // Enriquecimiento: los anunciantes de Meta llegan sin teléfono. Los cruzamos
  // con Google Places (nombre + zona) para sacar móvil/web/rating y dejarlos
  // listos para contactar por WhatsApp. Best-effort y acotado por coste.
  if (opts.workspaceId) {
    const max = Math.min(opts.enrichMax ?? 40, out.length);
    for (let i = 0; i < max; i++) {
      const lead = out[i];
      try {
        const hits = await placesTextSearch({
          workspaceId: opts.workspaceId,
          query: `${lead.name}${loc ? " " + loc : " España"}`,
          maxPages: 1,
          pageSize: 1,
          province: loc ?? undefined
        });
        const g = hits[0];
        if (!g) continue;
        // Adoptamos el placeId de Google → deduplica con leads de Places y
        // marca al negocio existente como anunciante (runsAds) si ya estaba.
        lead.placeId = g.placeId;
        lead.phone = g.phone ?? lead.phone;
        lead.internationalPhone = g.internationalPhone ?? lead.internationalPhone;
        lead.website = g.website ?? lead.website;
        lead.formattedAddress = g.formattedAddress ?? lead.formattedAddress;
        lead.province = g.province ?? lead.province;
        lead.latitude = g.latitude ?? lead.latitude;
        lead.longitude = g.longitude ?? lead.longitude;
        lead.rating = g.rating ?? lead.rating;
        lead.userRatingCount = g.userRatingCount ?? lead.userRatingCount;
        lead.priceLevel = g.priceLevel ?? lead.priceLevel;
        lead.gmbUrl = g.gmbUrl ?? lead.gmbUrl;
        if (g.category && (lead.category === "Anunciante activo (Meta)" || !lead.category)) lead.category = g.category;
        (lead.rawData as any).enrichedFromPlaces = true;
        (lead.rawData as any).googlePlaceId = g.placeId;
      } catch {
        // Sin key de Places o sin match → se queda como anunciante sin teléfono.
      }
    }
  }

  return out;
}

function arr<T = any>(x: any): T[] {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  return [x];
}
