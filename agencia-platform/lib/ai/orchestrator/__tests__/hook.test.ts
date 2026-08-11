/**
 * Slice 2c — hook de shadow del runner: OFF = coste cero; ON = registra sin
 * bloquear ni lanzar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { maybeRecordAutonomyShadow } from "../runner-hook";

const ORIG = { ...process.env };
let prisma: any;
beforeEach(() => {
  prisma = { aiApproval: { findMany: vi.fn().mockResolvedValue([]) } };
});
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("maybeRecordAutonomyShadow", () => {
  it("OFF (por defecto) → no consulta nada (coste cero)", async () => {
    delete process.env.HUB_AUTONOMY_SHADOW;
    maybeRecordAutonomyShadow(prisma, { workspaceId: "w1", action: "send_whatsapp_message" });
    await flush();
    expect(prisma.aiApproval.findMany).not.toHaveBeenCalled();
  });

  it("ON → consulta aprobaciones (scoped) y registra, sin lanzar", async () => {
    process.env.HUB_AUTONOMY_SHADOW = "on";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    maybeRecordAutonomyShadow(prisma, { workspaceId: "w1", action: "send_whatsapp_message" });
    await flush();
    expect(prisma.aiApproval.findMany).toHaveBeenCalled();
    expect(prisma.aiApproval.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0][0])).toContain("autonomy-shadow");
  });

  it("ON pero prisma falla → se traga el error (no rompe el runner)", async () => {
    process.env.HUB_AUTONOMY_SHADOW = "on";
    prisma.aiApproval.findMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => maybeRecordAutonomyShadow(prisma, { workspaceId: "w1", action: "x" })).not.toThrow();
    await flush();
  });
});
