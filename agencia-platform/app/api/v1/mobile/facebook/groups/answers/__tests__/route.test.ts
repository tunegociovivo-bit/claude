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

function request(answerFacts = "Soy David y dirijo una agencia de marketing en Málaga.") {
  return new NextRequest("https://hub.example/api/v1/mobile/facebook/groups/answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phoneKey: "principal",
      deviceSerial: "usb-1",
      groupName: "Franquicias en España",
      questions: ["¿A qué te dedicas?", "¿Cuál es tu número de franquicias?"],
      answerFacts
    })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  loadAccessMock.mockResolvedValue({ phones: [{ key: "principal", deviceSerial: "usb-1", active: true }] });
  requireLinkedMobileMock.mockReturnValue({ key: "principal" });
  completeJsonMock.mockResolvedValue({
    answers: [
      { index: 0, answer: "Dirijo una agencia de marketing en Málaga.", reason: "Consta en los datos aportados." },
      { index: 1, answer: null, reason: "El usuario no indicó ese dato." }
    ]
  });
});

describe("POST /api/v1/mobile/facebook/groups/answers", () => {
  it("responde solo lo respaldado por los datos del usuario", async () => {
    const response = await POST(request(), { params: {} });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      answers: [
        expect.objectContaining({ index: 0, answer: expect.stringContaining("agencia") }),
        expect.objectContaining({ index: 1, answer: null })
      ]
    });
    expect(completeJsonMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: "mobile_facebook_group_answers",
      system: expect.stringMatching(/no inventes/i)
    }));
  });

  it("exige datos reales antes de generar respuestas", async () => {
    const response = await POST(request(""), { params: {} });
    expect(response.status).toBe(400);
    expect(completeJsonMock).not.toHaveBeenCalled();
  });
});
