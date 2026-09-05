import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw, executeRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $queryRaw: queryRaw, $executeRaw: executeRaw }
}));

describe("distributed cron lease", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only reports acquisition when the database returns the lease", async () => {
    queryRaw.mockResolvedValueOnce([{ name: "holded-sepa" }]).mockResolvedValueOnce([]);
    const { acquireCronLease } = await import("../distributed-lease");

    await expect(acquireCronLease("holded-sepa", "worker-a", 600_000)).resolves.toBe(true);
    await expect(acquireCronLease("holded-sepa", "worker-b", 600_000)).resolves.toBe(false);
  });

  it("releases only the lease owned by this worker", async () => {
    executeRaw.mockResolvedValue(1);
    const { releaseCronLease } = await import("../distributed-lease");

    await expect(releaseCronLease("holded-sepa", "worker-a")).resolves.toBeUndefined();
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("times out a hung task and aborts it", async () => {
    vi.useFakeTimers();
    const { runWithTimeout } = await import("../distributed-lease");
    let receivedSignal: AbortSignal | undefined;
    const result = runWithTimeout(async (signal) => {
      receivedSignal = signal;
      return await new Promise<never>(() => undefined);
    }, 1_000);
    const assertion = expect(result).rejects.toThrow("excedió 1000 ms");

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(receivedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
