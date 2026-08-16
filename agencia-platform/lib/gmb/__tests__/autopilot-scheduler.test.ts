import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAutopilotForClient } from "../autopilot-scheduler";

function mkPrisma(policy: any, actions: any[]) {
  const db: any = {
    gmbClient: [{ id: "cl1", workspaceId: "w1", name: "Café", category: "cafetería", description: "x", placeId: "P", phone: "9", website: "w", address: "a" }],
    gmbAutopilotPolicy: policy ? [{ id: "pol1", workspaceId: "w1", clientId: "cl1", ...policy }] : [],
    gmbAction: actions,
    gmbPost: [], gmbCitation: [], gmbNapProfile: [], gmbReview: [], gmbPhoto: [], gmbPosition: [], gmbKeyword: []
  };
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]: any) => (v && typeof v === "object" && "in" in v) ? v.in.includes(r[k]) : r[k] === v);
  const coll = (name: string) => ({
    findFirst: vi.fn(async ({ where }: any) => db[name].find((r: any) => match(r, where)) ?? null),
    findMany: vi.fn(async ({ where, take }: any) => db[name].filter((r: any) => !where || match(r, where)).slice(0, take ?? 999)),
    create: vi.fn(async ({ data }: any) => { const r = { id: `${name}${db[name].length + 1}`, ...data }; db[name].push(r); return r; }),
    updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db[name]) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _avg: { rating: 0 } })),
    count: vi.fn(async () => 0)
  });
  const p: any = { _db: db };
  for (const n of Object.keys(db)) p[n] = coll(n);
  return p;
}

beforeEach(() => vi.clearAllMocks());

describe("runAutopilotForClient", () => {
  it("suggest_only → inactivo, no ejecuta", async () => {
    const p = mkPrisma({ mode: "suggest_only", dailyLimit: 3, minConfidence: 70, killSwitch: false, executedToday: 0 }, [{ id: "a1", workspaceId: "w1", clientId: "cl1", status: "suggested", external: false, module: "content", type: "t", confidence: 90, priority: 100 }]);
    const r = await runAutopilotForClient(p as any, "w1", "cl1", { now: new Date("2026-08-16T12:00:00"), generate: false });
    expect(r.active).toBe(false);
    expect(r.reason).toBe("suggest_only");
  });
  it("kill switch → inactivo", async () => {
    const p = mkPrisma({ mode: "execute_safe", dailyLimit: 3, minConfidence: 70, killSwitch: true, executedToday: 0 }, []);
    const r = await runAutopilotForClient(p as any, "w1", "cl1", { now: new Date("2026-08-16T12:00:00"), generate: false });
    expect(r.reason).toBe("kill_switch");
  });
  it("execute_safe: ejecuta interna de contenido (crea borrador GmbPost) y cuenta el diario", async () => {
    const p = mkPrisma({ mode: "execute_safe", dailyLimit: 3, minConfidence: 70, killSwitch: false, executedToday: 0, executedDate: null },
      [{ id: "a1", workspaceId: "w1", clientId: "cl1", status: "suggested", external: false, module: "content", type: "schedule_posts", title: "Post", confidence: 90, priority: 100, requiresApproval: false }]);
    const r = await runAutopilotForClient(p as any, "w1", "cl1", { now: new Date("2026-08-16T12:00:00"), generate: false });
    expect(r.active).toBe(true);
    expect(r.executed).toBe(1);
    expect(p._db.gmbPost[0].status).toBe("draft"); // efecto interno reversible
    expect(p._db.gmbAction[0].status).toBe("done");
    expect(p._db.gmbAutopilotPolicy[0].executedToday).toBe(1);
  });
  it("acción EXTERNA solo llega a needs_approval (nunca se ejecuta)", async () => {
    const p = mkPrisma({ mode: "execute_safe", dailyLimit: 3, minConfidence: 70, killSwitch: false, executedToday: 0 },
      [{ id: "a1", workspaceId: "w1", clientId: "cl1", status: "suggested", external: true, module: "reviews", type: "reply_reviews", title: "R", confidence: 95, priority: 100, requiresApproval: true }]);
    const r = await runAutopilotForClient(p as any, "w1", "cl1", { now: new Date("2026-08-16T12:00:00"), generate: false });
    expect(r.executed).toBe(0);
    expect(p._db.gmbAction[0].status).toBe("needs_approval");
  });
});
