import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchFind: vi.fn(),
  searchCreate: vi.fn(),
  searchUpdate: vi.fn(),
  leadFind: vi.fn(),
  prospectFind: vi.fn(),
  enrich: vi.fn(),
  upsertLead: vi.fn(),
  startOutreach: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: {
  leadSearch: { findFirst: mocks.searchFind, create: mocks.searchCreate, update: mocks.searchUpdate },
  lead: { findUnique: mocks.leadFind },
  prospectingProspect: { findFirst: mocks.prospectFind }
} }));
vi.mock("@/lib/leads/search-manager", () => ({ upsertLead: mocks.upsertLead, startJobsOutreach: mocks.startOutreach }));
vi.mock("@/lib/leads/sources", () => ({ enrichJobsResults: mocks.enrich }));

import { ingestLinkedInJobOpportunity } from "../job-opportunity-pipeline";

describe("ingestLinkedInJobOpportunity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchFind.mockResolvedValue(null);
    mocks.searchCreate.mockResolvedValue({ id: "search-linkedin" });
    mocks.searchUpdate.mockResolvedValue({});
    mocks.enrich.mockImplementation(async (_workspaceId, rows) => rows);
    mocks.leadFind.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "lead-1", email: "hola@acme.es" });
    mocks.prospectFind.mockResolvedValue({ id: "prospect-1" });
    mocks.upsertLead.mockResolvedValue({ skipped: false });
    mocks.startOutreach.mockResolvedValue(1);
  });

  it("guarda la oferta y activa las dos vías sobre el mismo lead", async () => {
    const result = await ingestLinkedInJobOpportunity("workspace-1", {
      company: "Acme",
      jobTitle: "Especialista SEO",
      location: "Madrid",
      jobUrl: "https://www.linkedin.com/jobs/view/123",
      companyUrl: "https://www.linkedin.com/company/acme",
      description: "Vacante SEO",
      board: "linkedin"
    });

    expect(mocks.upsertLead).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1", searchId: "search-linkedin" }));
    expect(mocks.startOutreach).toHaveBeenCalledWith("workspace-1", "search-linkedin");
    expect(mocks.prospectFind).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace-1", leadId: "lead-1" } }));
    expect(result).toEqual({ accepted: true, created: true, leadId: "lead-1", emailFound: true, linkedinDrafted: true });
  });

  it("ignora una oferta ajena a marketing o IA sin escribir nada", async () => {
    const result = await ingestLinkedInJobOpportunity("workspace-1", {
      company: "Acme",
      jobTitle: "Recepcionista",
      location: "Madrid",
      jobUrl: "https://www.linkedin.com/jobs/view/456",
      companyUrl: null,
      board: "linkedin"
    });

    expect(result.accepted).toBe(false);
    expect(mocks.enrich).not.toHaveBeenCalled();
    expect(mocks.upsertLead).not.toHaveBeenCalled();
    expect(mocks.startOutreach).not.toHaveBeenCalled();
  });
});
