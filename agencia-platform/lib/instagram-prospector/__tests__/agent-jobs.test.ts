import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { supportsAudienceDiscovery } from "../agent-version";

const db = vi.hoisted(() => ({
  instagramProspectorAgent: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  instagramProspectorJob: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/api/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/api/handler", () => ({ withApi: (_opts: unknown, handler: any) => (req: NextRequest) => handler(req, { api: { workspaceId: "workspace-a", userId: "user-a" } }) }));
import { POST } from "@/app/api/v1/instagram-prospector/scan/route";
import { GET, PATCH } from "@/app/api/v1/instagram-prospector/agent/route";

function request(method: string, body?: unknown, version = "0.21.29") {
  return new NextRequest("https://hub.test/api/v1/instagram-prospector/agent", {
    method, headers: { "content-type": "application/json", "x-hub-browser-agent": "agent-a", "x-hub-extension-version": version },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.instagramProspectorJob.updateMany.mockResolvedValue({ count: 1 });
  db.instagramProspectorAgent.updateMany.mockResolvedValue({ count: 1 });
});

it("rejects missing or old agents before creating a job; never invents an online agent", async () => {
  db.instagramProspectorAgent.findMany.mockResolvedValue([{ version: "0.21.27" }]);
  await expect(POST(request("POST", { sourceType: "followers", target: "@retail", limit: 100 }), {} as any)).rejects.toThrow(/Actualiza/);
  expect(db.instagramProspectorJob.create).not.toHaveBeenCalled();
  expect(supportsAudienceDiscovery("0.21.9")).toBe(false);
  expect(supportsAudienceDiscovery("0.21.28")).toBe(false);
  expect(supportsAudienceDiscovery("0.21.29")).toBe(true);
  expect(supportsAudienceDiscovery("0.22.0")).toBe(true);
});

it("an outdated extension cannot claim new searches", async () => {
  const response = await GET(request("GET", undefined, "0.21.27"), {} as any);
  expect(await response.json()).toEqual({ job: null, updateRequired: true });
  expect(db.instagramProspectorJob.findFirst).not.toHaveBeenCalled();
});

it("resumes the agent's existing job with its saved audience and cursor", async () => {
  const checkpoint = { cursor: 15, candidates: [{ handle: "person" }], leads: [] };
  db.instagramProspectorJob.findFirst.mockResolvedValue({ id: "job-a", config: { limit: 100 }, result: checkpoint });
  const response = await GET(request("GET"), {} as any);
  expect((await response.json()).job.result).toEqual(checkpoint);
  expect(db.instagramProspectorJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace-a", status: "RUNNING", claimedByAgentKey: "agent-a" } }));
  expect(db.instagramProspectorJob.updateMany.mock.calls[0][0].where.updatedAt.lt).toBeInstanceOf(Date);
});

it("saves progress without completing the job and preserves it when a later batch fails", async () => {
  const checkpoint = { cursor: 15, candidates: [{ handle: "person" }], leads: [{ handle: "@person" }] };
  db.instagramProspectorJob.findFirst.mockResolvedValue({ id: "job-a", result: checkpoint });
  await PATCH(request("PATCH", { id: "job-a", status: "RUNNING", cursor: 16, leads: [{ handle: "@person" }, { handle: "@next" }] }), {} as any);
  expect(db.instagramProspectorJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { id: "job-a", workspaceId: "workspace-a", claimedByAgentKey: "agent-a", status: "RUNNING" },
    data: expect.objectContaining({ finishedAt: null, result: expect.objectContaining({ cursor: 16, candidates: checkpoint.candidates }) })
  }));
  await PATCH(request("PATCH", { id: "job-a", status: "FAILED", error: "Instagram solicita iniciar sesion" }), {} as any);
  expect(db.instagramProspectorJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: "FAILED", result: expect.objectContaining({ leads: checkpoint.leads, cursor: 15 }) })
  }));
});

it("rejects a result after another agent has reclaimed the job", async () => {
  db.instagramProspectorJob.findFirst.mockResolvedValue({ id: "job-a", result: {} });
  db.instagramProspectorJob.updateMany.mockResolvedValue({ count: 0 });
  await expect(PATCH(request("PATCH", { id: "job-a", status: "COMPLETED", leads: [] }), {} as any)).rejects.toThrow(/ya no pertenece/);
});
