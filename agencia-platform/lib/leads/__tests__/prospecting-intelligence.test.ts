import { describe, expect, it } from "vitest";
import { chooseProspectingVariant, domainFromProspect, prospectConditionMatches, scoreProspect } from "../prospecting-intelligence";

const base = { email: null, phone: null, linkedinUrl: null, jobTitle: null, companyName: null, website: null, status: "pending", repliedAt: null };

describe("prospecting intelligence", () => {
  it("scores verified commercial signals without exceeding 100", () => {
    const result = scoreProspect({ ...base, email: "d@acme.es", phone: "+341", linkedinUrl: "https://linkedin.com/in/d", website: "https://acme.es", companyName: "Acme", jobTitle: "Director de marketing", status: "qualified", repliedAt: new Date() });
    expect(result.score).toBe(100);
    expect(result.breakdown.role).toBe(22);
  });
  it("evaluates conditional branches", () => {
    expect(prospectConditionMatches({ field: "email", operator: "exists" }, { ...base, email: "a@b.es" })).toBe(true);
    expect(prospectConditionMatches({ field: "score", operator: "gte", value: 60 }, { ...base, score: 59 })).toBe(false);
  });
  it("assigns A/B variants deterministically", () => {
    const variants = [{ body: "A" }, { body: "B" }];
    expect(chooseProspectingVariant(variants, "same-id")).toEqual(chooseProspectingVariant(variants, "same-id"));
  });
  it("extracts domains from websites or email", () => {
    expect(domainFromProspect({ website: "https://www.acme.es/path" })).toBe("acme.es");
    expect(domainFromProspect({ email: "x@company.com" })).toBe("company.com");
  });
});
