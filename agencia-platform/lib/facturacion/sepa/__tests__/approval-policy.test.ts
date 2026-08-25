import { describe, expect, it } from "vitest";
import { requiresExplicitApproval } from "../approval-policy";

describe("SEPA approval policy", () => {
  it("requires an explicit administrator decision for newly imported invoices", () => {
    expect(requiresExplicitApproval({ source: "HOLDED", importedNow: true })).toBe(true);
  });

  it("cannot be bypassed by an environment auto-approval flag", () => {
    expect(
      requiresExplicitApproval({ source: "HOLDED", importedNow: true, legacyAutoApproveFlag: true })
    ).toBe(true);
  });
});
