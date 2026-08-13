import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_SIGNAL_TYPES,
  buildSignalFingerprint,
  normalizeOpportunitySignal,
  scoreOpportunitySignal
} from "../core";

describe("Opportunity Hunter core", () => {
  it("supports every requested commercial trigger", () => {
    expect(OPPORTUNITY_SIGNAL_TYPES).toEqual([
      "grant_awarded",
      "tender_won",
      "capital_increase",
      "ownership_or_director_change",
      "new_location",
      "franchise_expansion",
      "commercial_hiring",
      "investment_received",
      "company_or_trademark_registered",
      "upcoming_campaign_opening_or_launch"
    ]);
  });

  it("builds the same fingerprint for equivalent company and source records", () => {
    const first = buildSignalFingerprint({
      type: "grant_awarded",
      companyName: "  Clínica Áurea, S.L. ",
      companyTaxId: "B-12345678",
      sourceUrl: "https://example.com/grants/42?utm_source=x",
      occurredAt: new Date("2026-08-10T12:00:00Z")
    });
    const second = buildSignalFingerprint({
      type: "grant_awarded",
      companyName: "clinica aurea sl",
      companyTaxId: "B12345678",
      sourceUrl: "https://example.com/grants/42",
      occurredAt: new Date("2026-08-10T18:00:00Z")
    });
    expect(first).toBe(second);
  });

  it("scores recent, verified and budget-backed signals highest", () => {
    const score = scoreOpportunitySignal({
      type: "grant_awarded",
      occurredAt: new Date("2026-08-12T10:00:00Z"),
      discoveredAt: new Date("2026-08-13T10:00:00Z"),
      amount: 120_000,
      evidenceCount: 2,
      sourceAuthority: "official",
      hasDecisionMaker: true,
      hasContactChannel: true
    });
    expect(score.score).toBeGreaterThanOrEqual(85);
    expect(score.tier).toBe("hot");
    expect(score.reasons).toContain("Presupuesto confirmado");
  });

  it("does not present weak unverified signals as sales-ready", () => {
    const score = scoreOpportunitySignal({
      type: "upcoming_campaign_opening_or_launch",
      occurredAt: null,
      discoveredAt: new Date("2026-08-13T10:00:00Z"),
      amount: null,
      evidenceCount: 1,
      sourceAuthority: "unknown",
      hasDecisionMaker: false,
      hasContactChannel: false
    });
    expect(score.score).toBeLessThan(50);
    expect(score.tier).toBe("watch");
  });

  it("rejects records without company, evidence URL or supported type", () => {
    expect(() => normalizeOpportunitySignal({ type: "grant_awarded" })).toThrow();
    expect(() => normalizeOpportunitySignal({
      type: "made_up",
      companyName: "Example",
      sourceUrl: "https://example.com"
    })).toThrow();
  });
});
