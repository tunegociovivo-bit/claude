import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, platformAccessMock, completeMock, prisma } = vi.hoisted(() => {
  const prismaMock: any = {
    workspace: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    mobileAutomationJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
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
  experienceConfirmed: true,
  idempotencyKey: "47d9c37e-54ef-44e1-80a8-f9d2a55b93f7"
};

const facebookGroupBatch = JSON.stringify({
  version: 1,
  query: "franquicias",
  criteria: "Grupos profesionales y activos de España",
  membershipAnswers: "",
  maxGroups: 5,
  candidates: [{
    id: "franquicias-en-espana",
    name: "Franquicias en España",
    details: "Grupo público · 554 miembros",
    relevanceScore: 91,
    reason: "Coincide con la temática y el país.",
    selected: true,
    outcome: "pending",
    resultDetail: null
  }]
});

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
  prisma.mobileAutomationJob.findUnique.mockResolvedValue(null);
  prisma.mobileAutomationJob.findFirst.mockResolvedValue({
    id: "job-1",
    workspaceId: "w1",
    status: "PENDING_APPROVAL",
    text: "La comida fue excelente y el servicio, muy atento.",
    targetUrl: draftInput.targetUrl,
    platform: "google_maps"
  });
  prisma.mobileAutomationJob.updateMany.mockResolvedValue({ count: 1 });
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
      model: "claude-haiku-4-5-20251001",
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

  it("crea un descubrimiento por lotes que analizará resultados antes de solicitar acceso", async () => {
    const response = await createDraft(
      request("https://hub.example/api/v1/mobile/automations/drafts", {
        ...draftInput,
        platform: "facebook",
        sourceKind: "GROUP_DISCOVERY",
        targetName: "viajes a Japón",
        targetUrl: "https://www.facebook.com/search/groups/?q=viajes+a+Japon",
        facts: "Grupos activos en español para preparar un viaje a Japón por libre.",
        membershipAnswers: "Viajé a Japón y quiero compartir y aprender de otras experiencias reales.",
        maxGroups: 8,
        experienceConfirmed: false
      }),
      { params: {} }
    );

    expect(response.status).toBe(201);
    expect(prisma.mobileAutomationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        platform: "facebook",
        sourceKind: "GROUP_DISCOVERY",
          action: "DISCOVER_FACEBOOK_GROUPS",
          status: "QUEUED",
          text: expect.stringContaining("membershipAnswers")
        })
    });
    expect(completeMock).not.toHaveBeenCalled();
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

  it("returns the existing draft when a network retry reuses its idempotency key", async () => {
    prisma.mobileAutomationJob.findUnique.mockResolvedValue({
      id: "job-existing",
      status: "PENDING_APPROVAL",
      idempotencyKey: draftInput.idempotencyKey
    });

    const response = await createDraft(
      request("https://hub.example/api/v1/mobile/automations/drafts", draftInput),
      { params: {} }
    );

    expect(response.status).toBe(200);
    expect(completeMock).not.toHaveBeenCalled();
    expect(prisma.mobileAutomationJob.create).not.toHaveBeenCalled();
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
    expect(prisma.mobileAutomationJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", workspaceId: "w1", status: "PENDING_APPROVAL" },
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
    expect(prisma.mobileAutomationJob.updateMany).not.toHaveBeenCalled();
  });

  it("does not overwrite a concurrent decision that already changed the job", async () => {
    prisma.mobileAutomationJob.updateMany.mockResolvedValue({ count: 0 });

    const response = await decideJob(
      request("https://hub.example/api/v1/mobile/automations/jobs/job-1/decision", {
        action: "APPROVE"
      }),
      { params: { id: "job-1" } }
    );

    expect(response.status).toBe(409);
    expect(prisma.mobileAutomationJobEvent.create).not.toHaveBeenCalled();
  });

  it("approves every selected Facebook group with one batch confirmation", async () => {
    prisma.mobileAutomationJob.findFirst.mockResolvedValue({
      id: "job-groups",
      workspaceId: "w1",
      status: "PENDING_APPROVAL",
      action: "JOIN_FACEBOOK_GROUP_BATCH",
      text: facebookGroupBatch,
      targetUrl: "https://www.facebook.com/search/groups/?q=franquicias",
      platform: "facebook",
      scheduledAt: new Date("2026-09-12T12:00:00.000Z")
    });

    const response = await decideJob(
      request("https://hub.example/api/v1/mobile/automations/jobs/job-groups/decision", {
        action: "APPROVE",
        text: facebookGroupBatch
      }),
      { params: { id: "job-groups" } }
    );

    expect(response.status).toBe(200);
    expect(prisma.mobileAutomationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "QUEUED", text: facebookGroupBatch })
    }));
  });

  it("persists additional factual answers when retrying an incomplete batch", async () => {
    const original = JSON.parse(facebookGroupBatch);
    original.candidates[0].outcome = "needs_answers";
    const originalText = JSON.stringify(original);
    const revisedText = JSON.stringify({
      ...original,
      membershipAnswers: "Dirijo una agencia de marketing en Málaga."
    });
    prisma.mobileAutomationJob.findFirst.mockResolvedValue({
      id: "job-groups",
      workspaceId: "w1",
      status: "WAITING_USER",
      action: "JOIN_FACEBOOK_GROUP_BATCH",
      text: originalText,
      targetUrl: "https://www.facebook.com/search/groups/?q=franquicias",
      platform: "facebook"
    });

    const response = await decideJob(
      request("https://hub.example/api/v1/mobile/automations/jobs/job-groups/decision", {
        action: "RETRY",
        text: revisedText
      }),
      { params: { id: "job-groups" } }
    );

    expect(response.status).toBe(200);
    expect(prisma.mobileAutomationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "QUEUED", text: revisedText })
    }));
  });
});


describe("Facebook conversation discovery", () => {
  it("queues an account-wide scan with a niche and reply guidance without generating a generic draft", async () => {
    const response = await createDraft(request("https://hub.example/api/v1/mobile/automations/drafts", {
      ...draftInput, platform: "facebook", sourceKind: "COMMENT_DISCOVERY", targetUrl: "", facts: "",
      niche: "franquicias", replyGuidance: "Considero que las franquicias de supermercado serán rentables."
    }), { params: {} });
    expect(response.status).toBe(201);
    expect(completeMock).not.toHaveBeenCalled();
    const data = prisma.mobileAutomationJob.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ action: "DISCOVER_FACEBOOK_CONVERSATIONS", status: "QUEUED" });
    expect(JSON.parse(data.text).config).toMatchObject({ targetUrl: "", niche: "franquicias", postsPerGroup: 5 });
  });
  it("requires the response guidance before queueing a scan", async () => {
    const response = await createDraft(request("https://hub.example/api/v1/mobile/automations/drafts", {
      ...draftInput, platform: "facebook", sourceKind: "COMMENT_DISCOVERY", targetUrl: "", facts: ""
    }), { params: {} });
    expect(response.status).toBe(400);
    expect(prisma.mobileAutomationJob.create).not.toHaveBeenCalled();
  });
});
