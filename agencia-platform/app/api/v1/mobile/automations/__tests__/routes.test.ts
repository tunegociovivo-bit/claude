import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, platformAccessMock, completeMock, prisma } = vi.hoisted(() => {
  const prismaMock: any = {
    workspace: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    mobileAutomationJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    mobileAutomationJobEvent: { create: vi.fn() }
  };
  prismaMock.$transaction = vi.fn(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  return {
    authenticateMock: vi.fn(),
    platformAccessMock: vi.fn(),
    completeMock: vi.fn(),
    prisma: prismaMock
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/platforms-server", () => ({ userCanAccessPlatform: platformAccessMock }));
vi.mock("@/lib/ai/anthropic", () => ({ complete: completeMock }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));

import { POST as createDraft } from "../drafts/route";
import { POST as decideJob } from "../jobs/[id]/decision/route";

const draftInput = {
  platform: "google_maps",
  sourceKind: "REAL_REVIEW",
  phoneKey: "__principal__",
  deviceSerial: "usb-123",
  targetUrl: "https://www.google.com/maps/place/Restaurante+Ejemplo",
  facts: "Cenamos allí en agosto. El arroz estaba muy bueno y el servicio fue atento.",
  experienceConfirmed: true
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  platformAccessMock.mockResolvedValue(true);
  prisma.workspace.findUnique.mockResolvedValue({
    settings: { leads: { principalDeviceSerial: "usb-123", principalPhone: "+34600000000" } }
  });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  completeMock.mockResolvedValue("La comida fue excelente y el servicio, muy atento.");
  prisma.mobileAutomationJob.create.mockResolvedValue({
    id: "job-1",
    status: "PENDING_APPROVAL",
    text: "La comida fue excelente y el servicio, muy atento."
  });
  prisma.mobileAutomationJob.findFirst.mockResolvedValue({
    id: "job-1",
    workspaceId: "w1",
    status: "PENDING_APPROVAL",
    text: "La comida fue excelente y el servicio, muy atento.",
    targetUrl: draftInput.targetUrl,
    platform: "google_maps"
  });
  prisma.mobileAutomationJob.update.mockResolvedValue({ id: "job-1", status: "QUEUED" });
});

function request(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("mobile automation draft API", () => {
  it("generates a pending supervised draft without touching the phone", async () => {
    const response = await createDraft(
      request("https://hub.example/api/v1/mobile/automations/drafts", draftInput),
      { params: {} }
    );

    expect(response.status).toBe(201);
    expect(completeMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "w1",
      userId: "u1",
      feature: "mobile_automation_draft",
      system: expect.stringMatching(/no inventes/i),
      user: expect.stringContaining(draftInput.facts)
    }));
    expect(prisma.mobileAutomationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "w1",
        deviceSerial: "usb-123",
        action: "OPEN_URL_AND_COPY_TEXT",
        status: "PENDING_APPROVAL",
        text: "La comida fue excelente y el servicio, muy atento."
      })
    });
  });

  it("rejects an unconfirmed review before calling the model", async () => {
    const response = await createDraft(
      request("https://hub.example/api/v1/mobile/automations/drafts", {
        ...draftInput,
        experienceConfirmed: false
      }),
      { params: {} }
    );

    expect(response.status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
    expect(prisma.mobileAutomationJob.create).not.toHaveBeenCalled();
  });

  it("rejects a device that is not linked to the selected shared phone", async () => {
    const response = await createDraft(
      request("https://hub.example/api/v1/mobile/automations/drafts", {
        ...draftInput,
        deviceSerial: "someone-elses-device"
      }),
      { params: {} }
    );

    expect(response.status).toBe(409);
    expect(completeMock).not.toHaveBeenCalled();
  });
});

describe("mobile automation decision API", () => {
  it("queues a pending draft only after an explicit approval", async () => {
    const response = await decideJob(
      request("https://hub.example/api/v1/mobile/automations/jobs/job-1/decision", {
        action: "APPROVE"
      }),
      { params: { id: "job-1" } }
    );

    expect(response.status).toBe(200);
    expect(prisma.mobileAutomationJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "QUEUED", approvedById: "u1" })
    });
    expect(prisma.mobileAutomationJobEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobId: "job-1", event: "APPROVED", actorId: "u1" })
    });
  });

  it("does not approve a job that already left review", async () => {
    prisma.mobileAutomationJob.findFirst.mockResolvedValue({
      id: "job-1",
      workspaceId: "w1",
      status: "COMPLETED"
    });

    const response = await decideJob(
      request("https://hub.example/api/v1/mobile/automations/jobs/job-1/decision", {
        action: "APPROVE"
      }),
      { params: { id: "job-1" } }
    );

    expect(response.status).toBe(409);
    expect(prisma.mobileAutomationJob.update).not.toHaveBeenCalled();
  });
});
