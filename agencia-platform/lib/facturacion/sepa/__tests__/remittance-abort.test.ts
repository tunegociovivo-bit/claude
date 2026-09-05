import { describe, expect, it, vi } from "vitest";
import { processCandidatesUntilAborted } from "../remittance";

describe("SEPA candidate cancellation", () => {
  it("does not process remaining candidates after cancellation", async () => {
    const controller = new AbortController();
    const processor = vi.fn(async ({ invoiceId }: { invoiceId: string }) => {
      controller.abort();
      return { created: true, requestId: invoiceId };
    });

    await expect(processCandidatesUntilAborted(
      [{ invoiceId: "invoice-1" }, { invoiceId: "invoice-2" }],
      processor,
      controller.signal
    )).rejects.toThrow();
    expect(processor).toHaveBeenCalledTimes(1);
  });
});
