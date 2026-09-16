import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), completeJson: vi.fn(), access: vi.fn(), linked: vi.fn() }));
vi.mock("@/lib/api/auth", async (original) => ({ ...await original<typeof import("@/lib/api/auth")>(), authenticate: mocks.authenticate }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
vi.mock("@/lib/ai/anthropic", () => ({ completeJson: mocks.completeJson }));
vi.mock("@/lib/mobile/automation-access", () => ({ loadMobileAutomationAccess: mocks.access, requireLinkedMobile: mocks.linked }));
import { POST as analyze } from "../analyze/route";
import { POST as filter } from "../filter/route";
const config = { targetUrl: "", niche: "franquicias", criteria: "", replyGuidance: "Considero que los supermercados serán rentables", postsPerGroup: 5, commentScreensPerPost: 5 };
const request = (body: unknown) => new NextRequest("https://hub.example/api/v1/mobile/facebook/conversations/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  mocks.access.mockResolvedValue({ phones: [] });
});
describe("Facebook conversation AI endpoints", () => {
  it("returns drafts only for observed comment IDs and discards duplicates", async () => {
    mocks.completeJson.mockResolvedValue({ replies: [{ id: "a", reply: "En mi opinión…", reason: "Contexto" }, { id: "forged", reply: "Inventado", reason: "" }, { id: "a", reply: "Duplicado", reason: "" }] });
    const response = await analyze(request({ phoneKey: "phone", deviceSerial: "serial", config, groupName: "Franquicias", comments: [{ id: "a", author: "Ana", text: "¿Qué supermercado recomiendas?" }] }), { params: {} });
    expect(response.status).toBe(200);
    expect((await response.json()).replies).toEqual([{ id: "a", reply: "En mi opinión…", reason: "Contexto" }]);
    expect(mocks.access).toHaveBeenCalledWith("w1", "u1", { manager: true });
    expect(mocks.linked).toHaveBeenCalledWith([], "phone", "serial");
    expect(mocks.completeJson).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining(config.replyGuidance) }));
  });
  it("filters only the groups supplied by the phone", async () => {
    mocks.completeJson.mockResolvedValue({ indexes: [0, 0, 999, -1] });
    const response = await filter(request({ phoneKey: "phone", deviceSerial: "serial", niche: "franquicias", names: ["Franquicias España", "Senderismo"] }), { params: {} });
    expect((await response.json()).names).toEqual(["Franquicias España"]);
  });
  it("includes every supplied group when the niche is blank", async () => {
    const response = await filter(request({ phoneKey: "phone", deviceSerial: "serial", niche: "", names: ["Franquicias España", "Senderismo"] }), { params: {} });
    expect((await response.json()).names).toHaveLength(2);
    expect(mocks.completeJson).not.toHaveBeenCalled();
  });
});
