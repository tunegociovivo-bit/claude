import { describe, expect, it } from "vitest";
import { canReissueApproval, requiresExplicitApproval } from "../approval-policy";

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

describe("SEPA approval reissue policy", () => {
  it("allows an archived request to receive a fresh approval link", () => {
    expect(canReissueApproval({ status: "APPROVED", archived: true })).toBe(true);
  });

  it("does not replace an active approval link", () => {
    expect(canReissueApproval({ status: "PENDING_APPROVAL", archived: false, notified: true })).toBe(false);
  });

  it("recovers a pending request whose approval email was never completed", () => {
    expect(canReissueApproval({ status: "PENDING_APPROVAL", archived: false, notified: false })).toBe(true);
  });
});
