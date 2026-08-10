import { describe, expect, it } from "vitest";
import { canDeleteBankJobStatus } from "../agent";

describe("bank job deletion policy", () => {
  it.each(["PENDING", "NEEDS_USER", "FAILED", "CANCELLED"])("allows deleting %s jobs", (status) => {
    expect(canDeleteBankJobStatus(status)).toBe(true);
  });

  it.each(["CLAIMED", "RUNNING", "PREPARED_PENDING_SIGNATURE"])("protects %s jobs", (status) => {
    expect(canDeleteBankJobStatus(status)).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(canDeleteBankJobStatus("UNKNOWN")).toBe(false);
  });
});
