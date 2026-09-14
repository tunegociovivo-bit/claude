import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  startSearch: vi.fn(),
  processSearchBatch: vi.fn()
}));

vi.mock("@/lib/api/auth", async (importActual) => ({
  ...(await importActual() as object),
  authenticate: mocks.authenticate
}));
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/leads/search-manager", () => ({
  startSearch: mocks.startSearch,
  processSearchBatch: mocks.processSearchBatch
}));

import { POST } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1", scopes: new Set(["*"]) });
  mocks.startSearch.mockResolvedValue({ searchId: "search-1", totalProvinces: 1 });
  mocks.processSearchBatch.mockResolvedValue({
    processed: 1,
    pending: 0,
    status: "COMPLETED",
    leadsInserted: 14,
    leadsSkipped: 3
  });
});

describe("POST /api/v1/leads/prospecting/jobs/search", () => {
  it("lanza LinkedIn Jobs en toda España y ejecuta el puente multicanal", async () => {
    const response = await POST(new NextRequest("https://hub.example/api/v1/leads/prospecting/jobs/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "  marketing  " })
    }), { params: {} });

    expect(mocks.startSearch).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      keyword: "marketing",
      location: "",
      scope: "spain",
      source: "jobs",
      skipExisting: true,
      sourceConfig: { jobBoards: ["linkedin"] }
    });
    expect(mocks.processSearchBatch).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      searchId: "search-1",
      batchSize: 1
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      searchId: "search-1",
      status: "COMPLETED",
      offersAdded: 14,
      duplicatesSkipped: 3
    });
  });

  it("rechaza palabras demasiado cortas sin crear una búsqueda", async () => {
    const response = await POST(new NextRequest("https://hub.example/api/v1/leads/prospecting/jobs/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "m" })
    }), { params: {} });

    expect(response.status).toBe(400);
    expect(mocks.startSearch).not.toHaveBeenCalled();
  });
});
