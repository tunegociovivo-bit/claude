/**
 * Contrato FASE 3 — salud/SLA determinista, explicable y configurable.
 */
import { describe, it, expect } from "vitest";
import { computeHealth, mergeHealthConfig, DEFAULT_HEALTH_CONFIG, type HealthSignals } from "../health";

const base: HealthSignals = {
  overdueInvoiceCount: 0,
  overdueAmountCents: 0,
  daysSinceLastActivity: 1,
  openOverdueTaskCount: 0,
  hasMrr: true,
  activeProjectCount: 1,
  avgProjectProgress: 80,
  status: "ACTIVE"
};

describe("computeHealth — determinista y explicable", () => {
  it("cuenta sana → score 100, band good, sin factores de penalización", () => {
    const r = computeHealth(base);
    expect(r.score).toBe(100);
    expect(r.band).toBe("good");
    expect(r.factors.every((f) => f.points === 0)).toBe(true);
  });

  it("la suma de puntos de los factores explica exactamente el score", () => {
    const r = computeHealth({ ...base, overdueInvoiceCount: 2, overdueAmountCents: 30000, openOverdueTaskCount: 3 });
    const penalty = r.factors.reduce((s, f) => s + f.points, 0);
    expect(r.score).toBe(Math.max(0, 100 + penalty));
    // 2 facturas *12 + 3 tareas *6 = -24 -18 = -42 → 58
    expect(r.score).toBe(58);
    expect(r.band).toBe("warn");
  });

  it("facturas vencidas → alerta critical y próximo paso", () => {
    const r = computeHealth({ ...base, overdueInvoiceCount: 1, overdueAmountCents: 5000 });
    expect(r.alerts.some((a) => a.level === "critical")).toBe(true);
    expect(r.nextSteps.some((s) => /vencida/i.test(s))).toBe(true);
  });

  it("actividad DESCONOCIDA no penaliza (dato ausente), solo se anota", () => {
    const r = computeHealth({ ...base, daysSinceLastActivity: null });
    expect(r.factors.some((f) => f.key === "stale_activity")).toBe(false);
    expect(r.dataQuality.activityKnown).toBe(false);
    expect(r.dataQuality.notes.length).toBeGreaterThan(0);
    expect(r.score).toBe(100);
  });

  it("actividad estancada penaliza según umbral", () => {
    const r = computeHealth({ ...base, daysSinceLastActivity: 45 });
    expect(r.factors.find((f) => f.key === "stale_activity")?.points).toBe(-DEFAULT_HEALTH_CONFIG.weights.staleActivity);
  });

  it("penalización de facturas está ACOTADA por el cap", () => {
    const r = computeHealth({ ...base, overdueInvoiceCount: 99, overdueAmountCents: 100000 });
    // cap 4 * 12 = 48
    expect(r.factors.find((f) => f.key === "overdue_invoices")?.points).toBe(-48);
  });

  it("config configurable altera pesos/umbrales de forma determinista", () => {
    const cfg = mergeHealthConfig({ weights: { staleActivity: 50 }, thresholds: { staleActivityDays: 10 } });
    const r = computeHealth({ ...base, daysSinceLastActivity: 20 }, cfg);
    expect(r.factors.find((f) => f.key === "stale_activity")?.points).toBe(-50);
  });

  it("mergeHealthConfig SANEA NaN/negativos/no-numéricos → default (preserva determinismo)", () => {
    const cfg = mergeHealthConfig({
      weights: { staleActivity: NaN as any, overduePerInvoice: -20 as any, noMrrActive: "x" as any },
      thresholds: { staleActivityDays: -5 as any }
    });
    expect(cfg.weights.staleActivity).toBe(DEFAULT_HEALTH_CONFIG.weights.staleActivity);
    expect(cfg.weights.overduePerInvoice).toBe(DEFAULT_HEALTH_CONFIG.weights.overduePerInvoice);
    expect(cfg.weights.noMrrActive).toBe(DEFAULT_HEALTH_CONFIG.weights.noMrrActive);
    expect(cfg.thresholds.staleActivityDays).toBe(DEFAULT_HEALTH_CONFIG.thresholds.staleActivityDays);
    // y el score sigue siendo un número finito
    const r = computeHealth({ ...base, overdueInvoiceCount: 2, overdueAmountCents: 1 }, cfg);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it("cliente no ACTIVE → factor informativo (0 puntos), no penaliza por sin-MRR", () => {
    const r = computeHealth({ ...base, status: "PAUSED", hasMrr: false });
    expect(r.factors.find((f) => f.key === "status")?.points).toBe(0);
    expect(r.factors.some((f) => f.key === "no_mrr")).toBe(false);
  });

  it("score nunca sale de [0,100]", () => {
    const r = computeHealth({ ...base, overdueInvoiceCount: 99, overdueAmountCents: 1, openOverdueTaskCount: 99, daysSinceLastActivity: 999, hasMrr: false, avgProjectProgress: 0 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
