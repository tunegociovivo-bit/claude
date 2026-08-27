import { beforeEach, describe, expect, it, vi } from "vitest";

const { runSepa, runReminders } = vi.hoisted(() => ({
  runSepa: vi.fn().mockResolvedValue([]),
  runReminders: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../scheduler", () => ({ runReminders, runBriefing: vi.fn() }));
vi.mock("@/lib/facturacion/sepa/cron", () => ({ runSepaCronAllWorkspaces: runSepa }));

describe("in-app scheduler SEPA backstop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the Holded and remittance cycle on the general five-minute tick", async () => {
    let generalTick: (() => Promise<void>) | undefined;
    vi.stubGlobal("setTimeout", vi.fn((callback: () => Promise<void>, delay: number) => {
      if (delay === 60_000) generalTick = callback;
      return 1 as any;
    }));
    vi.stubGlobal("setInterval", vi.fn(() => 1 as any));

    const { startInAppScheduler } = await import("../in-app-scheduler");
    startInAppScheduler();
    expect(generalTick).toBeTypeOf("function");
    await generalTick!();

    expect(runSepa).toHaveBeenCalledTimes(1);
  });
});
