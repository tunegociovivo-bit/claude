import { describe, it, expect } from "vitest";
import { isQuietHour, remainingDailyBudget, planAutopilot, type AutopilotPolicy } from "../autopilot";

const base: AutopilotPolicy = { mode: "execute_safe", dailyLimit: 3, quietStart: null, quietEnd: null, minConfidence: 70, allowedModules: null, killSwitch: false, executedToday: 0, executedDate: null };

describe("isQuietHour", () => {
  it("rango normal", () => { expect(isQuietHour(3, 1, 6)).toBe(true); expect(isQuietHour(8, 1, 6)).toBe(false); });
  it("cruza medianoche 22→7", () => { expect(isQuietHour(23, 22, 7)).toBe(true); expect(isQuietHour(2, 22, 7)).toBe(true); expect(isQuietHour(12, 22, 7)).toBe(false); });
  it("sin quiet hours", () => expect(isQuietHour(3)).toBe(false));
});

describe("remainingDailyBudget", () => {
  it("reinicia si cambia el día", () => {
    expect(remainingDailyBudget({ ...base, executedToday: 2, executedDate: "2026-08-15" }, "2026-08-16")).toBe(3);
    expect(remainingDailyBudget({ ...base, executedToday: 2, executedDate: "2026-08-16" }, "2026-08-16")).toBe(1);
  });
});

describe("planAutopilot", () => {
  const actions = [
    { id: "a1", status: "suggested" as const, external: false, module: "content", confidence: 90 },
    { id: "a2", status: "suggested" as const, external: false, module: "presence", confidence: 50 }, // baja confianza
    { id: "a3", status: "suggested" as const, external: true, module: "reviews", confidence: 90 } // externa
  ];
  it("kill switch → inactivo", () => expect(planAutopilot({ policy: { ...base, killSwitch: true }, actions, hour: 12, todayISO: "2026-08-16" }).reason).toBe("kill_switch"));
  it("suggest_only → inactivo", () => expect(planAutopilot({ policy: { ...base, mode: "suggest_only" }, actions, hour: 12, todayISO: "2026-08-16" }).reason).toBe("suggest_only"));
  it("quiet hours → inactivo", () => expect(planAutopilot({ policy: { ...base, quietStart: 0, quietEnd: 8 }, actions, hour: 3, todayISO: "2026-08-16" }).reason).toBe("quiet_hours"));
  it("execute_safe: avanza interna de alta confianza, salta baja confianza, externa→needs_approval", () => {
    const p = planAutopilot({ policy: base, actions, hour: 12, todayISO: "2026-08-16" });
    expect(p.active).toBe(true);
    const a1 = p.toAdvance.find((x) => x.actionId === "a1");
    expect(a1?.commands).toContain("execute");
    expect(p.skipped.find((x) => x.actionId === "a2")?.reason).toMatch(/confidence/);
    const a3 = p.toAdvance.find((x) => x.actionId === "a3");
    expect(a3?.commands).toEqual(["request_approval"]); // externa no se ejecuta
  });
  it("respeta el límite diario para ejecuciones internas", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, status: "suggested" as const, external: false, module: "content", confidence: 90 }));
    const p = planAutopilot({ policy: { ...base, dailyLimit: 2 }, actions: many, hour: 12, todayISO: "2026-08-16" });
    const executed = p.toAdvance.filter((x) => x.commands.includes("execute")).length;
    expect(executed).toBe(2);
    expect(p.skipped.filter((x) => x.reason === "daily_limit").length).toBe(3);
  });
  it("módulos permitidos filtran", () => {
    const p = planAutopilot({ policy: { ...base, allowedModules: ["citations"] }, actions, hour: 12, todayISO: "2026-08-16" });
    expect(p.skipped.find((x) => x.actionId === "a1")?.reason).toBe("module_not_allowed");
  });
});
