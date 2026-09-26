import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/anthropic", () => ({ complete: vi.fn(), completeJson: vi.fn(), DEFAULT_MODEL: "test-model" }));

import { detectNetworks, buildFootprint, placeKeyOf } from "@/lib/gmb/fake-reviews/network";
import { analyzeCompetitorPositives, detectSpikes, type KnownProfile } from "@/lib/gmb/fake-reviews/compfakes";
import {
  appealBatches,
  appealTemplate,
  calibratedLikelihood,
  findReview,
  learningStats,
  legalTemplate,
  nextStatus,
  pickOption,
  reasonsFromPolicy,
  reportText,
  type CaseReason
} from "@/lib/gmb/fake-reviews/cases-logic";
import { attackCheck, mergeKnown, newReviews, pushHistory, recentSpike } from "@/lib/gmb/fake-reviews/watch-logic";
import { estimateAnalysis, estimateWatch } from "@/lib/gmb/fake-reviews/estimate";
import { runAnalysis } from "@/lib/gmb/fake-reviews/analyzer";
import { initState, tick, type JobState } from "@/lib/gmb/fake-reviews/job";
import { canonicalJson, sha256 } from "@/lib/gmb/fake-reviews/shield";
import { SerpApiClient } from "@/lib/integrations/serpapi";
import type { AnalysisParams, Contributor, Place, Review } from "@/lib/gmb/fake-reviews/core";

const DAY = 86_400;
const NOW = Math.floor(Date.parse("2026-09-20T00:00:00Z") / 1000);
const iso = (ts: number) => new Date(ts * 1000).toISOString();

const place = (o: Partial<Place>): Place => ({
  title: "", address: "", rating: null, reviews: null, type: "Restaurante", dataId: "", placeId: "", lat: 36.5, lng: -4.9, thumbnail: "", mapsUrl: "", ...o
});
const CLIENT = place({ title: "Bar Sol", dataId: "0xaaa111:0x111", rating: 4.1, reviews: 300 });
const COMP = place({ title: "Bar Luna", dataId: "0xbbb222:0x222", rating: 4.7, reviews: 500 });

function review(o: { id: string; rating: number; ts: number; cid?: string; name?: string; text?: string; total?: number; lg?: boolean; photos?: number }): Review {
  return {
    reviewId: o.id, rating: o.rating, ts: o.ts, date: iso(o.ts).slice(0, 10), text: o.text ?? "", photos: o.photos ?? 0, link: `https://maps/r/${o.id}`,
    user: { name: o.name ?? `U${o.cid ?? o.id}`, contributorId: o.cid ?? "", link: o.cid ? `https://www.google.com/maps/contrib/${o.cid}` : "", thumbnail: "", localGuide: !!o.lg, reviews: o.total ?? 1, photos: 0 }
  };
}

function contrib(reviews: { place: Place; rating: number; ts: number }[]): Contributor {
  return {
    name: "x", thumbnail: "", localGuide: false, level: 0, totalReviews: reviews.length, totalPhotos: 0,
    reviews: reviews.map((r) => ({ placeTitle: r.place.title, placeType: r.place.type, dataId: r.place.dataId, lat: r.place.lat, lng: r.place.lng, rating: r.rating, ts: r.ts, date: iso(r.ts).slice(0, 10), text: "", link: "" }))
  };
}

describe("redes de perfiles", () => {
  const P1 = place({ title: "Taller A", dataId: "0x1:0x1" });
  const P2 = place({ title: "Peluquería B", dataId: "0x2:0x2" });
  const P3 = place({ title: "Dentista C", dataId: "0x3:0x3" });

  it("agrupa perfiles que reseñan los mismos negocios en fechas próximas e ignora el cliente", () => {
    const fp = {
      a: buildFootprint(contrib([{ place: CLIENT, rating: 1, ts: NOW }, { place: P1, rating: 5, ts: NOW - 2 * DAY }, { place: P2, rating: 5, ts: NOW - 10 * DAY }]), CLIENT),
      b: buildFootprint(contrib([{ place: CLIENT, rating: 1, ts: NOW }, { place: P1, rating: 5, ts: NOW - 3 * DAY }, { place: P2, rating: 5, ts: NOW - 9 * DAY }]), CLIENT),
      c: buildFootprint(contrib([{ place: P2, rating: 5, ts: NOW - 8 * DAY }, { place: P3, rating: 1, ts: NOW - 20 * DAY }, { place: P1, rating: 4, ts: NOW - 4 * DAY }]), CLIENT),
      d: buildFootprint(contrib([{ place: P3, rating: 5, ts: NOW - 400 * DAY }]), CLIENT),
      e: buildFootprint(contrib([{ place: place({ title: "Otro", dataId: "0x9:0x9" }), rating: 5, ts: NOW }]), CLIENT)
    };
    expect(fp.a.some((f) => f[0] === placeKeyOf(CLIENT.dataId, CLIENT.title))).toBe(false);
    const nets = detectNetworks(fp, { a: "Ana", b: "Beto", c: "Carla" }, { popularPct: 1 });
    expect(nets).toHaveLength(1);
    expect(nets[0].members).toEqual(["a", "b", "c"]);
    expect(nets[0].id).toBe("R1");
    expect(nets[0].shared.map((s) => s.title)).toContain("Taller A");
  });

  it("una sola coincidencia lejana en el tiempo no forma red", () => {
    const fp = {
      a: buildFootprint(contrib([{ place: P1, rating: 5, ts: NOW }]), CLIENT),
      b: buildFootprint(contrib([{ place: P1, rating: 5, ts: NOW - 30 * DAY }]), CLIENT)
    };
    expect(detectNetworks(fp, {})).toHaveLength(0);
  });

  it("coincidencia casi simultánea en la misma dirección sí forma pareja", () => {
    const fp = {
      a: buildFootprint(contrib([{ place: P1, rating: 5, ts: NOW }]), CLIENT),
      b: buildFootprint(contrib([{ place: P1, rating: 5, ts: NOW - DAY }]), CLIENT),
      c: buildFootprint(contrib([{ place: P2, rating: 5, ts: NOW - DAY }]), CLIENT)
    };
    const nets = detectNetworks(fp, {}, { popularPct: 1 });
    expect(nets).toHaveLength(1);
    expect(nets[0].members).toEqual(["a", "b"]);
  });

  it("la red suma puntos al perfil y aparece en los hallazgos", () => {
    const neg = [review({ id: "r1", rating: 1, ts: NOW, cid: "a", total: 30 }), review({ id: "r2", rating: 1, ts: NOW, cid: "b", total: 30 })];
    const params = { client: CLIENT, competitors: [], negThreshold: 2, posThreshold: 4, windowDays: 30, dateFrom: "", deep: true, ai: false, maxClientPages: 1, maxCompPages: 1, maxDeep: 5 } as AnalysisParams;
    const net = { id: "R1", members: ["a", "b", "c"], names: ["A", "B", "C"], shared: [{ key: "k", title: "Taller A", members: 3 }], pairs: 3, strength: 70 };
    const res = runAnalysis(params, neg, [], {}, { networks: [net], known: { b: { timesFlagged: 2, status: "sospechoso", maxScore: 70, places: ["Otro bar"] } } });
    const a = res.authors.find((x) => x.cid === "a")!;
    const b = res.authors.find((x) => x.cid === "b")!;
    expect(a.signals.map((s) => s.code)).toContain("network");
    expect(b.signals.map((s) => s.code)).toEqual(expect.arrayContaining(["network", "known_profile"]));
    expect(b.score).toBe(a.score + 20);
    expect(res.knownMatches).toBe(1);
    expect(res.findings.join(" ")).toContain("red(es) de perfiles coordinados");
    expect(res.findings.join(" ")).toContain("ya estaban fichados");
  });
});

describe("positivas sospechosas en la competencia", () => {
  it("detecta picos de volumen", () => {
    const ts: { ts: number }[] = [];
    for (let w = 1; w < 26; w++) ts.push({ ts: NOW - w * 7 * DAY });
    for (let i = 0; i < 9; i++) ts.push({ ts: NOW - i * 3600 });
    const sp = detectSpikes(ts);
    expect(sp).toHaveLength(1);
    expect(sp[0].count).toBeGreaterThanOrEqual(9);
    expect(recentSpike(ts.map((x) => x.ts), NOW)).not.toBeNull();
  });

  it("puntúa cuentas nuevas, textos vacíos, perfiles que atacaron al cliente y perdona a los Local Guide", () => {
    const list = [
      review({ id: "p1", rating: 5, ts: NOW, cid: "x1", total: 1 }), // 30 + 10 + 30 (atacó al cliente)
      review({ id: "p2", rating: 5, ts: NOW, cid: "x2", total: 2, text: "Genial!" }), // 30 + 8 → no llega
      review({ id: "p3", rating: 5, ts: NOW, cid: "x3", total: 120, lg: true }), // creíble
      review({ id: "p4", rating: 5, ts: NOW, cid: "x4", total: 1 }), // 30 + 10 + 20 (fichado)
      review({ id: "p5", rating: 3, ts: NOW, cid: "x5", total: 1 }) // no es positiva
    ];
    const out = analyzeCompetitorPositives([COMP], [list], {
      posThreshold: 4,
      clientNegAuthors: new Set(["x1"]),
      known: { x4: { timesFlagged: 1, status: "sospechoso", maxScore: 60, places: ["Bar Sol"] } }
    });
    expect(out).toHaveLength(1);
    expect(out[0].positives).toBe(4);
    expect(out[0].suspicious.map((s) => s.reviewId)).toEqual(["p1", "p4"]);
    expect(out[0].suspicious[0].reasons.join(" ")).toContain("negativa al cliente");
  });
});

describe("centro de retiradas", () => {
  const reasons: CaseReason[] = [
    ...reasonsFromPolicy([{ category: "lenguaje_obsceno", evidence: "mierda", explanation: "Lenguaje soez" }]),
    { kind: "fake", category: "fake", label: "Perfil vinculado a la competencia", policy: "Contenido falso", detail: "5★ a Bar Luna" }
  ];

  it("transiciones de estado válidas e inválidas", () => {
    expect(nextStatus("preparada", "report")).toEqual({ ok: true, to: "denunciada" });
    expect(nextStatus("denunciada", "reject")).toEqual({ ok: true, to: "rechazada" });
    expect(nextStatus("rechazada", "appeal")).toEqual({ ok: true, to: "apelada" });
    expect(nextStatus("apelada", "appeal_rejected")).toEqual({ ok: true, to: "rechazada_final" });
    expect(nextStatus("preparada", "appeal").ok).toBe(false);
    expect(nextStatus("retirada", "removed").ok).toBe(false);
    expect(nextStatus("apelada", "removed")).toEqual({ ok: true, to: "retirada" });
  });

  it("elige la opción más evidente y, con datos reales, la que más retira", () => {
    expect(pickOption(reasons)).toBe("soez");
    const mk = (o: string, status: string, n: number) =>
      Array.from({ length: n }, () => ({ status, googleOption: o, target: "cliente", channel: "tool", reasons: [], reportedAt: "2026-01-01", appealedAt: null, removedAt: status === "retirada" ? "2026-01-05" : null }));
    const stats = learningStats([...mk("conflicto", "retirada", 6), ...mk("soez", "rechazada", 5), ...mk("soez", "retirada", 1)]);
    expect(stats.byOption.conflicto!.rate).toBe(1);
    expect(stats.byOption.conflicto!.avgDays).toBe(4);
    expect(stats.byOption.soez!.rate).toBeCloseTo(0.17, 2);
    expect(pickOption(reasons, stats)).toBe("conflicto");
    expect(calibratedLikelihood("alta", "soez", stats)).toBe("baja");
    expect(calibratedLikelihood("media", "conflicto", stats)).toBe("alta");
    expect(calibratedLikelihood("media", "spam", stats)).toBe("media");
    expect(stats.removed).toBe(7);
  });

  it("encuentra la reseña por id o por autor/estrellas/fecha", () => {
    const c = { reviewId: "abc", author: "José Pérez", rating: 1, reviewDate: "2026-09-01", text: "Fatal" };
    expect(findReview(c, [{ reviewId: "abc", author: "x", rating: 5 }])).toBe(true);
    expect(findReview(c, [{ reviewId: "gbp:1", author: "Jose Perez", rating: 1, date: "2026-09-02" }])).toBe(true);
    expect(findReview(c, [{ reviewId: "gbp:1", author: "Jose Perez", rating: 1, date: "2026-08-01" }])).toBe(false);
    expect(findReview(c, [{ reviewId: "zzz", author: "Otra", rating: 1, date: "2026-09-01" }])).toBe(false);
  });

  it("lotes de apelación de hasta 10 por ficha", () => {
    const cases = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, placeKey: "p1", status: "rechazada" })),
      { id: "b1", placeKey: "p2", status: "rechazada" },
      { id: "c1", placeKey: "p1", status: "denunciada" }
    ];
    const b = appealBatches(cases);
    expect(b.map((x) => x.length)).toEqual([10, 2, 1]);
  });

  it("textos de denuncia, apelación y vía legal", () => {
    const c = { target: "cliente", placeTitle: "Bar Sol", author: "Ana", rating: 1, reviewDate: "2026-09-01", text: "Esto es una mierda", reviewLink: "https://maps/r/1", reasons, googleOption: "soez" };
    expect(reportText(c)).toContain("Lenguaje soez");
    expect(reportText(c).length).toBeLessThanOrEqual(1000);
    const ap = appealTemplate([c, { ...c, author: "Beto" }], { name: "Bar Sol" }, "Negocio Vivo");
    expect(ap.startsWith("Asunto:")).toBe(true);
    expect(ap).toContain("2. «Beto»");
    expect(legalTemplate(c, { name: "Bar Sol" }, "NV")).toContain("2022/2065");
  });
});

describe("vigilancia diaria", () => {
  it("detecta ataques: ≥ 3 negativas en 72 h y 3× lo habitual", () => {
    const base = Array.from({ length: 6 }, (_, i) => NOW - (10 + i * 12) * DAY);
    expect(attackCheck([...base, NOW - 3600, NOW - 7200, NOW - 2 * DAY], NOW).attack).toBe(true);
    expect(attackCheck([...base, NOW - 3600, NOW - 7200], NOW).attack).toBe(false);
    const busy = Array.from({ length: 90 }, (_, i) => NOW - (4 + i) * DAY);
    expect(attackCheck([...busy, NOW - 3600, NOW - 7200, NOW - 9000], NOW).attack).toBe(false);
  });

  it("reseñas nuevas frente a la memoria e historial por día", () => {
    const a = review({ id: "r1", rating: 1, ts: NOW });
    const b = review({ id: "r2", rating: 5, ts: NOW });
    const known = mergeKnown([], [a]);
    expect(newReviews(known, [a, b]).map((r) => r.reviewId)).toEqual(["r2"]);
    const h = pushHistory(pushHistory([], { d: "2026-09-20", rating: 4, reviews: 10, newReviews: 1, newNeg: 1, flagged: 0 }), { d: "2026-09-20", rating: 4, reviews: 11, newReviews: 2, newNeg: 0, flagged: 1 });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ reviews: 11, newReviews: 3, newNeg: 1, flagged: 1 });
  });
});

describe("coste estimado", () => {
  it("análisis y vigilancia", () => {
    const e = estimateAnalysis({ provider: "serpapi", kind: "cruce", mode: "manual", client: { reviews: 300, rating: 4.1 }, comps: [{ reviews: 500 }], negThreshold: 2, dateFrom: "", deep: true, maxDeep: 80, policy: true, ai: true });
    expect(e.min).toBeGreaterThan(0);
    expect(e.max).toBeGreaterThanOrEqual(e.min);
    expect(e.ai).toBeGreaterThanOrEqual(2);
    expect(e.eurMax).toBeGreaterThan(0);
    const p = estimateAnalysis({ provider: "serpapi", kind: "policy", mode: "manual", client: { reviews: 300, rating: 4.1 }, comps: [], negThreshold: 2, dateFrom: "", deep: false, maxDeep: 80, policy: true, ai: false });
    expect(p.max).toBeLessThan(e.max);
    expect(estimateWatch({ provider: "serpapi", gbp: true, frequencyHours: 24, competitors: 0, deepCheck: true }).searches).toBeLessThan(
      estimateWatch({ provider: "serpapi", gbp: false, frequencyHours: 24, competitors: 2, deepCheck: true }).searches
    );
  });
});

describe("pruebas", () => {
  it("la huella no depende del orden de las claves", () => {
    expect(sha256(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] }))).toBe(sha256(canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 })));
    expect(sha256(canonicalJson({ a: 1 }))).not.toBe(sha256(canonicalJson({ a: 2 })));
  });
});

describe("job: competencia detectada → positivas sospechosas y perfiles fichados", () => {
  it("en modo auto lee las positivas recientes de la competencia detectada y consulta la base de perfiles", async () => {
    // 3 perfiles: 1★ al cliente y 5★ a Bar Luna el mismo día (cuentas de 1-2 reseñas).
    const authors: Record<string, { place: Place; rating: number; ts: number }[]> = {};
    const clientRevs: any[] = [];
    const compRevs: any[] = [];
    for (let i = 1; i <= 3; i++) {
      const cid = `5000${i}`;
      const t = NOW - i * 20 * DAY;
      authors[cid] = [{ place: CLIENT, rating: 1, ts: t }, { place: COMP, rating: 5, ts: t + 3600 }];
      clientRevs.push({ rating: 1, ts: t, cid, text: "" });
      compRevs.push({ rating: 5, ts: t + 3600, cid, text: "" });
    }
    for (let i = 0; i < 5; i++) compRevs.push({ rating: 5, ts: NOW - i * DAY, cid: `7000${i}`, text: "" });
    compRevs.sort((a, b) => b.ts - a.ts);
    const user = (cid: string) => ({ name: `P${cid}`, link: `https://www.google.com/maps/contrib/${cid}`, contributor_id: cid, reviews: 2 });
    const transport = async (p: any) => {
      if (p.engine === "google_maps_reviews") {
        const list = p.data_id === CLIENT.dataId ? clientRevs : compRevs;
        return {
          place_info: { title: p.data_id === CLIENT.dataId ? CLIENT.title : COMP.title, rating: 4.7, reviews: 500 },
          reviews: list.map((r) => ({ rating: r.rating, iso_date: iso(r.ts), snippet: r.text, review_id: `rv_${r.cid}`, link: `https://maps/r/${r.cid}`, user: user(r.cid) }))
        };
      }
      if (p.engine === "google_maps_contributor_reviews") {
        return {
          contributor: { name: `P${p.contributor_id}`, contributions: { reviews: 2 } },
          reviews: authors[p.contributor_id].map((h) => ({
            place_info: { title: h.place.title, data_id: h.place.dataId, type: h.place.type, gps_coordinates: { latitude: h.place.lat, longitude: h.place.lng } },
            rating: h.rating, iso_date: iso(h.ts), snippet: "", link: "x"
          }))
        };
      }
      throw new Error("?");
    };
    const params: AnalysisParams = { mode: "auto", minOverlap: 2, client: CLIENT, competitors: [], negThreshold: 2, posThreshold: 4, windowDays: 30, dateFrom: "", deep: true, ai: false, maxClientPages: 5, maxCompPages: 5, maxDeep: 20 };
    const state: JobState = initState(params);
    const lookupKnown = vi.fn(async (cids: string[]): Promise<Record<string, KnownProfile>> => (cids.includes("50002") ? { "50002": { timesFlagged: 3, status: "confirmado", maxScore: 80, places: ["Bar Estrella"] } } : {}));
    const api = new SerpApiClient("k", { cacheDays: 0, transport });
    let res: any = null;
    for (let i = 0; i < 100 && state.phase !== "done"; i++) {
      const r = await tick(params, state, { api, lookupKnown });
      if (r) res = r;
    }
    expect(res.competitors.map((c: Place) => c.title)).toEqual(["Bar Luna"]);
    expect(lookupKnown).toHaveBeenCalledTimes(1);
    const p2 = res.authors.find((a: any) => a.cid === "50002");
    expect(p2.signals.map((s: any) => s.code)).toContain("known_profile");
    expect(res.compFakes).toHaveLength(1);
    expect(res.compFakes[0].suspicious.map((s: any) => s.contributorId)).toEqual(expect.arrayContaining(["50001", "50002", "50003"]));
    expect(res.findings.join(" ")).toContain("positivas sospechosas en la competencia");
  });
});
