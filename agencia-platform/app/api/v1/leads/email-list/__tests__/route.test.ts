import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { suppressionHash } from "@/lib/leads/suppressions";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: {
    lead: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    leadSuppression: { findMany: vi.fn() },
    leadOptout: { findMany: vi.fn() }
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => ({
  ...(await importActual() as object),
  authenticate: authenticateMock
}));
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));

import { GET } from "../route";

describe("GET /api/v1/leads/email-list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
    prisma.lead.findMany.mockResolvedValue([
      { id: "lead-ok", email: "hola@empresa.es", name: "Empresa", phone: "600000001" },
      { id: "lead-email-blocked", email: "baja@empresa.es", name: "Baja", phone: "600000002" },
      { id: "lead-legacy", email: "legacy@empresa.es", name: "Legacy", phone: "600000003" }
    ]);
    prisma.client.findMany.mockResolvedValue([
      { email: "hola@empresa.es", name: "Duplicado", phone: "600000004" },
      { email: "telefono@empresa.es", name: "Teléfono bloqueado", phone: "600000005" }
    ]);
    prisma.leadSuppression.findMany.mockResolvedValue([
      { kind: "email", valueHash: suppressionHash("email", "baja@empresa.es") },
      { kind: "phone", valueHash: suppressionHash("phone", "600000005") }
    ]);
    prisma.leadOptout.findMany.mockResolvedValue([{ leadId: "lead-legacy", phone: "600000003" }]);
  });

  it("excludes permanent suppressions, legacy opt-outs and duplicate recipients", async () => {
    const response = await GET(
      new NextRequest("https://hub.example/api/v1/leads/email-list?source=all&format=json"),
      { params: {} }
    );
    const body = await response.json();

    expect(body).toEqual({
      total: 1,
      items: [{ email: "hola@empresa.es", name: "Empresa", phone: "600000001", origin: "lead" }]
    });
    expect(prisma.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspaceId: "workspace-1",
        emailVerificationStatus: "deliverable",
        contactStatus: { notIn: ["excluded", "discarded", "client", "responded"] }
      })
    }));
  });
});
