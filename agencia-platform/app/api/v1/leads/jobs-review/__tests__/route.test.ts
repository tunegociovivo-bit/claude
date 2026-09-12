import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, listPendingReviewMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  listPendingReviewMock: vi.fn(),
  prisma: {
    lead: {
      count: vi.fn(),
      findMany: vi.fn()
    }
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
vi.mock("@/lib/leads/exec-outreach", () => ({
  listPendingReview: listPendingReviewMock,
  approveExecOutreach: vi.fn(),
  rejectExecOutreach: vi.fn()
}));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
  listPendingReviewMock.mockResolvedValue([{ id: "draft-1", leadId: "lead-with-draft" }]);
  prisma.lead.count
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(1);
  prisma.lead.findMany.mockResolvedValue([
    {
      id: "lead-without-email",
      name: "SALSAS ASTURIANAS SL",
      province: "Llanera",
      formattedAddress: "Llanera",
      email: null,
      contactStatus: "pending",
      rawData: {
        source: "jobs",
        jobTitle: "Senior Marketing Specialist",
        jobUrl: null,
        board: "infojobs",
        secretProviderPayload: "must-not-leak"
      },
      createdAt: new Date("2026-09-12T08:00:00.000Z")
    },
    {
      id: "lead-with-draft",
      name: "Empresa con borrador",
      province: "Madrid",
      formattedAddress: "Madrid",
      email: "hola@example.com",
      contactStatus: "pending",
      rawData: {
        source: "jobs",
        jobTitle: "Content Marketing Specialist",
        jobUrl: "https://empleos.example/oferta/1",
        board: "linkedin"
      },
      createdAt: new Date("2026-09-11T08:00:00.000Z")
    }
  ]);
});

describe("GET /api/v1/leads/jobs-review", () => {
  it("muestra también las ofertas detectadas sin email ni borrador", async () => {
    const response = await GET(
      new NextRequest("https://hub.example/api/v1/leads/jobs-review"),
      { params: {} }
    );
    const body = await response.json();

    expect(body.detectedOffers).toEqual([
      {
        id: "lead-without-email",
        company: "SALSAS ASTURIANAS SL",
        jobTitle: "Senior Marketing Specialist",
        location: "Llanera",
        jobUrl: null,
        board: "infojobs",
        hasEmail: false,
        hasDraft: false,
        contactStatus: "pending",
        detectedAt: "2026-09-12T08:00:00.000Z"
      },
      expect.objectContaining({
        id: "lead-with-draft",
        hasEmail: true,
        hasDraft: true
      })
    ]);
    expect(body.detectedOffers[0]).not.toHaveProperty("rawData");
    expect(body.totalDetectedOffers).toBe(2);
  });

  it("limita la consulta al workspace y a la fuente jobs", async () => {
    await GET(
      new NextRequest("https://hub.example/api/v1/leads/jobs-review"),
      { params: {} }
    );

    expect(prisma.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: "workspace-1",
        rawData: { path: ["source"], equals: "jobs" }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    }));
  });
});
