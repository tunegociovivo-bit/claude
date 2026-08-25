import { describe, expect, it } from "vitest";
import {
  buildFranchiseAudit,
  buildFranchiseAuditSvg,
  selectFranchiseOffer,
  summarizeFranchisePipeline
} from "../franchise-audit";

const locations = [
  { name: "Marca Centro", rating: 4.8, userRatingCount: 420, website: "https://marca.es/centro", phone: "910000001", businessStatus: "OPERATIONAL" },
  { name: "Marca Norte", rating: 3.1, userRatingCount: 80, website: null, phone: null, businessStatus: "OPERATIONAL" },
  { name: "Marca Sur", rating: 4.1, userRatingCount: 2, website: "https://marca.es/sur", phone: "910000003", businessStatus: "OPERATIONAL" },
  { name: "Marca Este", rating: 2.9, userRatingCount: 36, website: "https://otro-dominio.es", phone: "910000004", businessStatus: "CLOSED_TEMPORARILY" }
] as any[];

describe("franchise audit", () => {
  it("measures network inconsistency and produces evidence-backed findings", () => {
    const audit = buildFranchiseAudit("Marca", locations, { officialDomain: "marca.es" });
    expect(audit.metrics.sampled).toBe(4);
    expect(audit.metrics.noWebsitePct).toBe(25);
    expect(audit.metrics.noPhonePct).toBe(25);
    expect(audit.metrics.lowRatingPct).toBe(50);
    expect(audit.metrics.domainMismatchPct).toBe(25);
    expect(audit.metrics.closedPct).toBe(25);
    expect(audit.score).toBeGreaterThanOrEqual(60);
    expect(audit.findings.every((finding) => finding.evidence.length > 0)).toBe(true);
  });

  it("labels visual evidence as a simulation and escapes the brand", () => {
    const audit = buildFranchiseAudit("Marca <Demo>", locations, { officialDomain: "marca.es" });
    const svg = buildFranchiseAuditSvg(audit);
    expect(svg).toContain("SIMULACIÓN VISUAL BASADA EN DATOS OBSERVADOS");
    expect(svg).toContain("Marca &lt;Demo&gt;");
    expect(svg).not.toContain("Marca <Demo>");
  });

  it("selects an offer from the strongest measured problem", () => {
    const audit = buildFranchiseAudit("Marca", locations, { officialDomain: "marca.es" });
    expect(selectFranchiseOffer(audit).key).toBe("network_recovery");
  });
});

describe("franchise pipeline", () => {
  it("summarizes franchise-specific commercial stages", () => {
    expect(summarizeFranchisePipeline([
      { stage: "audited" },
      { stage: "audit_sent" },
      { stage: "meeting" },
      { stage: "won" }
    ])).toEqual({ audited: 1, audit_sent: 1, meeting: 1, won: 1, total: 4 });
  });
});
