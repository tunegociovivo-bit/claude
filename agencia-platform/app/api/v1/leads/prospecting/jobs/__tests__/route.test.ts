import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), ingest: vi.fn() }));

vi.mock("@/lib/api/auth", async (importActual) => ({
  ...(await importActual() as object),
  authenticate: mocks.authenticate
}));
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));
vi.mock("@/lib/leads/job-opportunity-pipeline", () => ({ ingestLinkedInJobOpportunity: mocks.ingest }));

import { POST } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
  mocks.ingest.mockResolvedValue({ accepted: true, created: true, leadId: "lead-1", emailFound: true, linkedinDrafted: true });
});

describe("POST /api/v1/leads/prospecting/jobs", () => {
  it("envía una oferta capturada en LinkedIn al pipeline común de Empleos y Prospección", async () => {
    const response = await POST(new NextRequest("https://hub.example/api/v1/leads/prospecting/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: "Acme",
        jobTitle: "Especialista SEO",
        location: "Madrid",
        jobUrl: "https://www.linkedin.com/jobs/view/123",
        companyUrl: "https://www.linkedin.com/company/acme",
        description: "Buscamos ampliar el equipo SEO."
      })
    }), { params: {} });

    expect(response.status).toBe(201);
    expect(mocks.ingest).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
      company: "Acme",
      jobTitle: "Especialista SEO",
      board: "linkedin"
    }));
    await expect(response.json()).resolves.toMatchObject({ leadId: "lead-1", emailFound: true, linkedinDrafted: true });
  });

  it("rechaza capturas sin empresa o puesto antes de tocar el pipeline", async () => {
    const response = await POST(new NextRequest("https://hub.example/api/v1/leads/prospecting/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Acme" })
    }), { params: {} });

    expect(response.status).toBe(400);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});
