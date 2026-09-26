/**
 * Vigilancia diaria de extremo a extremo con BD y proveedor simulados: línea base, negativa sospechosa
 * nueva → caso con pruebas + alerta, ataque de reseñas, y verificación de retirada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prisma, completeJsonMock } = vi.hoisted(() => {
  const db: any = {
    gmbReviewWatch: [], gmbReviewCase: [], gmbEvidence: [], gmbReviewerProfile: [], gmbAlert: [], gmbGoogleConnection: [], gmbClient: []
  };
  const ok = (val: any, cond: any): boolean => {
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ("in" in cond) return cond.in.includes(val);
      if ("notIn" in cond) return !cond.notIn.includes(val);
      if ("not" in cond) return val !== cond.not;
      if ("lte" in cond) return val != null && val <= cond.lte;
      if ("lt" in cond) return val != null && val < cond.lt;
      return false;
    }
    return val === cond;
  };
  const match = (r: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]: any) => (k === "OR" ? v.some((w: any) => match(r, w)) : ok(r[k], v)));
  const flat = (where: any) => Object.fromEntries(Object.entries(where).flatMap(([k, v]: any) => (v && typeof v === "object" && k.includes("_") ? Object.entries(v) : [[k, v]])));
  const coll = (name: string) => ({
    findFirst: vi.fn(async ({ where }: any) => db[name].find((r: any) => match(r, where)) ?? null),
    findUnique: vi.fn(async ({ where }: any) => db[name].find((r: any) => match(r, flat(where))) ?? null),
    findMany: vi.fn(async ({ where }: any = {}) => db[name].filter((r: any) => match(r, where))),
    create: vi.fn(async ({ data }: any) => { const r = { id: `${name}${db[name].length + 1}`, createdAt: new Date(), ...data }; db[name].push(r); return r; }),
    updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db[name]) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; })
  });
  const p: any = { _db: db };
  for (const n of Object.keys(db)) p[n] = coll(n);
  return { prisma: p, completeJsonMock: vi.fn() };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/ai/anthropic", () => ({ complete: vi.fn(), completeJson: completeJsonMock, DEFAULT_MODEL: "m" }));

let transport: (p: any) => Promise<any>;
vi.mock("@/lib/gmb/fake-reviews/provider", async () => {
  const { SerpApiClient } = await import("@/lib/integrations/serpapi");
  return { getReviewSource: async () => new SerpApiClient("k", { cacheDays: 0, transport: (p: any) => transport(p) }) };
});

import { runWatch } from "@/lib/gmb/fake-reviews/watch";
import { verifyPlace } from "@/lib/gmb/fake-reviews/cases";
import type { Place } from "@/lib/gmb/fake-reviews/core";

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const iso = (ts: number) => new Date(ts * 1000).toISOString();
const place = (o: Partial<Place>): Place => ({ title: "", address: "", rating: 4.2, reviews: 100, type: "Bar", dataId: "", placeId: "", lat: 36.5, lng: -4.9, thumbnail: "", mapsUrl: "", ...o });
const CLIENT = place({ title: "Bar Sol", dataId: "0xaaa111:0x111" });
const COMP = place({ title: "Bar Luna", dataId: "0xbbb222:0x222" });

let clientRevs: any[] = [];
let compRevs: any[] = [];
const histories: Record<string, any[]> = {};

function setTransport() {
  transport = async (p: any) => {
    if (p.engine === "google_maps_reviews") {
      const list = (p.data_id === CLIENT.dataId ? clientRevs : compRevs).slice();
      if (p.sort_by === "ratingLow") list.sort((a, b) => a.rating - b.rating);
      else list.sort((a, b) => b.ts - a.ts);
      return {
        place_info: { title: p.data_id === CLIENT.dataId ? CLIENT.title : COMP.title, rating: 4.2, reviews: 100 + list.length },
        reviews: list.slice(0, 20).map((r) => ({
          rating: r.rating, iso_date: iso(r.ts), snippet: r.text ?? "", review_id: r.id, link: `https://maps/r/${r.id}`,
          user: { name: r.name ?? `U${r.cid}`, link: `https://www.google.com/maps/contrib/${r.cid}`, contributor_id: r.cid, reviews: r.total ?? 30 }
        }))
      };
    }
    if (p.engine === "google_maps_contributor_reviews") {
      return {
        contributor: { name: `U${p.contributor_id}`, contributions: { reviews: (histories[p.contributor_id] ?? []).length } },
        reviews: (histories[p.contributor_id] ?? []).map((h) => ({
          place_info: { title: h.place.title, data_id: h.place.dataId, type: "Bar", gps_coordinates: { latitude: 36.5, longitude: -4.9 } },
          rating: h.rating, iso_date: iso(h.ts), snippet: "", link: "x"
        }))
      };
    }
    throw new Error("engine");
  };
}

beforeEach(() => {
  for (const k of Object.keys(prisma._db)) prisma._db[k].length = 0;
  vi.clearAllMocks();
  completeJsonMock.mockRejectedValue(new Error("sin IA"));
  clientRevs = Array.from({ length: 10 }, (_, i) => ({ id: `old${i}`, rating: i < 2 ? 2 : 5, ts: NOW - (30 + i * 9) * DAY, cid: `9${i}`, text: "ok" }));
  compRevs = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, rating: 5, ts: NOW - (3 + i * 10) * DAY, cid: `8${i}` }));
  for (const k of Object.keys(histories)) delete histories[k];
  setTransport();
  prisma._db.gmbReviewWatch.push({
    id: "w1", workspaceId: "ws", gmbClientId: null, name: "Bar Sol", place: CLIENT, competitors: [COMP], enabled: true, frequencyHours: 24,
    deepCheck: true, aiCheck: true, emails: "", whatsapp: "", monthlyReport: true, knownIds: null, history: null, compState: null,
    lastRunAt: null, nextRunAt: new Date(), lastCompRunAt: null, lastError: null, lockedUntil: null, apiCalls: 0, createdById: null
  });
});

describe("vigilancia diaria", () => {
  it("primera revisión = línea base; después detecta la negativa sospechosa, abre el caso con pruebas y avisa", async () => {
    let w = await runWatch("ws", "w1", { force: true });
    expect(w!.lastError).toBeNull();
    expect(prisma._db.gmbAlert).toHaveLength(0);
    expect((w!.history as any[])[0].newReviews).toBe(0);
    expect(w!.lastCompRunAt).toBeInstanceOf(Date);

    // Nueva 1★ de un perfil de 2 reseñas que el mismo día puso 5★ al competidor, con un insulto.
    histories["777"] = [{ place: CLIENT, rating: 1, ts: NOW - 3600 }, { place: COMP, rating: 5, ts: NOW - 7200 }];
    clientRevs.push({ id: "new1", rating: 1, ts: NOW - 3600, cid: "777", total: 2, text: "Sois unos gilipollas" });
    w = await runWatch("ws", "w1", { force: true });
    expect(w!.lastError).toBeNull();
    const cases = prisma._db.gmbReviewCase;
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ reviewId: "new1", status: "preparada", target: "cliente", watchId: "w1" });
    expect(cases[0].reasons.map((r: any) => r.kind)).toEqual(expect.arrayContaining(["fake", "policy"]));
    expect(prisma._db.gmbEvidence[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma._db.gmbAlert.map((a: any) => a.type)).toContain("suspicious_review");
    expect(prisma._db.gmbAlert[0].clientId).toBeNull();
    expect(prisma._db.gmbReviewerProfile.map((p: any) => p.contributorId)).toContain("777");
    expect((w!.history as any[]).at(-1).flagged).toBe(1);

    // Tercera revisión sin cambios: no duplica caso ni alerta.
    await runWatch("ws", "w1", { force: true });
    expect(prisma._db.gmbReviewCase).toHaveLength(1);
    expect(prisma._db.gmbAlert.filter((a: any) => a.type === "suspicious_review")).toHaveLength(1);
  });

  it("detecta un ataque: varias negativas nuevas en 72 horas", async () => {
    await runWatch("ws", "w1", { force: true });
    for (let i = 0; i < 4; i++) clientRevs.push({ id: `atk${i}`, rating: 1, ts: NOW - i * 3600, cid: `55${i}`, total: 40, text: "" });
    const w = await runWatch("ws", "w1", { force: true });
    expect(w!.lastError).toBeNull();
    expect(prisma._db.gmbAlert.map((a: any) => a.type)).toContain("review_attack");
  });

  it("verificación: si la reseña desaparece dos veces seguidas pasa a «retirada» con prueba y alerta", async () => {
    prisma._db.gmbReviewCase.push({
      id: "k1", workspaceId: "ws", placeKey: CLIENT.dataId, placeTitle: CLIENT.title, reviewId: "old0", author: "U90", rating: 2, reviewDate: "2020-01-01",
      text: "ok", status: "denunciada", contributorId: "90", checkMisses: 0, checkLog: null, googleOption: "spam", reviewLink: "", watchId: "w1", reportedAt: new Date()
    });
    await verifyPlace("ws", CLIENT.dataId, [prisma._db.gmbReviewCase[0]]);
    expect(prisma._db.gmbReviewCase[0].status).toBe("denunciada");
    expect(prisma._db.gmbReviewCase[0].checkMisses).toBe(0);

    clientRevs = clientRevs.filter((r) => r.id !== "old0");
    await verifyPlace("ws", CLIENT.dataId, [prisma._db.gmbReviewCase[0]]);
    expect(prisma._db.gmbReviewCase[0]).toMatchObject({ status: "denunciada", checkMisses: 1 });
    await verifyPlace("ws", CLIENT.dataId, [prisma._db.gmbReviewCase[0]]);
    expect(prisma._db.gmbReviewCase[0].status).toBe("retirada");
    expect(prisma._db.gmbEvidence.at(-1).kind).toBe("check");
    expect(prisma._db.gmbAlert.map((a: any) => a.type)).toContain("review_removed");
  });
});
