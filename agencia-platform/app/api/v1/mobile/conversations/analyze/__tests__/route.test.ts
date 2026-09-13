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
  rateLimit: () => ({ ok: true, remaining: 14, resetAt: Date.now() + 60_000 })
}));
vi.mock("@/lib/ai/anthropic", () => ({ completeJson: completeJsonMock }));
vi.mock("@/lib/mobile/automation-access", () => ({
  loadMobileAutomationAccess: loadAccessMock,
  requireLinkedMobile: requireLinkedMobileMock
}));

import { POST } from "../route";

const rule = {
  id: "03e18429-a6db-407f-9892-4eedf1f016d5",
  name: "Viajes a Japón",
  topic: "Dudas concretas al preparar un viaje a Japón",
  goal: "Contestar con consejos útiles basados en la experiencia del usuario",
  tone: "helpful",
  minimumRelevance: 65
};

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("https://hub.example/api/v1/mobile/conversations/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phoneKey: "xiaomi",
      deviceSerial: "USB-XIAOMI",
      screenImage: `data:image/png;base64,${Buffer.from("visible screen").toString("base64")}`,
      rule,
      ...overrides
    })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  loadAccessMock.mockResolvedValue({ phones: [{ key: "xiaomi", deviceSerial: "USB-XIAOMI", active: true }] });
  requireLinkedMobileMock.mockReturnValue({ key: "xiaomi" });
  completeJsonMock.mockResolvedValue({
    candidates: [
      {
        authorLabel: "Ana",
        sourceText: "¿Merece la pena activar el JR Pass?",
        relevanceScore: 94,
        reason: "Pregunta directamente por la preparación del viaje.",
        draftReply: "Depende mucho de tu ruta; conviene comparar cada trayecto antes de comprarlo."
      },
      {
        authorLabel: "Ana duplicada",
        sourceText: "Merece la pena activar el JR PASS!!!",
        relevanceScore: 70,
        reason: "Es el mismo comentario.",
        draftReply: "Duplicado"
      },
      {
        sourceText: "Bonita foto",
        relevanceScore: 20,
        reason: "No es relevante.",
        draftReply: "Gracias"
      }
    ]
  });
});

describe("POST /api/v1/mobile/conversations/analyze", () => {
  it("analiza una sola captura inline y devuelve una cola efímera normalizada", async () => {
    const response = await POST(request(), { params: {} });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      ephemeral: true,
      candidates: [expect.objectContaining({ authorLabel: "Ana", relevanceScore: 94 })]
    });
    expect(loadAccessMock).toHaveBeenCalledWith("w1", "u1", { manager: true });
    expect(requireLinkedMobileMock).toHaveBeenCalledWith(expect.any(Array), "xiaomi", "USB-XIAOMI");
    expect(completeJsonMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "w1",
      userId: "u1",
      feature: "mobile_conversation_radar",
      inlineImages: [{
        mediaType: "image/png",
        data: Buffer.from("visible screen").toString("base64")
      }]
    }));
  });

  it("rechaza la captura antes de llamar a la IA", async () => {
    const response = await POST(request({ screenImage: "data:text/html;base64,PGgxPm5vPC9oMT4=" }), { params: {} });
    expect(response.status).toBe(400);
    expect(completeJsonMock).not.toHaveBeenCalled();
  });

  it("no filtra comentarios reconocidos a respuestas ni logs si falla el proveedor", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    completeJsonMock.mockRejectedValue(new Error("PRIVATE_COMMENT: el texto reconocido no debe persistir"));

    const response = await POST(request(), { params: {} });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("PRIVATE_COMMENT");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
