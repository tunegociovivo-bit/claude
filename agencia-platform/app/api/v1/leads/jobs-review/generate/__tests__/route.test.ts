import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), generate: vi.fn(), sync: vi.fn() }));

vi.mock("@/lib/api/auth", async (importActual) => ({
  ...(await importActual() as object),
  authenticate: mocks.authenticate
}));
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));
vi.mock("@/lib/leads/exec-outreach", () => ({ generateJobsReviewDrafts: mocks.generate }));
vi.mock("@/lib/leads/job-prospecting-bridge", () => ({ syncJobLeadsToProspecting: mocks.sync }));

import { POST } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
  mocks.generate.mockResolvedValue({ drafted: 3, candidates: 5, alreadyHandled: 2 });
  mocks.sync.mockResolvedValue({ candidates: 8, drafted: 6, alreadyLinked: 2, unresolvedProfiles: 1 });
});

describe("POST /api/v1/leads/jobs-review/generate", () => {
  it("genera juntos los borradores de email y LinkedIn, incluyendo ofertas antiguas", async () => {
    const response = await POST(new NextRequest("https://hub.example/api/v1/leads/jobs-review/generate", { method: "POST" }), { params: {} });
    const body = await response.json();

    expect(mocks.generate).toHaveBeenCalledWith("workspace-1");
    expect(mocks.sync).toHaveBeenCalledWith({ workspaceId: "workspace-1" });
    expect(body).toMatchObject({
      drafted: 3,
      linkedin: { candidates: 8, drafted: 6, alreadyLinked: 2, unresolvedProfiles: 1 }
    });
  });
});
