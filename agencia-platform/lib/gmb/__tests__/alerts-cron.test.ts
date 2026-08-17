import { describe, it, expect, vi, beforeEach } from "vitest";

const { signalsMock } = vi.hoisted(() => ({ signalsMock: vi.fn() }));
vi.mock("../agency-data", () => ({ clientSignals: signalsMock }));

import { generateAlertsForClient } from "../alerts-cron";

function mkPrisma() {
  const db: any = { gmbAlertRule: [], gmbAlert: [] };
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
    if (k === "OR") return v.some((cond: any) => Object.entries(cond).every(([kk, vv]) => r[kk] === vv));
    return r[k] === v;
  });
  return {
    _db: db,
    gmbAlertRule: { findMany: vi.fn(async ({ where }: any) => db.gmbAlertRule.filter((r: any) => match(r, where))) },
    gmbAlert: {
      findMany: vi.fn(async ({ where }: any) => db.gmbAlert.filter((r: any) => match(r, where))),
      create: vi.fn(async ({ data }: any) => { const r = { id: `al${db.gmbAlert.length + 1}`, ...data }; db.gmbAlert.push(r); return r; }),
      updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db.gmbAlert) if (r.id === where.id) { Object.assign(r, data); n++; } return { count: n }; })
    }
  };
}

const clean = { unrepliedReviews: 0, negativeUnreplied: 0, brokenCitations: 0, rankingDropKeywords: 0, daysSinceLastPost: 5, connectionDown: false };

beforeEach(() => vi.clearAllMocks());

describe("generateAlertsForClient — idempotente + auto-sanador", () => {
  it("crea alerta cuando hay problema", async () => {
    signalsMock.mockResolvedValue({ ...clean, brokenCitations: 3 });
    const p = mkPrisma();
    const r = await generateAlertsForClient(p as any, "w1", "c1");
    expect(r.created).toBe(1);
    expect(p._db.gmbAlert[0].type).toBe("broken_citation");
    expect(p._db.gmbAlert[0].status).toBe("open");
  });
  it("dedup: segunda pasada con el mismo problema NO duplica", async () => {
    signalsMock.mockResolvedValue({ ...clean, brokenCitations: 3 });
    const p = mkPrisma();
    await generateAlertsForClient(p as any, "w1", "c1");
    const r2 = await generateAlertsForClient(p as any, "w1", "c1");
    expect(r2.created).toBe(0);
    expect(p._db.gmbAlert.length).toBe(1);
  });
  it("auto-resuelve cuando la condición desaparece", async () => {
    const p = mkPrisma();
    signalsMock.mockResolvedValue({ ...clean, brokenCitations: 3 });
    await generateAlertsForClient(p as any, "w1", "c1"); // crea
    signalsMock.mockResolvedValue({ ...clean }); // ya no hay problema
    const r = await generateAlertsForClient(p as any, "w1", "c1");
    expect(r.resolved).toBe(1);
    expect(p._db.gmbAlert[0].status).toBe("resolved");
  });
});
