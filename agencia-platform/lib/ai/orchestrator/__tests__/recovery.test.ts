/**
 * Slice 2c — cerebro de recuperación: diagnóstico, estrategia distinta, controller.
 */
import { describe, it, expect } from "vitest";
import { classifyFailure, isMaterial } from "../diagnosis";
import { chooseNextStrategy, isMateriallyDistinct, type Strategy } from "../strategy";
import { decideRecovery } from "../controller";
import { DEFAULT_LIMITS } from "../budget";

describe("diagnosis (8 clases)", () => {
  it("clasifica por texto", () => {
    expect(classifyFailure({ error: "ETIMEDOUT socket hang up" }).class).toBe("transient");
    expect(classifyFailure({ error: "falta credencial no configurada" }).class).toBe("missing_data");
    expect(classifyFailure({ error: "400 invalid input schema" }).class).toBe("tool");
    expect(classifyFailure({ error: "objetivos incompatibles conflict" }).class).toBe("goal_conflict");
    expect(classifyFailure({ error: "algo rarísimo" }).class).toBe("unknown");
  });
  it("señales explícitas mandan sobre el texto", () => {
    expect(classifyFailure({ error: "timeout", policyBlocked: true }).class).toBe("policy");
    expect(classifyFailure({ error: "timeout", verificationFailed: true }).class).toBe("verification_failed");
    expect(classifyFailure({ hint: "provider", error: "x" }).class).toBe("provider");
  });
  it("material vs recuperable", () => {
    expect(isMaterial("missing_data")).toBe(true);
    expect(isMaterial("goal_conflict")).toBe(true);
    expect(isMaterial("transient")).toBe(false);
    expect(classifyFailure({ error: "ETIMEDOUT" }).retriableSameStrategy).toBe(true);
    expect(classifyFailure({ hint: "provider" }).needsNewStrategy).toBe(true);
  });
});

describe("strategy — solo reintenta con algo materialmente distinto", () => {
  const S = (kind: Strategy["kind"], p?: string, m?: string): Strategy => ({ kind, provider: p ?? null, model: m ?? null, label: kind });
  it("distinción por kind+provider+model", () => {
    expect(isMateriallyDistinct(S("switch_provider", "openai", "gpt"), S("switch_provider", "gemini", "pro"))).toBe(true);
    expect(isMateriallyDistinct(S("retry_same"), S("retry_same"))).toBe(false);
  });
  it("transitorio permite un retry_same, luego no lo repite", () => {
    const diag = classifyFailure({ error: "ETIMEDOUT" });
    const first = chooseNextStrategy(diag, { tried: [] });
    expect(first?.kind).toBe("retry_same");
    const second = chooseNextStrategy(diag, { tried: [S("retry_same")] });
    expect(second?.kind).not.toBe("retry_same"); // no repite lo ya probado
  });
  it("provider → switch_provider entre disponibles; sin más → null", () => {
    const diag = classifyFailure({ hint: "provider" });
    const avail = [{ provider: "openai", model: "gpt" }];
    const s = chooseNextStrategy(diag, { tried: [], availableProviders: avail });
    expect(s?.kind).toBe("switch_provider");
    const none = chooseNextStrategy(diag, { tried: [S("switch_provider", "openai", "gpt"), S("switch_model"), S("reduce_scope"), S("alternate_tool")], availableProviders: avail });
    expect(none).toBeNull();
  });
});

describe("controller.decideRecovery — la lógica de recuperación", () => {
  const baseDiag = classifyFailure({ hint: "tool" });
  const usage0 = { attempts: 1, elapsedMs: 1000, tokens: 100, costUsd: 0.01 };
  const common = { limits: DEFAULT_LIMITS, fingerprintHistory: [] as string[], currentFingerprint: "fp1", strategyCtx: { tried: [], canDecompose: true }, attempts: [], rand: () => 0 };

  it("presupuesto agotado → budget_exhausted con packet", () => {
    const d = decideRecovery({ ...common, diagnosis: baseDiag, usage: { attempts: 99, elapsedMs: 0, tokens: 0, costUsd: 0 } });
    expect(d.to).toBe("budget_exhausted");
    expect(d.packet?.cause).toBe("budget_exhausted");
    expect(d.packet?.decision).toBeTruthy();
  });
  it("bucle → materially_blocked", () => {
    const d = decideRecovery({ ...common, diagnosis: baseDiag, usage: usage0, fingerprintHistory: ["fp1", "fp1"], currentFingerprint: "fp1" });
    expect(d.to).toBe("materially_blocked");
    expect(d.packet?.cause).toBe("loop_detected");
  });
  it("diagnóstico material → materially_blocked", () => {
    const d = decideRecovery({ ...common, diagnosis: classifyFailure({ error: "falta credencial" }), usage: usage0 });
    expect(d.to).toBe("materially_blocked");
    expect(d.packet?.cause).toBe("missing_data");
  });
  it("política → approval_required", () => {
    const d = decideRecovery({ ...common, diagnosis: classifyFailure({ policyBlocked: true }), usage: usage0 });
    expect(d.to).toBe("approval_required");
    expect(d.packet?.cause).toBe("policy_approval");
  });
  it("estrategia distinta disponible → waiting_backoff con backoff y estrategia", () => {
    const d = decideRecovery({ ...common, diagnosis: classifyFailure({ hint: "verification_failed" }), usage: usage0, strategyCtx: { tried: [], canDecompose: false } });
    // primera distinta para verification_failed sin decompose → reduce_scope
    expect(d.to).toBe("waiting_backoff");
    expect(d.strategy).toBeTruthy();
    expect(typeof d.backoffMs).toBe("number");
  });
  it("decompose → decomposing", () => {
    const d = decideRecovery({ ...common, diagnosis: classifyFailure({ hint: "verification_failed" }), usage: usage0, strategyCtx: { tried: [], canDecompose: true } });
    expect(d.to).toBe("decomposing");
    expect(d.strategy?.kind).toBe("decompose");
  });
  it("sin estrategia distinta → materially_blocked (no_distinct_strategy)", () => {
    const tried: Strategy[] = [
      { kind: "decompose", provider: null, model: null, label: "d" },
      { kind: "reduce_scope", provider: null, model: null, label: "r" },
      { kind: "alternate_tool", provider: null, model: null, label: "a" },
      { kind: "switch_model", provider: null, model: null, label: "m" }
    ];
    const d = decideRecovery({ ...common, diagnosis: classifyFailure({ hint: "tool" }), usage: usage0, strategyCtx: { tried, canDecompose: true } });
    expect(d.to).toBe("materially_blocked");
    expect(d.packet?.cause).toBe("no_distinct_strategy");
  });
});
