import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, completeJsonMock, loadAccessMock, requireLinkedMobileMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  completeJsonMock: vi.fn(),
  loadAccessMock: vi.fn(),
  requireLinkedMobileMock: vi.fn()
}));

vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 10, resetAt: Date.now() + 60_000 })
}));
vi.mock("@/lib/ai/anthropic", () => ({ completeJson: completeJsonMock }));
vi.mock("@/lib/mobile/automation-access", () => ({
  loadMobileAutomationAccess: loadAccessMock,
  requireLinkedMobile: requireLinkedMobileMock
}));

import { POST } from "../route";

const screenshot = `data:image/png;base64,${Buffer.from("facebook groups screen").toString("base64")}`;

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("https://hub.example/api/v1/mobile/facebook/groups/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phoneKey: "principal",
      deviceSerial: "usb-1",
      query: "franquicias",
      criteria: "Solo España, actividad reciente y debates profesionales.",
      maxGroups: 8,
      screenImages: [screenshot],
      ...overrides
    })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  loadAccessMock.mockResolvedValue({ phones: [{ key: "principal", deviceSerial: "usb-1", active: true }] });
  requireLinkedMobileMock.mockReturnValue({ key: "principal" });
  completeJsonMock.mockResolvedValue({
    candidates: [
      {
        name: "Franquicias y Negocios rentables en España para emprender",
        details: "2.927 miembros · 2 publicaciones al día",
        relevanceScore: 96,
        reason: "Coincide con España, franquicias y actividad reciente.",
        recommended: true
      },
      {
        name: "Franquicias Baratas en México",
        details: "Público",
        relevanceScore: 31,
        reason: "No coincide con la ubicación solicitada.",
        recommended: false
      }
    ]
  });
});

describe("POST /api/v1/mobile/facebook/groups/analyze", () => {
  it("analiza varias pantallas efímeras y devuelve candidatos puntuados", async () => {
    const response = await POST(request(), { params: {} });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ephemeral: true,
      candidates: [
        expect.objectContaining({ name: expect.stringContaining("España"), relevanceScore: 96, selected: true }),
        expect.objectContaining({ name: expect.stringContaining("México"), selected: false })
      ]
    });
    expect(completeJsonMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: "mobile_facebook_group_discovery",
      inlineImages: [expect.objectContaining({ mediaType: "image/png" })]
    }));
  });

  it("rechaza capturas inválidas antes de llamar a la IA", async () => {
    const response = await POST(request({ screenImages: ["data:text/html;base64,PGgxPm5vPC9oMT4="] }), { params: {} });
    expect(response.status).toBe(400);
    expect(completeJsonMock).not.toHaveBeenCalled();
  });
});
