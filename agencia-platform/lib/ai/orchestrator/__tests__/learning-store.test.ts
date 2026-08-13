/**
 * Memoria de estrategias (aprendizaje) — aprende SOLO de verificados, tenant-scoped,
 * recupera y prioriza lo que funcionó, idempotente, y sin PII/inyección en la firma.
 */
import { describe, it, expect, vi } from "vitest";
import { makeDbLearning, taskSignature, rootCauseKey } from "../learning-store";

function mkDb() {
  const rows: any[] = [];
  const match = (r: any, w: any) => r.workspaceId === w.workspaceId && r.taskSignature === w.taskSignature && r.rootCause === w.rootCause && r.strategyKind === w.strategyKind && r.provider === w.provider && r.model === w.model;
  return {
    _rows: rows,
    aiStrategyMemory: {
      findFirst: vi.fn(async ({ where }: any) => {
        const r = rows.find((x) => match(x, where));
        return r ? { ...r } : null;
      }),
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        let out = rows.filter((x) => x.workspaceId === where.workspaceId && x.taskSignature === where.taskSignature && x.rootCause === where.rootCause).map((x) => ({ ...x }));
        if (orderBy?.score === "desc") out = out.sort((a, b) => b.score - a.score);
        return out.slice(0, take ?? out.length);
      }),
      create: vi.fn(async ({ data }: any) => {
        if (rows.some((x) => match(x, data))) { const e: any = new Error("uniq"); e.code = "P2002"; throw e; }
        rows.push({ ...data });
        return { ...data };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => match(x, where) && (where.version === undefined || x.version === where.version));
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      })
    }
  };
}

const NOW = new Date("2026-08-12T16:00:00Z");
const sig = "sig-A";
const cause = "provider:http n";

describe("taskSignature / rootCauseKey — hash sin PII ni texto crudo", () => {
  it("firma NO contiene el texto/objetivo crudo (hash) y es estable normalizando PII/números", () => {
    const s1 = taskSignature("resumen", "escribe a ana@acme.es sobre el pedido 12345");
    const s2 = taskSignature("resumen", "escribe a otro@correo.com sobre el pedido 99999");
    expect(s1).not.toMatch(/ana@acme|12345|pedido/); // es un hash
    expect(s1).toBe(s2); // PII redactada + números normalizados → misma firma
  });
  it("rootCauseKey normaliza el error (sin ids/números/secretos)", () => {
    const a = rootCauseKey("provider", "HTTP 429 for key sk-abcdefghijklmnopqrstuvwx en request 55");
    const b = rootCauseKey("provider", "HTTP 500 for key sk-zyxwvutsrqponmlkjihgfedcba en request 99");
    expect(a).toBe(b); // números → <n>, secretos → «SECRETO»
    expect(a).not.toMatch(/sk-abcdef|429|55/);
  });
});

describe("recordOutcome — solo verificados, idempotente, tenant-scoped", () => {
  it("NO aprende de resultados no verificados", async () => {
    const db = mkDb();
    const l = makeDbLearning(db as any);
    await l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "openai", verified: false, ok: true, attemptToken: "t1", now: NOW });
    expect(db._rows).toHaveLength(0);
  });
  it("aprende de un éxito verificado y sube score; evidencia redactada", async () => {
    const db = mkDb();
    const l = makeDbLearning(db as any);
    await l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "anthropic", verified: true, ok: true, evidence: { note: "ok, email ana@acme.es" }, attemptToken: "t1", now: NOW });
    const row = db._rows[0];
    expect(row.successCount).toBe(1);
    expect(row.score).toBeGreaterThan(0.5);
    expect(JSON.stringify(row.lastEvidence)).not.toMatch(/ana@acme/); // PII redactada
    expect(JSON.stringify(row.lastEvidence)).toContain("«EMAIL»");
  });
  it("idempotente por attemptToken (no doble conteo)", async () => {
    const db = mkDb();
    const l = makeDbLearning(db as any);
    const base = { workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "anthropic", verified: true, ok: false, now: NOW } as const;
    await l.recordOutcome({ ...base, attemptToken: "same" });
    await l.recordOutcome({ ...base, attemptToken: "same" });
    expect(db._rows[0].failureCount).toBe(1);
  });
  it("acumula éxito y fallo del mismo par (firma,causa,estrategia)", async () => {
    const db = mkDb();
    const l = makeDbLearning(db as any);
    await l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "anthropic", verified: true, ok: true, attemptToken: "a", now: NOW });
    await l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "anthropic", verified: true, ok: false, attemptToken: "b", now: NOW });
    expect(db._rows[0].successCount).toBe(1);
    expect(db._rows[0].failureCount).toBe(1);
  });
  it("best-effort: un fallo de escritura NO rompe la ejecución (se traga, ya no en silencio)", async () => {
    const db = mkDb();
    // create lanza un error NO-P2002 (p.ej. validación) → recordOutcome no debe propagar.
    db.aiStrategyMemory.create = vi.fn(async () => { throw new Error("DB down"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const l = makeDbLearning(db as any);
    await expect(
      l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "anthropic", verified: true, ok: true, attemptToken: "z", now: NOW })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled(); // de-silenciado: deja rastro (sin PII)
    warn.mockRestore();
  });
});

describe("recommend — prioriza lo que funcionó, tenant-scoped", () => {
  it("ordena por score desc y filtra por workspace", async () => {
    const db = mkDb();
    const l = makeDbLearning(db as any);
    // estrategia buena (2 éxitos) y mala (2 fallos) para el mismo (firma,causa)
    await l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "anthropic", verified: true, ok: true, attemptToken: "a1", now: NOW });
    await l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "anthropic", verified: true, ok: true, attemptToken: "a2", now: NOW });
    await l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_model", provider: "openai", verified: true, ok: false, attemptToken: "b1", now: NOW });
    await l.recordOutcome({ workspaceId: "w1", taskSignature: sig, rootCause: cause, strategyKind: "switch_model", provider: "openai", verified: true, ok: false, attemptToken: "b2", now: NOW });
    // memoria de OTRO tenant que NO debe aparecer
    await l.recordOutcome({ workspaceId: "w2", taskSignature: sig, rootCause: cause, strategyKind: "switch_provider", provider: "gemini", verified: true, ok: true, attemptToken: "c1", now: NOW });

    const recs = await l.recommend("w1", sig, cause);
    expect(recs.length).toBe(2); // solo w1
    expect(recs[0].provider).toBe("anthropic"); // la exitosa primero
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
    expect(recs.some((r) => r.provider === "gemini")).toBe(false); // NUNCA cross-tenant
  });
  it("sin memoria → recomendaciones vacías (no rompe)", async () => {
    const db = mkDb();
    const l = makeDbLearning(db as any);
    expect(await l.recommend("w1", "nada", "nada")).toEqual([]);
  });
});
