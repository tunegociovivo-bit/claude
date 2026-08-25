import { describe, expect, it } from "vitest";
import { canDeleteBankJobStatus, canRequeueBankJobStatus } from "../agent";

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

describe("bank job requeue policy", () => {
  it("requeues only a previously cancelled job after a fresh approval", () => {
    expect(canRequeueBankJobStatus("CANCELLED")).toBe(true);
    expect(canRequeueBankJobStatus("PREPARED_PENDING_SIGNATURE")).toBe(false);
  });
});
