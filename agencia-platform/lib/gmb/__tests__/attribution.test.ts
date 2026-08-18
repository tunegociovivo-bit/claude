import { describe, it, expect } from "vitest";
import { validateUtm, buildUtmUrl, eventDedupKey, aggregateEvents, goalProgress, type AttrEvent } from "../attribution";

describe("validateUtm", () => {
  it("exige source/medium/campaign y base válida", () => {
    expect(validateUtm("x", { source: "", medium: "cpc", campaign: "verano" }).ok).toBe(false);
    expect(validateUtm("negocio.es/oferta", { source: "google", medium: "cpc", campaign: "verano" }).ok).toBe(true); // dominio pelado se normaliza a https://
    expect(validateUtm("no url con espacios", { source: "google", medium: "cpc", campaign: "verano" }).ok).toBe(false); // base inválida
  });
  it("construye URL con UTMs normalizados", () => {
    const v = validateUtm("https://negocio.es/oferta", { source: "Google Ads", medium: "CPC", campaign: "Verano 2026", term: "café Málaga" });
    expect(v.ok).toBe(true);
    expect(v.url).toContain("utm_source=google-ads");
    expect(v.url).toContain("utm_campaign=verano-2026");
    expect(v.url).toContain("utm_term=cafe-malaga");
  });
});

describe("eventDedupKey", () => {
  it("mismo cliente+tipo+fingerprint+día → misma clave (idempotencia)", () => {
    const a = eventDedupKey("c1", "click", "fp1", "2026-08-17");
    const b = eventDedupKey("c1", "click", "fp1", "2026-08-17");
    const c = eventDedupKey("c1", "click", "fp1", "2026-08-18");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("aggregateEvents — comparación temporal, sin inventar", () => {
  const from = new Date("2026-08-01"), to = new Date("2026-08-31T23:59:59");
  const prevFrom = new Date("2026-07-01"), prevTo = new Date("2026-07-31T23:59:59");
  const events: AttrEvent[] = [
    { type: "click", source: "google", campaign: "verano", occurredAt: "2026-08-05" },
    { type: "click", source: "google", campaign: "verano", occurredAt: "2026-08-06" },
    { type: "call", source: "instagram", campaign: "verano", occurredAt: "2026-08-10" },
    { type: "click", source: "google", campaign: "verano", occurredAt: "2026-07-15" } // periodo anterior
  ];
  it("cuenta actual vs anterior por tipo + fuentes/campañas", () => {
    const agg = aggregateEvents(events, from, to, prevFrom, prevTo);
    expect(agg.current.click).toBe(2);
    expect(agg.current.call).toBe(1);
    expect(agg.previous.click).toBe(1);
    expect(agg.deltaPct.click).toBe(100); // 1→2 = +100%
    expect(agg.bySource[0].source).toBe("google");
    expect(agg.total).toBe(3);
  });
  it("sin eventos → todo 0 (estado honesto)", () => {
    const agg = aggregateEvents([], from, to, prevFrom, prevTo);
    expect(agg.total).toBe(0);
    expect(agg.current.click).toBe(0);
  });
});

describe("goalProgress", () => {
  it("progreso por métrica acotado a 100%", () => {
    const p = goalProgress({ click: 30, call: 5, directions: 0, request: 0 }, [{ metric: "clicks", target: 20 }, { metric: "calls", target: 10 }]);
    expect(p.find((x) => x.metric === "clicks")?.pct).toBe(100); // 30/20 → 100 (cap)
    expect(p.find((x) => x.metric === "calls")?.pct).toBe(50);
  });
});
