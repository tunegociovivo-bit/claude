import { describe, it, expect, vi } from "vitest";
import { runAiCouncil } from "../ai-council";

const env = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" } as any;
const sig = () => new AbortController().signal;
const now = () => 1000;
const liveResult = (provider: string, model: string, text: string) => ({ provider, model, text, usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.001 }, raw: {} });

const base = { workspaceId: "w1", purpose: "opportunities", system: "sys", user: "datos", consent: true, env };

describe("runAiCouncil — honestidad y consenso", () => {
  it("sin consentimiento → no_providers (no llama a nadie)", async () => {
    const complete = vi.fn();
    const r = await runAiCouncil({ ...base, consent: false }, { complete, now, signal: sig });
    expect(r.status).toBe("no_providers");
    expect(r.reason).toBe("sin_consentimiento");
    expect(complete).not.toHaveBeenCalled();
  });

  it("sin claves → no_providers", async () => {
    const complete = vi.fn();
    const r = await runAiCouncil({ ...base, env: {} as any }, { complete, now, signal: sig });
    expect(r.status).toBe("no_providers");
    expect(r.reason).toBe("sin_claves");
    expect(complete).not.toHaveBeenCalled();
  });

  it("dos proveedores: deduplica y marca consenso (agreement 2) + discrepancias", async () => {
    const complete = vi.fn(async (slot: any) => {
      if (slot.provider === "anthropic") return liveResult("anthropic", slot.model, JSON.stringify({ proposals: [
        { title: "Responder reseñas negativas", impact: 80, effort: 20, confidence: 85, description: "d", rationale: "r" },
        { title: "Publicar novedad semanal", impact: 60, effort: 30, confidence: 70 }
      ] }));
      return liveResult("openai", slot.model, JSON.stringify({ proposals: [
        { title: "Responder reseñas negativas!", impact: 70, effort: 25, confidence: 80 },
        { title: "Añadir fotos del local", impact: 55, effort: 20, confidence: 75 }
      ] }));
    });
    const r = await runAiCouncil(base, { complete, now, signal: sig });
    expect(r.status).toBe("done");
    expect(r.models).toHaveLength(2);
    const consensus = r.proposals.find((p) => p.title.startsWith("Responder"));
    expect(consensus?.agreement).toBe(2);
    expect(consensus?.providers.sort()).toEqual(["anthropic", "openai"]);
    // las propuestas de un solo modelo van a discrepancias
    expect(r.discrepancies.length).toBe(2);
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("un proveedor falla → partial (el otro responde)", async () => {
    const complete = vi.fn(async (slot: any) => {
      if (slot.provider === "openai") throw new Error("boom");
      return liveResult("anthropic", slot.model, JSON.stringify({ proposals: [{ title: "X", impact: 50, effort: 10, confidence: 50 }] }));
    });
    const r = await runAiCouncil(base, { complete, now, signal: sig });
    expect(r.status).toBe("partial");
    expect(r.models.find((m) => m.provider === "openai")?.status).toBe("error");
  });

  it("todos fallan → error", async () => {
    const complete = vi.fn(async () => { throw new Error("down"); });
    const r = await runAiCouncil(base, { complete, now, signal: sig });
    expect(r.status).toBe("error");
  });
});
