import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectJobs: vi.fn(),
  workspaceFind: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { workspace: { findUnique: mocks.workspaceFind } }
}));
vi.mock("@/lib/ai/crypto", () => ({ decryptSecret: vi.fn(() => "scrapfly-key") }));
vi.mock("@/lib/leads/sources/jobs", () => ({ collectJobs: mocks.collectJobs }));

import { collectFromSource } from "../sources";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaceFind.mockResolvedValue({ settings: { leads: { scrapflyApiKeyEnc: "encrypted" } } });
  mocks.collectJobs.mockResolvedValue([]);
});

describe("fuente Empleos para NV Prospección", () => {
  it("permite limitar el barrido nacional exclusivamente a LinkedIn Jobs", async () => {
    await collectFromSource("jobs", {
      workspaceId: "workspace-1",
      keyword: "marketing",
      location: "Toda España",
      scope: "spain",
      sourceConfig: { jobBoards: ["linkedin"] }
    });

    expect(mocks.collectJobs).toHaveBeenCalledWith(expect.objectContaining({
      keyword: "marketing",
      scope: "spain",
      boards: ["linkedin"]
    }));
  });
});
