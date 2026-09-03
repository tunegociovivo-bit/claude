import { describe, expect, it } from "vitest";
import { chooseProspectingVariant, domainFromProspect, prospectConditionMatches, scoreProspect, summarizeProspectingSources } from "../prospecting-intelligence";

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
  it("groups paginated LinkedIn imports by their canonical search",()=>{
    const sources=summarizeProspectingSources([
      {metadata:{source:"linkedin_search",sourceUrl:"https://www.linkedin.com/search/results/people/?keywords=franquicia+alcampo&page=1",capturedAt:"2026-08-30T08:00:00.000Z"},resolutionStatus:"resolved"},
      {metadata:{source:"linkedin_search",sourceUrl:"https://www.linkedin.com/search/results/people/?keywords=franquicia+alcampo&page=2",capturedAt:"2026-08-30T08:05:00.000Z"},resolutionStatus:"retry_pending"}
    ]);
    expect(sources).toHaveLength(1);expect(sources[0]).toEqual(expect.objectContaining({label:"franquicia alcampo",total:2,resolved:1,latest:"2026-08-30T08:05:00.000Z"}));expect(sources[0].url).not.toContain("page=");
  });
  it("does not expose unsafe or credential-bearing source URLs",()=>{
    expect(summarizeProspectingSources([{metadata:{source:"manual",sourceUrl:"javascript:alert(1)"},resolutionStatus:null}])[0].url).toBeNull();
    expect(summarizeProspectingSources([{metadata:{source:"linkedin_search",sourceUrl:"http://linkedin.com/search/results/people/"},resolutionStatus:null}])[0].url).toBeNull();
    expect(summarizeProspectingSources([{metadata:{source:"linkedin_search",sourceUrl:"https://linkedin.com.evil.test/search/results/people/"},resolutionStatus:null}])[0].url).toBeNull();
    expect(summarizeProspectingSources([{metadata:{source:"linkedin_search",sourceUrl:"https://user:secret@linkedin.com/search/results/people/?keywords=cmo"},resolutionStatus:null}])[0].url).toBe("https://linkedin.com/search/results/people/?keywords=cmo");
  });
  it("merges database aggregates without loading prospect metadata",()=>{
    const result=summarizeProspectingSources([{metadata:{source:"linkedin_search",sourceUrl:"https://www.linkedin.com/search/results/people/?keywords=cmo&page=1",capturedAt:"2026-08-30T10:00:00Z"},total:40,resolved:12},{metadata:{source:"linkedin_search",sourceUrl:"https://www.linkedin.com/search/results/people/?keywords=cmo&page=2",capturedAt:"2026-08-30T11:00:00Z"},total:35,resolved:8}]);
    expect(result[0]).toEqual(expect.objectContaining({total:75,resolved:20,latest:"2026-08-30T11:00:00Z"}));
  });
});
