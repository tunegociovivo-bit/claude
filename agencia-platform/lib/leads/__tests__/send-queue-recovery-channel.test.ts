import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
    leadMessage: { findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn() }
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("../template-engine", () => ({ renderTemplate: vi.fn() }));
vi.mock("../ai-vary", () => ({ aiRewriteMessage: vi.fn() }));
vi.mock("../waha", () => ({ normalizePhone: vi.fn(), sendText: vi.fn(), sendImage: vi.fn(), sendVoice: vi.fn(), getWahaConfig: vi.fn(), getSession: vi.fn(), checkNumberExists: vi.fn() }));
vi.mock("../voice-tts", () => ({ generateVoiceMp3: vi.fn() }));
vi.mock("../channels", () => ({
  pickEnqueueChannel: vi.fn(),
  reassignIfQuarantined: vi.fn(),
  getLeadChannels: vi.fn(),
  warmupReroute: vi.fn(),
  channelWarmupCap: vi.fn((channel: any) => ({
    cap: channel.testCap ?? channel.dailyLimit ?? 50,
    warming: channel.testCap != null,
    dayIndex: channel.testCap != null ? 3 : 30,
    warmupDays: 30
  }))
}));
vi.mock("../competitors", () => ({ findUnsafeCompetitorMention: vi.fn(), getCompetitorRanking: vi.fn(), rankingAutoCaption: vi.fn() }));
vi.mock("../ranking-card", () => ({ renderRankingPng: vi.fn() }));
vi.mock("../email-only", () => ({ EMAIL_ONLY_REASON: "email_only", isEmailOnlyLead: vi.fn(() => false) }));

import { getSendSettings } from "../send-queue";

const base = {
  warmupEnabled: false,
  dailyJitterPct: 0,
  dailyLimit: 60,
  maxPerHour: 10,
  maxNewChatsPerDay: 20,
  minCoolDownDaysPerRecipient: 2,
  sendDelayMinSec: 30,
  sendDelayMaxSec: 60
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspace.update.mockResolvedValue({});
});

describe("recovery por canal", () => {
  it("aplica los topes solo al principal y deja intacto un extra", async () => {
    prisma.workspace.findUnique.mockResolvedValue({ settings: { leads: {
      ...base,
      recoveryByChannel: { __principal__: { enabled: true, since: new Date().toISOString() } }
    } } });

    const principal = await getSendSettings("ws", null);
    const extra = await getSendSettings("ws", "movil-2");

    expect(principal).toMatchObject({ recoveryMode: true, dailyLimit: 15, maxPerHour: 3, minCoolDownDaysPerRecipient: 10, sendDelayMinSec: 300, sendDelayMaxSec: 900 });
    expect(extra).toMatchObject({ recoveryMode: false, dailyLimit: 60, maxPerHour: 10, minCoolDownDaysPerRecipient: 2, sendDelayMinSec: 30 });
  });

  it("auto-desactiva solo la entrada expirada a los 14 días", async () => {
    prisma.workspace.findUnique.mockResolvedValue({ settings: { leads: {
      ...base,
      recoveryByChannel: {
        __principal__: { enabled: true, since: "2020-01-01T00:00:00.000Z" },
        "movil-2": { enabled: true, since: new Date().toISOString() }
      }
    } } });

    const principal = await getSendSettings("ws", null);

    expect(principal.recoveryMode).toBe(false);
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it("mantiene compatible el recoveryMode global para cualquier canal", async () => {
    prisma.workspace.findUnique.mockResolvedValue({ settings: { leads: {
      ...base, recoveryMode: true, recoverySince: new Date().toISOString()
    } } });

    expect(await getSendSettings("ws", "movil-2")).toMatchObject({ recoveryMode: true, dailyLimit: 15, maxPerHour: 3 });
  });

  it("reduce también los chats nuevos al 40% de la rampa propia del canal", async () => {
    prisma.workspace.findUnique.mockResolvedValue({ settings: { leads: {
      ...base,
      maxNewChatsPerDay: 25,
      channels: [{ name: "movil-nuevo", dailyLimit: 50, testCap: 12 }]
    } } });

    const phone = await getSendSettings("ws", "movil-nuevo");

    expect(phone.dailyLimit).toBe(12);
    expect(phone.maxNewChatsPerDay).toBe(5);
  });
});
