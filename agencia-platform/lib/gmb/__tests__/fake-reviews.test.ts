import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/anthropic", () => ({ complete: vi.fn(), DEFAULT_MODEL: "test-model" }));

import { SerpApiClient } from "@/lib/integrations/serpapi";
import { SerperReviewsClient, serperReviewToSerpApi } from "@/lib/integrations/serper-reviews";
import { initState, tick, type JobState } from "@/lib/gmb/fake-reviews/job";
import { parsePlaceInput, relativeToTs, normalizeReview, type AnalysisParams, type Place } from "@/lib/gmb/fake-reviews/core";
import { similarity, type AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

const NOW = Math.floor(Date.parse("2026-09-20T00:00:00Z") / 1000);
const DAY = 86400;
const iso = (ts: number) => new Date(ts * 1000).toISOString();

const place = (o: Partial<Place>): Place => ({
  title: "", address: "", rating: null, reviews: null, type: "Clínica capilar", dataId: "", placeId: "",
  lat: 36.51, lng: -4.885, thumbnail: "", mapsUrl: "", ...o
});
const CLIENT = place({ title: "Clínica Sol", dataId: "0xaaaaaa:0x111111", rating: 4.3, reviews: 260 });
const COMP = place({ title: "Capilar Premium", dataId: "0xbbbbbb:0x222222", rating: 4.8, reviews: 410, lat: 36.512, lng: -4.88 });
const SUPER = place({ title: "Supermercado Centro", dataId: "0xeeeeee:0x555555", type: "Supermercado", lat: 36.51, lng: -4.88 });
const OTHER = place({ title: "Injerto Málaga", dataId: "0xcccccc:0x333333", lat: 36.72, lng: -4.42 });

type H = { place: Place; rating: number; ts: number };
type A = { name: string; total: number; lg: boolean; level?: number; history: H[] };

function scenario() {
  const authors: Record<string, A> = {};
  const clientRevs: any[] = [];
  const compRevs: any[] = [];
  // 6 perfiles falsos: 1★ al cliente y 5★ al competidor el mismo día, cuentas nuevas.
  for (let i = 1; i <= 6; i++) {
    const cid = `10000000000000000${i}`;
    const t = NOW - (20 + i * 15) * DAY;
    authors[cid] = { name: `Falso ${i}`, total: 2, lg: false, history: [{ place: CLIENT, rating: 1, ts: t }, { place: COMP, rating: 5, ts: t + DAY / 2 }] };
    if (i === 3) authors[cid].history.push({ place: OTHER, rating: 1, ts: t - 3 * DAY }, { place: { ...OTHER, dataId: "0xdddddd:0x444444", title: "Hair Fuengirola" }, rating: 1, ts: t - 5 * DAY });
    clientRevs.push({ rating: 1, ts: t, cid, text: i % 2 ? "" : `Horrible, no vayáis ${i}` });
    // 5 y 6 no aparecen en el listado del competidor: sólo los descubre la investigación profunda.
    if (i <= 4) compRevs.push({ rating: 5, ts: t + DAY / 2, cid, text: "Los mejores" });
  }
  // Local Guide real que visitó ambos hace mucho.
  const lg = "20000000000000001";
  const tlg = NOW - 100 * DAY;
  authors[lg] = { name: "Local Guide", total: 150, lg: true, level: 7, history: [{ place: CLIENT, rating: 2, ts: tlg }, { place: COMP, rating: 4, ts: tlg - 400 * DAY }] };
  clientRevs.push({ rating: 2, ts: tlg, cid: lg, text: "Esperaba más de la consulta, fue demasiado rápida.", img: 1 });
  // Clientes descontentos normales.
  for (let i = 0; i < 8; i++) {
    const cid = `3000000000000000${i}`;
    const t = NOW - (10 + i * 30) * DAY;
    authors[cid] = { name: `Cliente ${i}`, total: 40, lg: false, level: 3, history: [{ place: CLIENT, rating: 2, ts: t }] };
    // 3 clientes reales comparten un supermercado popular: coincidencia de otro sector (no debe elegirse).
    if (i < 3) authors[cid].history.push({ place: SUPER, rating: 5, ts: t - 200 * DAY });
    clientRevs.push({ rating: 2, ts: t, cid, text: `Mala experiencia ${i}: cita retrasada ${i * 7} minutos y poca información.` });
  }
  for (let i = 0; i < 20; i++) clientRevs.push({ rating: 5, ts: NOW - i * DAY, cid: `9${i}`, text: "Genial" });
  for (let i = 0; i < 40; i++) compRevs.push({ rating: 5, ts: NOW - i * 5 * DAY, cid: `8${i}`, text: "Bien" });
  clientRevs.sort((a, b) => a.rating - b.rating);
  compRevs.sort((a, b) => b.ts - a.ts);

  const user = (cid: string) => {
    const a = authors[cid] ?? { name: `Anon ${cid}`, total: 5, lg: false };
    return { name: a.name, link: `https://www.google.com/maps/contrib/${cid}?hl=es`, contributor_id: cid, local_guide: a.lg, reviews: a.total };
  };
  const page = (list: any[], token: string | undefined, info: Place) => {
    const off = token ? Number(token) : 0;
    const n = off ? 20 : 8;
    const out: any = {
      place_info: { title: info.title },
      reviews: list.slice(off, off + n).map((r) => ({
        rating: r.rating, iso_date: iso(r.ts), snippet: r.text, review_id: `rv_${info.dataId}_${r.cid}`, link: `https://maps/r/${r.cid}`, user: user(r.cid), images: r.img ? [{}] : []
      }))
    };
    if (off + n < list.length) out.serpapi_pagination = { next_page_token: String(off + n) };
    return out;
  };
  const transport = async (p: any) => {
    if (p.engine === "google_maps_reviews") return p.data_id === CLIENT.dataId ? page(clientRevs, p.next_page_token, CLIENT) : page(compRevs, p.next_page_token, COMP);
    if (p.engine === "google_maps_contributor_reviews") {
      const a = authors[p.contributor_id];
      return {
        contributor: { name: a.name, local_guide: a.lg, level: a.level ?? 0, contributions: { reviews: a.total } },
        reviews: a.history.map((h) => ({
          place_info: { title: h.place.title, data_id: h.place.dataId, type: h.place.type, gps_coordinates: { latitude: h.place.lat, longitude: h.place.lng } },
          rating: h.rating, iso_date: iso(h.ts), snippet: "", link: "https://maps/x"
        }))
      };
    }
    throw new Error("engine inesperado");
  };
  // Misma escena servida con el formato de Serper.dev (/maps y /reviews, sin historial de perfiles).
  const serperTransport = async (path: string, body: any) => {
    if (path === "/maps") {
      return {
        places: [CLIENT, COMP, SUPER, OTHER].map((p) => ({
          title: p.title, address: "", latitude: p.lat, longitude: p.lng, rating: p.rating, ratingCount: p.reviews, type: p.type, fid: p.dataId
        }))
      };
    }
    if (path === "/reviews") {
      const sortBy = body.sortBy === "lowestRating" ? "ratingLow" : "newestFirst";
      const sp = await transport({ engine: "google_maps_reviews", data_id: body.fid, sort_by: sortBy, next_page_token: body.nextPageToken });
      const list = body.fid === CLIENT.dataId || body.fid === COMP.dataId ? sp.reviews : [];
      return {
        reviews: list.map((r: any) => ({
          rating: r.rating, isoDate: r.iso_date, snippet: r.snippet, id: r.review_id, media: r.images,
          user: { name: r.user.name, link: r.user.link, reviews: r.user.reviews }
        })),
        ...(list.length && sp.serpapi_pagination ? { nextPageToken: sp.serpapi_pagination.next_page_token } : {})
      };
    }
    throw new Error("ruta inesperada");
  };
  return { transport, serperTransport };
}

async function runAll(params: AnalysisParams, api: SerpApiClient, summarize?: (r: AnalysisResults) => Promise<string>) {
  const state: JobState = initState(params);
  let results: AnalysisResults | null = null;
  for (let i = 0; i < 200 && state.phase !== "done"; i++) {
    const r = await tick(params, state, { api, summarize });
    if (r) results = r;
  }
  return { state, results: results! };
}

const baseParams = (o: Partial<AnalysisParams> = {}): AnalysisParams => ({
  client: CLIENT, competitors: [COMP], negThreshold: 2, posThreshold: 4, windowDays: 30, dateFrom: "", deep: true, ai: false,
  maxClientPages: 15, maxCompPages: 25, maxDeep: 80, ...o
});

describe("detector de reseñas falsas", () => {
  it("detecta los perfiles falsos (incluidos los que sólo aparecen en su historial) y no penaliza a clientes reales", async () => {
    const { transport } = scenario();
    const api = new SerpApiClient("k", { cacheDays: 0, transport });
    const { results } = await runAll(baseParams(), api);
    const byName = Object.fromEntries(results.authors.map((a) => [a.name, a]));

    for (let i = 1; i <= 6; i++) {
      expect(byName[`Falso ${i}`].level).toBe("alto");
      expect(byName[`Falso ${i}`].crossPos).toBe(1);
    }
    expect(byName["Falso 3"].signals.map((s) => s.code)).toContain("sector_attack");
    expect(byName["Local Guide"].level).toBe("bajo"); // cruce antiguo + perfil creíble
    for (let i = 0; i < 8; i++) expect(byName[`Cliente ${i}`].level).toBe("bajo");

    expect(results.stats.clientNeg).toBe(15);
    expect(results.stats.high).toBe(6);
    expect(results.impact.client!.without).toBeGreaterThan(4.3);
    // Paginación ratingLow: se detiene al llegar a las positivas.
    expect(api.calls).toBeLessThanOrEqual(2 + 3 + 15); // cliente (corta en positivas) + competidor + 15 perfiles
  });

  it("sin investigación profunda sólo cruza los que aparecen en el listado del competidor", async () => {
    const { transport } = scenario();
    const api = new SerpApiClient("k", { cacheDays: 0, transport });
    const { results } = await runAll(baseParams({ deep: false }), api);
    expect(results.stats.authorsCrossPos).toBe(4); // sólo los 4 falsos listados en el competidor
    expect(results.stats.profilesDeep).toBe(0);
  });

  it("añade el resumen de IA y no rompe si la IA falla", async () => {
    const { transport } = scenario();
    const ok = await runAll(baseParams({ ai: true, deep: false }), new SerpApiClient("k", { cacheDays: 0, transport }), async () => "Resumen");
    expect(ok.results.aiSummary).toBe("Resumen");
    const ko = await runAll(baseParams({ ai: true, deep: false }), new SerpApiClient("k", { cacheDays: 0, transport }), async () => {
      throw new Error("sin clave");
    });
    expect(ko.state.phase).toBe("done");
    expect(ko.results.warnings?.join(" ")).toContain("sin clave");
  });

  it("filtra por fecha de inicio", async () => {
    const { transport } = scenario();
    const from = new Date((NOW - 60 * DAY) * 1000).toISOString().slice(0, 10);
    const { results } = await runAll(baseParams({ dateFrom: from }), new SerpApiClient("k", { cacheDays: 0, transport }));
    expect(results.authors.every((a) => a.clientReviews.every((r) => r.ts >= NOW - 61 * DAY))).toBe(true);
  });
});

describe("detección automática de competencia", () => {
  it("descubre al competidor que recibe positivas de los autores de negativas y descarta otros sectores", async () => {
    const { transport } = scenario();
    const api = new SerpApiClient("k", { cacheDays: 0, transport });
    const { results, state } = await runAll(baseParams({ mode: "auto", competitors: [], minOverlap: 2 }), api);
    const d = results.discovery!;
    expect(d.mode).toBe("auto");
    const comp = d.candidates.find((c) => c.dataId === COMP.dataId)!;
    expect(comp.count).toBe(7); // 6 falsos + Local Guide
    expect(comp.sameSector).toBe(true);
    expect(comp.selected).toBe(true);
    const sup = d.candidates.find((c) => c.dataId === SUPER.dataId)!;
    expect(sup.count).toBe(3);
    expect(sup.selected).toBe(false);
    expect(results.competitors.map((c) => c.dataId)).toEqual([COMP.dataId]);
    const byName = Object.fromEntries(results.authors.map((a) => [a.name, a]));
    for (let i = 1; i <= 6; i++) expect(byName[`Falso ${i}`].level).toBe("alto");
    expect(byName["Cliente 0"].level).toBe("bajo");
    expect(results.findings[0]).toContain("Detección automática");
    expect(state.phase).toBe("done");
  });

  it("sin coincidencias suficientes no elige competidores y lo explica", async () => {
    const { transport } = scenario();
    const { results } = await runAll(baseParams({ mode: "auto", competitors: [], minOverlap: 10 }), new SerpApiClient("k", { cacheDays: 0, transport }));
    expect(results.competitors).toHaveLength(0);
    expect(results.discovery!.candidates).toHaveLength(0);
    expect(results.warnings?.join(" ")).toContain("No se han encontrado negocios");
  });

  it("en modo manual con investigación profunda también lista otros negocios con autores en común", async () => {
    const { transport } = scenario();
    const { results } = await runAll(baseParams(), new SerpApiClient("k", { cacheDays: 0, transport }));
    expect(results.discovery!.mode).toBe("manual");
    // El competidor indicado se excluye; queda el supermercado (3 perfiles).
    expect(results.discovery!.candidates.map((c) => c.dataId)).toEqual([SUPER.dataId]);
  });
});

describe("proveedor Serper (sin historial de perfiles)", () => {
  it("modo manual: cruce directo y avisa de que no hay investigación profunda", async () => {
    const { serperTransport } = scenario();
    const api = new SerperReviewsClient("k", { cacheDays: 0, transport: serperTransport });
    const { results } = await runAll(baseParams({ deep: true }), api);
    expect(api.supportsContributor).toBe(false);
    expect(results.stats.authorsCrossPos).toBe(4);
    expect(results.stats.profilesDeep).toBe(0);
    expect(results.warnings?.join(" ")).toContain("Serper");
    const byName = Object.fromEntries(results.authors.map((a) => [a.name, a]));
    expect(byName["Falso 1"].level).toBe("alto");
  });

  it("modo auto: barrido de negocios cercanos del mismo sector y selección del beneficiado", async () => {
    const { serperTransport } = scenario();
    const api = new SerperReviewsClient("k", { cacheDays: 0, transport: serperTransport });
    const { results } = await runAll(baseParams({ mode: "auto", competitors: [], minOverlap: 2 }), api);
    const d = results.discovery!;
    expect(d.method).toBe("sweep");
    // Barrido: COMP y OTHER (mismo sector); el supermercado y el propio cliente quedan fuera.
    expect(d.sweptPlaces!.map((s) => s.title).sort()).toEqual([COMP.title, OTHER.title].sort());
    expect(d.candidates.map((c) => c.title)).toEqual([COMP.title]);
    expect(d.candidates[0].count).toBe(4);
    expect(results.competitors.map((c) => c.title)).toEqual([COMP.title]);
    const byName = Object.fromEntries(results.authors.map((a) => [a.name, a]));
    for (let i = 1; i <= 4; i++) expect(byName[`Falso ${i}`].level).toBe("alto");
  });

  it("traduce reseñas de Serper al formato interno (contributor_id desde el enlace)", () => {
    const r = normalizeReview(
      serperReviewToSerpApi({
        rating: 1, isoDate: "2026-09-01T10:00:00Z", snippet: "Mal", id: "x1", user: { name: "Ana", link: "https://www.google.com/maps/contrib/1234567890?hl=es", reviews: 3 }
      })
    );
    expect(r.user.contributorId).toBe("1234567890");
    expect(r.date).toBe("2026-09-01");
    expect(r.user.reviews).toBe(3);
  });
});

describe("utilidades", () => {
  it("parsea URLs de Maps, place_id y nombres", () => {
    expect(parsePlaceInput("https://www.google.com/maps/place/Cl%C3%ADnica+March/@36.5,-4.88,17z/data=!4m6!3m5!1s0xd7327f0a5b6b3b1:0x9a1b2c3d4e5f6071!8m2!3d36.5093!4d-4.8838")).toMatchObject({
      dataId: "0xd7327f0a5b6b3b1:0x9a1b2c3d4e5f6071", name: "Clínica March", lat: 36.5093
    });
    expect(parsePlaceInput("ChIJN1t_tDeuEmsRUsoyG83frY4").placeId).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
    expect(parsePlaceInput("place_id:ChIJN1t_tDeuEmsRUsoyG83frY4").placeId).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
    expect(parsePlaceInput("Clínica March Marbella")).toMatchObject({ dataId: "", placeId: "" });
  });

  it("convierte fechas relativas en español e inglés", () => {
    expect(relativeToTs("hace 2 semanas", NOW)).toBe(NOW - 14 * DAY);
    expect(relativeToTs("Hace un año", NOW)).toBe(NOW - 31_557_600);
    expect(relativeToTs("Editado: hace 3 días", NOW)).toBe(NOW - 3 * DAY);
    expect(relativeToTs("a month ago", NOW)).toBe(NOW - 2_629_800);
    expect(relativeToTs("", NOW)).toBe(0);
  });

  it("extrae el contributor_id del enlace si falta", () => {
    const r = normalizeReview({ rating: 1, user: { name: "X", link: "https://www.google.com/maps/contrib/123456789/reviews" } });
    expect(r.user.contributorId).toBe("123456789");
  });

  it("similitud de textos", () => {
    expect(similarity("Pésima atención, me cobraron de más", "Pesima atencion, me cobraron de mas")).toBeGreaterThan(0.9);
    expect(similarity("Muy mal servicio", "Excelente clínica, repetiré")).toBeLessThan(0.2);
  });
});
