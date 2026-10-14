import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/platforms-server", () => ({ userCanAccessPlatform: async () => true }));
import { canOperateMobileFarm } from "@/lib/mobile/automation-access";

describe("canOperateMobileFarm", () => {
  it("lets admins and explicitly assigned workers operate the phones", () => {
    const settings = { platforms: { mobile_farm: { enabled: true, restricted: true, memberIds: ["worker-1"] } } };
    expect(canOperateMobileFarm(settings, "admin", "ADMIN")).toBe(true);
    expect(canOperateMobileFarm(settings, "worker-1", "MEMBER")).toBe(true);
    expect(canOperateMobileFarm(settings, "worker-2", "MEMBER")).toBe(false);
  });
  it("keeps workers view-only when the platform is open to everyone without assignments", () => {
    expect(canOperateMobileFarm({}, "worker-1", "MEMBER")).toBe(false);
    expect(canOperateMobileFarm({ platforms: { mobile_farm: { enabled: true, memberIds: [] } } }, "worker-1", "MEMBER")).toBe(false);
  });
  it("denies everyone but admins when the platform is disabled", () => {
    expect(canOperateMobileFarm({ platforms: { mobile_farm: { enabled: false, memberIds: ["worker-1"] } } }, "worker-1", "MEMBER")).toBe(false);
  });
});
