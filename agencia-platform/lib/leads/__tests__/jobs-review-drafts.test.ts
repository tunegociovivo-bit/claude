import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeJsonMock, prisma } = vi.hoisted(() => ({
  completeJsonMock: vi.fn(),
  prisma: {
    lead: { findMany: vi.fn() },
    leadExecOutreach: {
      findMany: vi.fn(),
      upsert: vi.fn()
    }
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/ai/anthropic", () => ({ completeJson: completeJsonMock }));
vi.mock("@/lib/integrations/email", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(),
  LEADS_FROM: "leads@example.com"
}));

import { generateJobsReviewDrafts } from "../exec-outreach";

const lead = (id: string) => ({
  id,
  email: `${id}@example.com`,
  name: `Empresa ${id}`,
  category: "Empresa que contrata marketing/IA",
  rawData: {
    source: "jobs",
    jobTitle: `Especialista de marketing ${id}`,
    jobDescription: "Oferta estable para ampliar el equipo de marketing."
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  completeJsonMock.mockResolvedValue({
    subject: "Una alternativa para vuestra vacante",
    body: "Hola, hemos visto vuestra oferta y podemos ayudaros con un equipo especializado."
  });
  prisma.leadExecOutreach.upsert.mockResolvedValue({ id: "outreach-1" });
});

describe("generateJobsReviewDrafts", () => {
  it("reintenta una fila de revisión activa que quedó sin borrador", async () => {
    prisma.lead.findMany.mockResolvedValue([lead("retry"), lead("ready")]);
    prisma.leadExecOutreach.findMany.mockResolvedValue([
      {
        leadId: "retry",
        status: "active",
        mode: "review",
        draftSubject: null,
        draftBody: null
      },
      {
        leadId: "ready",
        status: "pending_review",
        mode: "review",
        draftSubject: "Ya existe",
        draftBody: "Borrador existente"
      }
    ]);

    const result = await generateJobsReviewDrafts("workspace-1");

    expect(completeJsonMock).toHaveBeenCalledTimes(1);
    expect(prisma.leadExecOutreach.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_leadId: { workspaceId: "workspace-1", leadId: "retry" } },
      update: expect.objectContaining({ status: "pending_review" })
    }));
    expect(result).toEqual({ drafted: 1, candidates: 2, alreadyHandled: 1 });
  });

  it("si la IA falla deja un mensaje de respaldo aprobable en vez de una fila invisible", async () => {
    prisma.lead.findMany.mockResolvedValue([lead("fallback")]);
    prisma.leadExecOutreach.findMany.mockResolvedValue([]);
    completeJsonMock.mockRejectedValue(new Error("Proveedor de IA temporalmente no disponible"));

    const result = await generateJobsReviewDrafts("workspace-1");

    expect(prisma.leadExecOutreach.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_leadId: { workspaceId: "workspace-1", leadId: "fallback" } },
      create: expect.objectContaining({
        status: "pending_review",
        draftSubject: expect.stringContaining("Especialista de marketing fallback"),
        draftBody: expect.stringContaining("Empresa fallback")
      })
    }));
    expect(result.drafted).toBe(1);
  });
});
