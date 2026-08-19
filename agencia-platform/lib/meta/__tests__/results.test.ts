import { describe, expect, it } from "vitest";
import { metaResultActionCandidates, metaResultValue } from "../results";

describe("Meta primary results", () => {
  it("does not add duplicate lead aliases", () => {
    const actions = [
      { action_type: "lead", value: "41" },
      { action_type: "onsite_conversion.lead_grouped", value: "41" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "41" }
    ];
    expect(metaResultValue(actions, metaResultActionCandidates([{ optimization_goal: "LEAD_GENERATION" }], "OUTCOME_LEADS"))).toBe(41);
  });

  it("uses the conversion event selected by the ad set", () => {
    const actions = [
      { action_type: "lead", value: "9" },
      { action_type: "offsite_conversion.fb_pixel_complete_registration", value: "39" }
    ];
    const candidates = metaResultActionCandidates([{ promoted_object: { custom_event_type: "COMPLETE_REGISTRATION" } }], "OUTCOME_LEADS");
    expect(metaResultValue(actions, candidates)).toBe(39);
  });
});
