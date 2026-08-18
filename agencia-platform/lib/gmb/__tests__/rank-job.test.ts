import { describe, it, expect, vi } from "vitest";
import { enqueueRankJob, processRankJobs, cancelRankJob, MAX_RANK_ATTEMPTS } from "../rank-job";
import { resolveRankProvider, type RankProvider } from "../rank-adapter";

function mkPrisma() {
  const db: any = { gmbRankJob: [], gmbClient: [{ id: "cl1", workspaceId: "w1", name: "Café", latitude: 36.7, longitude: -4.4, placeId: "P1" }], gmbPosition: [] };
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
    return r[k] === v;
  });
  return {
    _db: db,
    gmbRankJob: {
      findFirst: vi.fn(async ({ where }: any) => db.gmbRankJob.find((r: any) => match(r, where)) ?? null),
      findMany: vi.fn(async ({ where, take }: any) => db.gmbRankJob.filter((r: any) => match(r, where)).slice(0, take ?? 999)),
      create: vi.fn(async ({ data }: any) => { const r = { id: `j${db.gmbRankJob.length + 1}`, attempts: 0, ...data }; db.gmbRankJob.push(r); return r; }),
      updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db.gmbRankJob) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; })
    },
    gmbClient: { findFirst: vi.fn(async ({ where }: any) => db.gmbClient.find((c: any) => c.id === where.id && c.workspaceId === where.workspaceId) ?? null) },
    gmbPosition: { create: vi.fn(async ({ data }: any) => { db.gmbPosition.push(data); return data; }) }
  };
}

const fakeProvider: RankProvider = {
  id: "fake",
  measure: vi.fn(async (o) => ({ keyword: o.keyword, avgPosition: 3.5, foundCount: 6, top3Count: 2, cellCount: 9, cells: [{ lat: o.lat, lng: o.lng, position: 3 }] }))
};

describe("enqueueRankJob — idempotente", () => {
  it("encola y no duplica si ya hay uno en cola", async () => {
    const p = mkPrisma();
    const a = await enqueueRankJob(p as any, "w1", { clientId: "cl1", keyword: "cafeteria", centerLat: 36.7, centerLng: -4.4 });
    expect(a.enqueued).toBe(true);
    const b = await enqueueRankJob(p as any, "w1", { clientId: "cl1", keyword: "cafeteria", centerLat: 36.7, centerLng: -4.4 });
    expect(b.enqueued).toBe(false);
    expect(b.reason).toBe("ya_en_cola");
  });
});

describe("processRankJobs — provider fake persiste snapshot", () => {
  it("mide y guarda GmbPosition, marca done", async () => {
    const p = mkPrisma();
    await enqueueRankJob(p as any, "w1", { clientId: "cl1", keyword: "cafeteria", centerLat: 36.7, centerLng: -4.4 });
    const r = await processRankJobs(p as any, "w1", { provider: fakeProvider });
    expect(r.processed).toBe(1);
    expect(p._db.gmbPosition[0].keyword).toBe("cafeteria");
    expect(p._db.gmbPosition[0].avgPosition).toBe(3.5);
    expect(p._db.gmbRankJob[0].status).toBe("done");
  });
  it("SIN proveedor → error honesto (no inventa)", async () => {
    const p = mkPrisma();
    await enqueueRankJob(p as any, "w1", { clientId: "cl1", keyword: "x", centerLat: 36.7, centerLng: -4.4 });
    const r = await processRankJobs(p as any, "w1", { provider: null });
    expect(r.errored).toBe(1);
    expect(p._db.gmbRankJob[0].status).toBe("error");
    expect(p._db.gmbRankJob[0].lastError).toMatch(/sin_proveedor/);
    expect(p._db.gmbPosition.length).toBe(0);
  });
  it("sin coordenadas → error", async () => {
    const p = mkPrisma();
    p._db.gmbClient[0].latitude = null; p._db.gmbClient[0].longitude = null;
    await enqueueRankJob(p as any, "w1", { clientId: "cl1", keyword: "x" });
    const r = await processRankJobs(p as any, "w1", { provider: fakeProvider });
    expect(p._db.gmbRankJob[0].status).toBe("error");
    expect(p._db.gmbRankJob[0].lastError).toMatch(/sin_coordenadas/);
  });
  it("provider lanza → reintenta acotado y acaba en error", async () => {
    const p = mkPrisma();
    const boom: RankProvider = { id: "boom", measure: vi.fn(async () => { throw new Error("timeout"); }) };
    await enqueueRankJob(p as any, "w1", { clientId: "cl1", keyword: "x", centerLat: 36.7, centerLng: -4.4 });
    for (let i = 0; i < MAX_RANK_ATTEMPTS; i++) {
      p._db.gmbRankJob[0].status = "queued"; // simula reencolado del backoff
      await processRankJobs(p as any, "w1", { provider: boom });
    }
    expect(p._db.gmbRankJob[0].status).toBe("error");
    expect(p._db.gmbRankJob[0].attempts).toBeGreaterThanOrEqual(MAX_RANK_ATTEMPTS);
  });
});

describe("cancelRankJob", () => {
  it("cancela solo jobs en cola", async () => {
    const p = mkPrisma();
    const a = await enqueueRankJob(p as any, "w1", { clientId: "cl1", keyword: "x", centerLat: 36.7, centerLng: -4.4 });
    expect(await cancelRankJob(p as any, "w1", a.jobId!)).toBe(true);
    expect(p._db.gmbRankJob[0].status).toBe("cancelled");
  });
});

describe("resolveRankProvider — honesto", () => {
  it("sin clave → null (bloqueo honesto)", async () => {
    expect(await resolveRankProvider("w1", { hasKey: async () => false })).toBeNull();
  });
  it("con clave → provider real", async () => {
    const prov = await resolveRankProvider("w1", { hasKey: async () => true });
    expect(prov?.id).toBe("google_maps");
  });
  it("provider inyectado (fake) se usa tal cual", async () => {
    expect(await resolveRankProvider("w1", { provider: fakeProvider })).toBe(fakeProvider);
  });
});
