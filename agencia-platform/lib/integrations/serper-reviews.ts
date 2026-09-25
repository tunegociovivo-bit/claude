/**
 * Serper.dev como fuente alternativa de reseñas de Google Maps para el Detector de reseñas falsas.
 * Reutiliza la key del Publicador SEO (settings.seoBlog.serperApiKey / SERPER_API_KEY).
 *
 * Expone la MISMA interfaz que SerpApiClient y traduce las respuestas al formato de SerpApi
 * (reviews[].iso_date/snippet/user, serpapi_pagination, local_results…), así el motor no cambia.
 * Limitación: Serper no ofrece el historial de reseñas de un perfil (contributor), así que la
 * detección automática usa un barrido de competencia cercana en lugar del historial.
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import type { ReviewSource } from "@/lib/integrations/serpapi";
import { SerpApiError, type SerpParams } from "@/lib/integrations/serpapi";

type Transport = (path: string, body: Record<string, any>) => Promise<any>;

const SORT: Record<string, string> = {
  ratingLow: "lowestRating",
  newestFirst: "newest",
  ratingHigh: "highestRating",
  qualityScore: "mostRelevant"
};

function contribIdFromLink(link: string): string {
  const m = String(link ?? "").match(/\/contrib\/(\d+)/);
  return m ? m[1] : "";
}

/** Reseña Serper → forma SerpApi. */
export function serperReviewToSerpApi(r: any): any {
  const u = r?.user ?? {};
  return {
    rating: r?.rating,
    iso_date: r?.isoDate ?? r?.iso_date ?? "",
    date: r?.date ?? "",
    snippet: r?.snippet ?? r?.text ?? "",
    review_id: r?.id ?? r?.reviewId ?? r?.review_id ?? "",
    link: r?.link ?? "",
    likes: r?.likes ?? 0,
    images: Array.isArray(r?.media) ? r.media : Array.isArray(r?.images) ? r.images : [],
    response: r?.response ?? null,
    user: {
      name: u.name ?? "",
      link: u.link ?? "",
      contributor_id: u.contributorId ?? u.contributor_id ?? contribIdFromLink(u.link),
      thumbnail: u.thumbnail ?? "",
      local_guide: !!(u.localGuide ?? u.local_guide ?? /local guide/i.test(String(u.description ?? ""))),
      reviews: u.reviews ?? u.numberOfReviews ?? 0,
      photos: u.photos ?? 0
    }
  };
}

/** Lugar de Serper (/maps) → forma SerpApi (local_results). */
export function serperPlaceToSerpApi(p: any): any {
  return {
    title: p?.title ?? "",
    address: p?.address ?? "",
    rating: p?.rating ?? null,
    reviews: p?.ratingCount ?? p?.reviews ?? null,
    type: p?.type ?? (Array.isArray(p?.types) ? p.types[0] : ""),
    data_id: p?.fid ?? "",
    place_id: p?.placeId ?? "",
    gps_coordinates: p?.latitude != null ? { latitude: p.latitude, longitude: p.longitude } : undefined,
    thumbnail: p?.thumbnailUrl ?? ""
  };
}

export class SerperReviewsClient implements ReviewSource {
  readonly provider = "serper" as const;
  readonly supportsContributor = false;
  calls = 0;

  constructor(
    private key: string,
    private opts: { hl?: string; gl?: string; cacheDays?: number; transport?: Transport } = {}
  ) {}

  private async post(path: string, body: Record<string, any>): Promise<any> {
    const cacheDays = this.opts.cacheDays ?? 7;
    const key = createHash("sha1").update(`serper${path}${JSON.stringify(Object.entries(body).sort())}`).digest("hex");
    if (cacheDays > 0) {
      const hit = await prisma.gmbSerpCache.findUnique({ where: { key } }).catch(() => null);
      if (hit && hit.expiresAt > new Date()) return hit.payload as any;
    }
    let data: any;
    if (this.opts.transport) {
      data = await this.opts.transport(path, body);
    } else {
      const r = await fetch(`https://google.serper.dev${path}`, {
        method: "POST",
        headers: { "X-API-KEY": this.key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000)
      });
      data = await r.json().catch(() => null);
      if (!r.ok) throw new SerpApiError(`Serper: ${data?.message ?? `HTTP ${r.status}`}`);
    }
    this.calls++;
    if (!data || typeof data !== "object") throw new SerpApiError("Serper: respuesta vacía");
    if (cacheDays > 0) {
      const expiresAt = new Date(Date.now() + cacheDays * 86_400_000);
      await prisma.gmbSerpCache.upsert({ where: { key }, create: { key, payload: data, expiresAt }, update: { payload: data, expiresAt } }).catch(() => undefined);
    }
    return data;
  }

  async searchPlaces(q: string, ll?: string) {
    const body: Record<string, any> = { q, gl: this.opts.gl ?? "es", hl: this.opts.hl ?? "es" };
    if (ll) body.ll = ll;
    const d = await this.post("/maps", body);
    const places = (d.places ?? []).map(serperPlaceToSerpApi);
    return { local_results: places };
  }

  async reviews(id: { data_id?: string; place_id?: string }, sortBy: string, nextPageToken?: string) {
    const body: Record<string, any> = { gl: this.opts.gl ?? "es", hl: this.opts.hl ?? "es", sortBy: SORT[sortBy] ?? "newest" };
    if (id.data_id) body.fid = id.data_id;
    if (id.place_id) body.placeId = id.place_id;
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const d = await this.post("/reviews", body);
    const out: any = { reviews: (d.reviews ?? []).map(serperReviewToSerpApi) };
    if (d.nextPageToken) out.serpapi_pagination = { next_page_token: d.nextPageToken };
    if (d.place || d.placeInfo) out.place_info = serperPlaceToSerpApi(d.place ?? d.placeInfo);
    return out;
  }

  async contributor(_cid: string): Promise<any> {
    throw new SerpApiError("El proveedor Serper no permite leer el historial de un perfil.");
  }

  // Compatibilidad con la firma de SerpApiClient.request (no se usa desde el motor).
  async request(_p: SerpParams): Promise<any> {
    throw new SerpApiError("No soportado");
  }
}
