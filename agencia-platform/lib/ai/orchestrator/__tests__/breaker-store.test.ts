/**
 * Circuit breaker DURABLE (Postgres) — dos instancias sobre la MISMA "BD", carreras de
 * sonda (single-probe), expiry de lease/recuperación, aislamiento tenant/proveedor,
 * fallo de BD fail-closed, registro idempotente, half-open recovery/reopen, no fake
 * success. Mock de prisma con version-guard y condición OR de sonda, filas desacopladas.
 */
import { describe, it, expect, vi } from "vitest";
import { makeDbBreaker } from "../breaker-store";

const CFG = { failureThreshold: 3, windowMs: 60_000, cooldownMs: 30_000 };
const LEASE = 60_000;

function mkDb() {
  const rows = new Map<string, any>();
  const key = (ws: string, p: string) => `${ws}|${p}`;
  return {
    _rows: rows,
    aiProviderBreaker: {
      findFirst: vi.fn(async ({ where }: any) => {
        const r = rows.get(key(where.workspaceId, where.provider));
        return r ? { ...r } : null; // desacoplado, como Prisma
      }),
      create: vi.fn(async ({ data }: any) => {
        const k = key(data.workspaceId, data.provider);
        if (rows.has(k)) { const e: any = new Error("uniq"); e.code = "P2002"; throw e; }
        rows.set(k, { ...data });
        return { ...data };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = rows.get(key(where.workspaceId, where.provider));
        if (!r) return { count: 0 };
        if (where.version !== undefined && r.version !== where.version) return { count: 0 };
        if (where.state !== undefined && r.state !== where.state) return { count: 0 };
        if (where.OR) {
          const ok = where.OR.some((c: any) => {
            if ("probeOwner" in c) return (r.probeOwner ?? null) === c.probeOwner;
            if ("probeExpiresAt" in c) return r.probeExpiresAt && r.probeExpiresAt.getTime() <= c.probeExpiresAt.lte.getTime();
            return false;
          });
          if (!ok) return { count: 0 };
        }
        Object.assign(r, data);
        return { count: 1 };
      })
    }
  };
}

const at = (ms: number) => new Date(ms);

describe("breaker-store — durable, single-probe, fail-closed", () => {
  it("proveedor sin fila (closed) → pasa, sin sonda", async () => {
    const db = mkDb();
    const b = makeDbBreaker(db as any, CFG, LEASE);
    expect(await b.tryPass("w1", "openai", "o", at(1000))).toEqual({ pass: true, probe: false });
    expect(await b.peekBlocked("w1", "openai", at(1000))).toBe(false);
  });

  it("abre tras N fallos; bloquea durante el cooldown; sonda al vencer", async () => {
    const db = mkDb();
    const b = makeDbBreaker(db as any, CFG, LEASE);
    for (const t of [1000, 2000, 3000]) await b.record("w1", "openai", false, at(t), `tok${t}`);
    const row = db._rows.get("w1|openai");
    expect(row.state).toBe("open");
    // cooldown no cumplido → bloqueado, tryPass no pasa
    expect(await b.peekBlocked("w1", "openai", at(10_000))).toBe(true);
    expect((await b.tryPass("w1", "openai", "o", at(10_000))).pass).toBe(false);
    // cooldown cumplido (3000 + 30000) → una sonda
    const p = await b.tryPass("w1", "openai", "owner-A", at(40_000));
    expect(p).toEqual({ pass: true, probe: true });
    // segunda sonda con la lease viva → no pasa
    expect((await b.tryPass("w1", "openai", "owner-B", at(40_001))).pass).toBe(false);
  });

  it("SINGLE-PROBE entre dos instancias concurrentes → exactamente una sonda", async () => {
    const db = mkDb();
    // fila abierta con cooldown ya cumplido y sin sonda
    db._rows.set("w1|openai", { workspaceId: "w1", provider: "openai", state: "open", failureCount: 3, windowStartedAt: at(0), openedAt: at(0), lastFailureAt: at(0), lastAttemptToken: "x", probeOwner: null, probeExpiresAt: null, version: 5 });
    const b1 = makeDbBreaker(db as any, CFG, LEASE);
    const b2 = makeDbBreaker(db as any, CFG, LEASE);
    const now = at(40_000);
    const [r1, r2] = await Promise.all([b1.tryPass("w1", "openai", "inst-1", now), b2.tryPass("w1", "openai", "inst-2", now)]);
    expect([r1.pass, r2.pass].filter(Boolean).length).toBe(1); // solo UNA pasa
    expect(db._rows.get("w1|openai").version).toBe(6); // un solo claim aplicado
  });

  it("lease de sonda EXPIRADO → re-reclamable (recuperación tras muerte del sondeador)", async () => {
    const db = mkDb();
    db._rows.set("w1|openai", { workspaceId: "w1", provider: "openai", state: "half_open", failureCount: 3, windowStartedAt: at(0), openedAt: at(0), lastFailureAt: at(0), lastAttemptToken: "x", probeOwner: "dead", probeExpiresAt: at(20_000), version: 7 });
    const b = makeDbBreaker(db as any, CFG, LEASE);
    // lease viva (now < 20000) → bloqueado
    expect((await b.tryPass("w1", "openai", "o", at(19_000))).pass).toBe(false);
    // lease expirada (now > 20000) → re-reclama
    expect((await b.tryPass("w1", "openai", "new", at(21_000))).pass).toBe(true);
  });

  it("half-open + éxito → cierra (idempotente); + fallo → re-abre", async () => {
    const base = () => ({ workspaceId: "w1", provider: "openai", state: "half_open", failureCount: 3, windowStartedAt: at(0), openedAt: at(0), lastFailureAt: at(0), lastAttemptToken: "x", probeOwner: "me", probeExpiresAt: at(99_999), version: 2 });
    const dbOk = mkDb(); dbOk._rows.set("w1|openai", base());
    const bOk = makeDbBreaker(dbOk as any, CFG, LEASE);
    await bOk.record("w1", "openai", true, at(50_000), "probe-1");
    expect(dbOk._rows.get("w1|openai").state).toBe("closed");
    expect((await bOk.tryPass("w1", "openai", "o", at(51_000))).pass).toBe(true);

    const dbFail = mkDb(); dbFail._rows.set("w1|openai", base());
    const bFail = makeDbBreaker(dbFail as any, CFG, LEASE);
    await bFail.record("w1", "openai", false, at(50_000), "probe-2");
    const r = dbFail._rows.get("w1|openai");
    expect(r.state).toBe("open");
    expect(r.openedAt.getTime()).toBe(50_000);
  });

  it("registro IDEMPOTENTE por attemptToken (no doble conteo)", async () => {
    const db = mkDb();
    const b = makeDbBreaker(db as any, CFG, LEASE);
    await b.record("w1", "openai", false, at(1000), "same");
    await b.record("w1", "openai", false, at(2000), "same"); // mismo token → ignorado
    expect(db._rows.get("w1|openai").failureCount).toBe(1);
  });

  it("aislamiento TENANT: abrir w1 no afecta a w2", async () => {
    const db = mkDb();
    const b = makeDbBreaker(db as any, CFG, LEASE);
    for (const t of [1000, 2000, 3000]) await b.record("w1", "openai", false, at(t), `t${t}`);
    expect((await b.tryPass("w1", "openai", "o", at(5000))).pass).toBe(false);
    expect((await b.tryPass("w2", "openai", "o", at(5000))).pass).toBe(true); // otro tenant, sano
  });

  it("aislamiento PROVEEDOR: abrir openai no afecta a anthropic", async () => {
    const db = mkDb();
    const b = makeDbBreaker(db as any, CFG, LEASE);
    for (const t of [1000, 2000, 3000]) await b.record("w1", "openai", false, at(t), `t${t}`);
    expect((await b.tryPass("w1", "openai", "o", at(5000))).pass).toBe(false);
    expect((await b.tryPass("w1", "anthropic", "o", at(5000))).pass).toBe(true);
  });

  it("FALLO DE BD → fail-closed: tryPass no pasa, peekBlocked bloquea, record no lanza", async () => {
    const db = mkDb();
    db.aiProviderBreaker.findFirst.mockRejectedValue(new Error("db down"));
    const b = makeDbBreaker(db as any, CFG, LEASE);
    expect(await b.tryPass("w1", "openai", "o", at(1000))).toEqual({ pass: false, probe: false });
    expect(await b.peekBlocked("w1", "openai", at(1000))).toBe(true);
    await expect(b.record("w1", "openai", false, at(1000), "tok")).resolves.toBeUndefined(); // best-effort
  });

  it("ventana de fallos: fallos separados > windowMs no acumulan hasta abrir", async () => {
    const db = mkDb();
    const b = makeDbBreaker(db as any, CFG, LEASE);
    await b.record("w1", "openai", false, at(0), "a");
    await b.record("w1", "openai", false, at(70_000), "b"); // > windowMs → resetea a 1
    expect(db._rows.get("w1|openai").state).toBe("closed");
    expect(db._rows.get("w1|openai").failureCount).toBe(1);
  });
});
