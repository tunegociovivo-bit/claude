import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ access: vi.fn(), queue: vi.fn(), viewer: vi.fn() }));
vi.mock("@/lib/api/handler", () => ({ withApi: (_options: unknown, handler: any) => (request: NextRequest) => handler(request, { api: { workspaceId: "workspace-a", userId: "user-a" } }) }));
vi.mock("@/lib/mobile/automation-access", () => ({ loadMobileAutomationAccess: mocks.access }));
vi.mock("@/lib/mobile/station-relay", () => ({ queueCommand: mocks.queue, markViewer: mocks.viewer }));
import { POST } from "@/app/api/v1/mobile/station/command/route";

const testId = "12345678-1234-1234-1234-123456789abc";
const config = { name: "Test", business: "Negocio", keyword: "negocio", urls: ["https://example.com/"], seconds: 30 };
const request = (body: unknown) => new NextRequest("https://hub.test/api/v1/mobile/station/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ phones: [{ active: true, deviceSerial: "serial-a" }] }); });

it("uses operator permissions and queues QA only within the authorized workspace and phone", async () => {
  const response = await POST(request({ type: "startWebQa", deviceSerial: "serial-a", testId, config }), {} as any);
  expect(response.status).toBe(200);
  expect(mocks.access).toHaveBeenCalledWith("workspace-a", "user-a", { manager: true });
  expect(mocks.queue).toHaveBeenCalledWith("workspace-a", "serial-a", expect.objectContaining({ type: "startWebQa", testId, config }));
});
it("rejects phones outside the workspace without queueing a command", async () => {
  await expect(POST(request({ type: "startWebQa", deviceSerial: "other-serial", testId, config }), {} as any)).rejects.toThrow(/encontrado/);
  expect(mocks.queue).not.toHaveBeenCalled();
});
it("rejects cross-origin or sensitive route configurations from raw API clients", async () => {
  for (const urls of [["https://example.com/", "https://other.example/"], ["https://example.com/checkout"]]) {
    await expect(POST(request({ type: "startWebQa", deviceSerial: "serial-a", testId, config: { ...config, urls } }), {} as any)).rejects.toThrow();
  }
  expect(mocks.queue).not.toHaveBeenCalled();
});
it("uses a dedicated stop command tied to a test identifier", async () => {
  await POST(request({ type: "stopWebQa", deviceSerial: "serial-a", testId }), {} as any);
  expect(mocks.queue).toHaveBeenCalledWith("workspace-a", "serial-a", expect.objectContaining({ type: "stopWebQa", testId }));
});
it("does not bypass revoked operator access", async () => {
  mocks.access.mockRejectedValue(new Error("Sin permiso"));
  await expect(POST(request({ type: "startWebQa", deviceSerial: "serial-a", testId, config }), {} as any)).rejects.toThrow("Sin permiso");
  expect(mocks.queue).not.toHaveBeenCalled();
});
