import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), findProspect: vi.fn() }));

vi.mock("@/lib/api/auth", async (importActual) => ({
  ...(await importActual() as object),
  authenticate: mocks.authenticate
}));
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { prospectingProspect: { findFirst: mocks.findProspect } } }));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
  mocks.findProspect.mockResolvedValue({
    id: "prospect-1",
    firstName: "Ana",
    lastName: "García",
    companyName: "Acme",
    metadata: { job: { title: "Especialista SEO" } },
    activities: [{ id: "activity-1", detail: "Hola Ana, he visto vuestra oferta.", payload: { source: "jobs_bridge" } }]
  });
});

describe("GET /api/v1/leads/prospecting/linkedin-draft", () => {
  it("devuelve solo el borrador pendiente del perfil de LinkedIn abierto", async () => {
    const response = await GET(new NextRequest("https://hub.example/api/v1/leads/prospecting/linkedin-draft?url=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fana-garcia%2F%3Ftrk%3Dabc"), { params: {} });
    const body = await response.json();

    expect(mocks.findProspect).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspaceId: "workspace-1",
        linkedinUrl: { in: ["https://www.linkedin.com/in/ana-garcia", "https://www.linkedin.com/in/ana-garcia/"] }
      })
    }));
    expect(body).toEqual({
      activityId: "activity-1",
      prospectId: "prospect-1",
      person: "Ana García",
      company: "Acme",
      jobTitle: "Especialista SEO",
      message: "Hola Ana, he visto vuestra oferta."
    });
  });

  it("no acepta dominios ajenos a LinkedIn", async () => {
    const response = await GET(new NextRequest("https://hub.example/api/v1/leads/prospecting/linkedin-draft?url=https%3A%2F%2Fevil.example%2Fin%2Fana"), { params: {} });
    expect(response.status).toBe(400);
    expect(mocks.findProspect).not.toHaveBeenCalled();
  });
});
