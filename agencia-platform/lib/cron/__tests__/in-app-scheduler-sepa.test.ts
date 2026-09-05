import { beforeEach, describe, expect, it, vi } from "vitest";

const { runSepa, runReminders } = vi.hoisted(() => ({
  runSepa: vi.fn().mockResolvedValue([]),
  runReminders: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../scheduler", () => ({ runReminders, runBriefing: vi.fn() }));
vi.mock("@/lib/facturacion/sepa/cron", () => ({ runSepaCronAllWorkspaces: runSepa }));
vi.mock("../distributed-lease", () => ({
  acquireCronLease: vi.fn().mockResolvedValue(true),
  releaseCronLease: vi.fn().mockResolvedValue(undefined),
  runWithTimeout: vi.fn((task: () => Promise<unknown>) => task()),
  CronTimeoutError: class CronTimeoutError extends Error {}
}));

describe("in-app scheduler SEPA backstop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs Holded and remittances independently from a blocked general tick", async () => {
    let sepaTick: (() => Promise<void>) | undefined;
    vi.stubGlobal("setTimeout", vi.fn((callback: () => Promise<void>, delay: number) => {
      if (delay === 15_000) sepaTick = callback;
      return 1 as any;
    }));
    vi.stubGlobal("setInterval", vi.fn(() => 1 as any));

    const { startInAppScheduler } = await import("../in-app-scheduler");
    startInAppScheduler();
    expect(sepaTick).toBeTypeOf("function");
    await sepaTick!();

    expect(runSepa).toHaveBeenCalledTimes(1);
  });
});
