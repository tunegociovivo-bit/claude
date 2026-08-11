/**
 * Slice 2c — benchmark ligero del camino de decisión (puro, sin BD). Verifica que
 * el "cerebro" del orquestador es barato: miles de decisiones por debajo de un
 * umbral generoso (no debe ser un cuello de botella frente al coste de los modelos).
 */
import { describe, it, expect } from "vitest";
import { decideRecovery } from "../controller";
import { classifyFailure } from "../diagnosis";
import { fingerprint } from "../fingerprint";
import { DEFAULT_LIMITS } from "../budget";

describe("benchmark — decisión de recuperación", () => {
  it("100k decisiones + huellas por debajo de 1500ms", () => {
    const N = 100_000;
    const diag = classifyFailure({ hint: "verification_failed" });
    const t0 = performance.now();
    let blocked = 0;
    for (let i = 0; i < N; i++) {
      const fp = fingerprint({ phase: "executing", strategy: "retry_same", error: `boom ${i}` });
      const d = decideRecovery({
        diagnosis: diag,
        usage: { attempts: i % 5, elapsedMs: 1000, tokens: 100, costUsd: 0.01 },
        limits: DEFAULT_LIMITS,
        fingerprintHistory: [fp],
        currentFingerprint: fp,
        strategyCtx: { tried: [], canDecompose: i % 2 === 0 },
        attempts: [],
        rand: () => 0.5
      });
      if (d.to === "materially_blocked") blocked++;
    }
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[bench] ${N} decisiones en ${ms.toFixed(0)}ms (${Math.round(N / (ms / 1000))}/s), blocked=${blocked}`);
    expect(ms).toBeLessThan(1500);
  });
});
