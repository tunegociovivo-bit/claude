/**
 * SerpApi — lectura de reseñas públicas de Google Maps (cliente, competencia e historial de
 * cada autor) para el Detector de reseñas falsas del GMB Hub.
 *
 * La API oficial de Business Profile sólo devuelve reseñas de fichas propias y Places sólo 5
 * reseñas por ficha: para cruzar autores con la competencia hace falta un proveedor SERP.
 * Engines: google_maps, google_maps_reviews, google_maps_contributor_reviews.
 *
 * Key en Workspace.settings.integrations.gmb.serpApiKeyEnc (fallback env SERPAPI_KEY).
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

export class SerpApiKeyMissingError extends Error {
  constructor() {
    super("Falta la API key de SerpApi. Configúrala en GMB Hub → Ajustes.");
  }
}

export class SerpApiError extends Error {}

/** Limpia una key pegada: espacios, saltos de línea, comillas, caracteres invisibles y prefijos «api_key=». */
export function cleanSerpApiKey(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .replace(/^.*api_key=/i, "")
    .replace(/[\s"'`]/g, "")
    .replace(/&.*$/, "");
}

/** Las keys de SerpApi son 64 caracteres hexadecimales. */
export function looksLikeSerpApiKey(k: string): boolean {
  return /^[a-f0-9]{64}$/i.test(k);
}

export function maskKey(k: string): string {
  return k ? `${k.length} caracteres, termina en …${k.slice(-4)}` : "";
}

export async function getSerpApiKey(workspaceId: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  if (g.serpApiKeyEnc) {
    const k = cleanSerpApiKey(decryptSecret(g.serpApiKeyEnc) ?? "");
    if (k) return k;
  }
  return process.env.SERPAPI_KEY ?? null;
}

export type SerpParams = Record<string, string | number>;

/** Fuente de reseñas usada por el detector (SerpApi o Serper con respuestas en formato SerpApi). */
export interface ReviewSource {
  readonly provider: "serpapi" | "serper";
  /** ¿Puede leer el historial de reseñas de un perfil? (sólo SerpApi) */
  readonly supportsContributor: boolean;
  calls: number;
  searchPlaces(q: string, ll?: string): Promise<any>;
  reviews(id: { data_id?: string; place_id?: string }, sortBy: string, nextPageToken?: string): Promise<any>;
  contributor(contributorId: string): Promise<any>;
}
export type SerpTransport = (params: SerpParams) => Promise<any>;

const CACHE_DAYS = 7;

/** Cliente con caché en BD y contador de llamadas reales. */
export class SerpApiClient implements ReviewSource {
  readonly provider = "serpapi" as const;
  readonly supportsContributor = true;
  calls = 0;
  constructor(
    private key: string,
    private opts: { hl?: string; gl?: string; cacheDays?: number; transport?: SerpTransport } = {}
  ) {}

  get hl() {
    return this.opts.hl ?? "es";
  }
  get gl() {
    return this.opts.gl ?? "es";
  }

  async request(params: SerpParams, useCache = true): Promise<any> {
    const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
    const key = createHash("sha1").update(JSON.stringify(sorted)).digest("hex");
    const cacheDays = this.opts.cacheDays ?? CACHE_DAYS;
    if (useCache && cacheDays > 0) {
      const hit = await prisma.gmbSerpCache.findUnique({ where: { key } }).catch(() => null);
      if (hit && hit.expiresAt > new Date()) return hit.payload as any;
    }

    let data: any;
    if (this.opts.transport) {
      data = await this.opts.transport(sorted);
    } else {
      const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(sorted).map(([k, v]) => [k, String(v)])), api_key: this.key, output: "json" });
      const r = await fetch(`https://serpapi.com/search.json?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
      data = await r.json().catch(() => null);
      if (!r.ok && !data?.error) throw new SerpApiError(`SerpApi HTTP ${r.status}`);
    }
    this.calls++;

    if (!data || typeof data !== "object") throw new SerpApiError("SerpApi: respuesta vacía");
    if (data.error) {
      if (/hasn't returned any results/i.test(String(data.error))) {
        data = { reviews: [], local_results: [] };
      } else {
        const hint = /invalid api key/i.test(String(data.error))
          ? " → La key guardada no es válida: vuelve a pegarla en GMB Hub → Ajustes (ahora se comprueba al guardar)."
          : "";
        throw new SerpApiError(`SerpApi: ${data.error}${hint}`);
      }
    }

    if (useCache && cacheDays > 0) {
      const expiresAt = new Date(Date.now() + cacheDays * 86_400_000);
      await prisma.gmbSerpCache
        .upsert({ where: { key }, create: { key, payload: data, expiresAt }, update: { payload: data, expiresAt } })
        .catch(() => undefined);
    }
    return data;
  }

  searchPlaces(q: string, ll?: string) {
    const p: SerpParams = { engine: "google_maps", type: "search", q, hl: this.hl, gl: this.gl };
    if (ll) p.ll = ll;
    return this.request(p);
  }

  /** Primera página: 8 reseñas (SerpApi no admite num); siguientes: 20. */
  reviews(id: { data_id?: string; place_id?: string }, sortBy: string, nextPageToken?: string) {
    const p: SerpParams = { engine: "google_maps_reviews", hl: this.hl, sort_by: sortBy };
    if (id.data_id) p.data_id = id.data_id;
    else if (id.place_id) p.place_id = id.place_id;
    if (nextPageToken) {
      p.next_page_token = nextPageToken;
      p.num = 20;
    }
    return this.request(p);
  }

  contributor(contributorId: string) {
    return this.request({ engine: "google_maps_contributor_reviews", contributor_id: contributorId, hl: this.hl, gl: this.gl, num: 200 });
  }
}

/** Créditos restantes (no consume búsquedas). */
export async function serpApiAccount(key: string): Promise<{ left: number | null; plan: string }> {
  const r = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new SerpApiError(d?.error ?? `HTTP ${r.status}`);
  return { left: d.total_searches_left ?? d.plan_searches_left ?? null, plan: d.plan_name ?? "" };
}

export async function purgeSerpCache() {
  await prisma.gmbSerpCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
