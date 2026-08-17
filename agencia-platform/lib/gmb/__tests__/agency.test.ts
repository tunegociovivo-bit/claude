import { describe, it, expect } from "vitest";
import { evaluateAlerts, computeAlertTransition, SLA_MINUTES, type AlertSignals } from "../alerts";
import { filterPortfolio, sortPortfolio, portfolioTotals, type PortfolioRow } from "../portfolio";
import { generateShareToken, hashToken, isShareValid, expiryFromDays, redactReportForShare } from "../report-share";

const noSignals: AlertSignals = { unrepliedReviews: 0, negativeUnreplied: 0, brokenCitations: 0, rankingDropKeywords: 0, daysSinceLastPost: 5, connectionDown: false };

describe("evaluateAlerts", () => {
  it("sin problemas → sin alertas", () => {
    expect(evaluateAlerts("c1", noSignals)).toHaveLength(0);
  });
  it("reseña negativa sin responder → alerta critical con dedupKey y deep link", () => {
    const a = evaluateAlerts("c1", { ...noSignals, negativeUnreplied: 2, unrepliedReviews: 3 });
    const neg = a.find((x) => x.type === "negative_review")!;
    expect(neg.severity).toBe("critical");
    expect(neg.dedupKey).toBe("c1:negative_review");
    expect(neg.deepLink).toContain("client=c1");
  });
  it("contenido vencido respeta umbral (default 30 días)", () => {
    expect(evaluateAlerts("c1", { ...noSignals, daysSinceLastPost: 20 }).some((x) => x.type === "content_stale")).toBe(false);
    expect(evaluateAlerts("c1", { ...noSignals, daysSinceLastPost: 40 }).some((x) => x.type === "content_stale")).toBe(true);
  });
  it("regla deshabilitada no dispara", () => {
    const a = evaluateAlerts("c1", { ...noSignals, brokenCitations: 5 }, { broken_citation: { enabled: false } });
    expect(a.some((x) => x.type === "broken_citation")).toBe(false);
  });
  it("umbral y severidad configurables por regla", () => {
    const a = evaluateAlerts("c1", { ...noSignals, unrepliedReviews: 2 }, { unreplied_reviews: { enabled: true, severity: "critical", threshold: 5 } });
    expect(a.some((x) => x.type === "unreplied_reviews")).toBe(false); // 2 < 5
    const b = evaluateAlerts("c1", { ...noSignals, unrepliedReviews: 6 }, { unreplied_reviews: { enabled: true, severity: "critical", threshold: 5 } });
    expect(b.find((x) => x.type === "unreplied_reviews")?.severity).toBe("critical");
  });
});

describe("computeAlertTransition + SLA", () => {
  it("open→ack→resolve; reopen desde resolved", () => {
    expect(computeAlertTransition("open", "ack")).toMatchObject({ ok: true, next: "ack" });
    expect(computeAlertTransition("ack", "resolve")).toMatchObject({ ok: true, next: "resolved" });
    expect(computeAlertTransition("resolved", "reopen")).toMatchObject({ ok: true, next: "open" });
    expect(computeAlertTransition("resolved", "ack").ok).toBe(false);
  });
  it("SLA critical < warning < info", () => {
    expect(SLA_MINUTES.critical).toBeLessThan(SLA_MINUTES.warning);
    expect(SLA_MINUTES.warning).toBeLessThan(SLA_MINUTES.info);
  });
});

const rows: PortfolioRow[] = [
  { clientId: "a", name: "Alpha", category: "café", score: 80, unreplied: 0, brokenCitations: 1, rankingDrop: 0, contentStaleDays: 10, connectionOk: true, openAlerts: 1, criticalAlerts: 0 },
  { clientId: "b", name: "Beta", category: "dental", score: 40, unreplied: 5, brokenCitations: 3, rankingDrop: 2, contentStaleDays: 60, connectionOk: false, openAlerts: 4, criticalAlerts: 2 }
];

describe("portfolio filter/sort/totals", () => {
  it("búsqueda por nombre/categoría", () => {
    expect(filterPortfolio(rows, { search: "dental" }).map((r) => r.clientId)).toEqual(["b"]);
  });
  it("solo con alertas críticas", () => {
    expect(filterPortfolio(rows, { onlyCritical: true }).map((r) => r.clientId)).toEqual(["b"]);
  });
  it("orden por score desc", () => {
    expect(sortPortfolio(rows, "score", "desc").map((r) => r.clientId)).toEqual(["a", "b"]);
  });
  it("totales agregados", () => {
    const t = portfolioTotals(rows);
    expect(t.clients).toBe(2);
    expect(t.openAlerts).toBe(5);
    expect(t.critical).toBe(2);
    expect(t.avgScore).toBe(60);
  });
});

describe("report-share token", () => {
  it("token → hash estable; el claro no es el hash", () => {
    const { token, hash } = generateShareToken();
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toBe(token);
  });
  it("validez: expirado → invalid; revocado → invalid", () => {
    const future = expiryFromDays(30);
    expect(isShareValid({ expiresAt: future }).valid).toBe(true);
    expect(isShareValid({ expiresAt: new Date(Date.now() - 1000) }).valid).toBe(false);
    expect(isShareValid({ expiresAt: future, revokedAt: new Date() }).valid).toBe(false);
  });
  it("redacta PII (dirección) por defecto", () => {
    const r = { client: { name: "X", address: "C/ Calvario 32" } };
    expect(redactReportForShare(r, false).client.address).toBeUndefined();
    expect(redactReportForShare(r, true).client.address).toBe("C/ Calvario 32");
  });
});
