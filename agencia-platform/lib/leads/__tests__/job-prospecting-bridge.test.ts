import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  leadFindMany: vi.fn(),
  leadUpdate: vi.fn(),
  campaignUpsert: vi.fn(),
  activityFindMany: vi.fn(),
  prospectUpsert: vi.fn(),
  activityUpsert: vi.fn(),
  complete: vi.fn(),
  resolveKeys: vi.fn(),
  apollo: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    lead: { findMany: mocks.leadFindMany, update: mocks.leadUpdate },
    prospectingCampaign: { upsert: mocks.campaignUpsert },
    prospectingActivity: { findMany: mocks.activityFindMany, upsert: mocks.activityUpsert },
    prospectingProspect: { upsert: mocks.prospectUpsert }
  }
}));
vi.mock("@/lib/ai/anthropic", () => ({ complete: mocks.complete }));
vi.mock("@/lib/leads/enrich-contacts", () => ({
  resolveContactKeys: mocks.resolveKeys,
  apolloFindDecisionMakers: mocks.apollo
}));

import { jobDepartmentForTitle, syncJobLeadsToProspecting } from "../job-prospecting-bridge";

const jobLead = {
  id: "lead-1",
  workspaceId: "workspace-1",
  name: "Acme",
  email: "marketing@acme.es",
  phone: "+34910000000",
  website: "https://acme.es",
  contactStatus: "pending",
  rawData: {
    source: "jobs",
    jobTitle: "Especialista SEO",
    jobUrl: "https://www.linkedin.com/jobs/view/123",
    jobDescription: "Buscamos ampliar el equipo de posicionamiento orgánico.",
    board: "linkedin"
  }
};

describe("jobDepartmentForTitle", () => {
  it("dirige ofertas de marketing al departamento de marketing", () => {
    expect(jobDepartmentForTitle("Especialista SEO")).toMatchObject({ key: "marketing", label: "marketing" });
  });

  it("dirige ofertas de IA y datos al área de tecnología e innovación", () => {
    expect(jobDepartmentForTitle("Machine Learning Engineer")).toMatchObject({ key: "technology", label: "tecnología e innovación" });
  });
});

describe("syncJobLeadsToProspecting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.campaignUpsert.mockResolvedValue({ id: "jobs-campaign", steps: [{ id: "linkedin-step" }] });
    mocks.activityFindMany.mockResolvedValue([]);
    mocks.resolveKeys.mockResolvedValue({ apolloKey: "apollo-key", hunterKey: null });
    mocks.apollo.mockResolvedValue([{ name: "Ana García", title: "Directora de Marketing", linkedin: "https://www.linkedin.com/in/ana-garcia", email: "ana@acme.es" }]);
    mocks.complete.mockResolvedValue("Hola Ana, he visto que Acme busca un Especialista SEO. Podemos ayudaros a cubrir esa necesidad con un equipo externo. ¿Lo comentamos?");
    mocks.leadFindMany.mockResolvedValue([jobLead]);
    mocks.prospectUpsert.mockResolvedValue({ id: "prospect-1" });
    mocks.activityUpsert.mockResolvedValue({ id: "activity-1" });
    mocks.leadUpdate.mockResolvedValue({});
  });

  it("crea un borrador de LinkedIn enlazado al lead y al decisor del departamento correcto", async () => {
    const result = await syncJobLeadsToProspecting({ workspaceId: "workspace-1", searchId: "search-1" });

    expect(mocks.leadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId: "workspace-1", searchId: "search-1" })
    }));
    expect(mocks.apollo).toHaveBeenCalledWith(expect.objectContaining({
      domain: "acme.es",
      titles: expect.arrayContaining(["marketing director", "head of marketing"])
    }));
    expect(mocks.prospectUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        leadId: "lead-1",
        companyName: "Acme",
        firstName: "Ana",
        lastName: "García",
        linkedinUrl: "https://www.linkedin.com/in/ana-garcia",
        status: "waiting_action"
      })
    }));
    expect(mocks.activityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        channel: "linkedin_message",
        action: "execute_step",
        status: "awaiting_review",
        detail: expect.stringContaining("Especialista SEO"),
        payload: expect.objectContaining({ leadId: "lead-1", profileResolved: true })
      })
    }));
    expect(result).toEqual({ candidates: 1, drafted: 1, alreadyLinked: 0, unresolvedProfiles: 0 });
  });

  it("usa una búsqueda de LinkedIn y un texto de respaldo si no hay perfil directo ni responde la IA", async () => {
    mocks.resolveKeys.mockResolvedValue({ apolloKey: null, hunterKey: null });
    mocks.complete.mockRejectedValue(new Error("IA no disponible"));

    const result = await syncJobLeadsToProspecting({ workspaceId: "workspace-1" });

    const create = mocks.prospectUpsert.mock.calls[0][0].create;
    expect(create.linkedinUrl).toContain("linkedin.com/search/results/people/");
    expect(create.metadata.profileResolved).toBe(false);
    expect(mocks.activityUpsert.mock.calls[0][0].create.detail).toContain("Acme");
    expect(mocks.activityUpsert.mock.calls[0][0].create.detail).toContain("Especialista SEO");
    expect(result.unresolvedProfiles).toBe(1);
  });

  it("no vuelve a resolver ni redactar una oferta que ya tiene actividad idempotente", async () => {
    mocks.activityFindMany.mockResolvedValue([{ idempotencyKey: "jobs-linkedin:workspace-1:lead-1" }]);

    const first = await syncJobLeadsToProspecting({ workspaceId: "workspace-1" });
    const second = await syncJobLeadsToProspecting({ workspaceId: "workspace-1" });

    expect(first.alreadyLinked).toBe(1);
    expect(second.alreadyLinked).toBe(1);
    expect(mocks.apollo).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.prospectUpsert).not.toHaveBeenCalled();
    expect(mocks.activityUpsert).not.toHaveBeenCalled();
  });
});
