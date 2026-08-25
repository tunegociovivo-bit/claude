import { describe, expect, it } from "vitest";
import { BANK_AGENT_OFFLINE_MS, isBankAgentOffline } from "@/lib/facturacion/sepa/agent-watchdog";

describe("bank agent offline watchdog", () => {
  const now = new Date("2026-08-25T10:00:00.000Z");

  it("waits for the full offline window", () => {
    expect(isBankAgentOffline(new Date(now.getTime() - BANK_AGENT_OFFLINE_MS + 1), now)).toBe(false);
    expect(isBankAgentOffline(new Date(now.getTime() - BANK_AGENT_OFFLINE_MS), now)).toBe(true);
  });

  it("does not flag an agent that never connected", () => {
    expect(isBankAgentOffline(null, now)).toBe(false);
  });
});
