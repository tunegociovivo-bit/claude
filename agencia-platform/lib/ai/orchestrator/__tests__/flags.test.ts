/**
 * Flags — MEDIUM #2: "on" y "live" habilitan el orquestador; live no lo apaga en silencio.
 */
import { describe, it, expect } from "vitest";
import { orchestratorEnabled, orchestratorMode, multiModelEnabled, autonomyKillSwitch } from "../flags";

describe("orchestratorEnabled / orchestratorMode", () => {
  it("'on' habilita en shadow", () => {
    expect(orchestratorEnabled({ AI_RUN_ORCHESTRATOR: "on" } as any)).toBe(true);
    expect(orchestratorMode({ AI_RUN_ORCHESTRATOR: "on" } as any)).toBe("shadow");
  });
  it("'live' TAMBIÉN habilita (no apaga el scheduler) y modo live", () => {
    expect(orchestratorEnabled({ AI_RUN_ORCHESTRATOR: "live" } as any)).toBe(true);
    expect(orchestratorMode({ AI_RUN_ORCHESTRATOR: "live" } as any)).toBe("live");
  });
  it("off / vacío → deshabilitado", () => {
    expect(orchestratorEnabled({} as any)).toBe(false);
    expect(orchestratorEnabled({ AI_RUN_ORCHESTRATOR: "off" } as any)).toBe(false);
  });
  it("multiModel y kill-switch opt-in", () => {
    expect(multiModelEnabled({ AI_MULTIMODEL: "on" } as any)).toBe(true);
    expect(multiModelEnabled({} as any)).toBe(false);
    expect(autonomyKillSwitch({ HUB_AUTONOMY_KILL: "on" } as any)).toBe(true);
    expect(autonomyKillSwitch({} as any)).toBe(false);
  });
});
