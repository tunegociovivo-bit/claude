import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("../template-engine", () => ({ renderTemplate: vi.fn() }));
vi.mock("../ai-vary", () => ({ aiRewriteMessage: vi.fn() }));
vi.mock("../waha", () => ({ normalizePhone: vi.fn(), sendText: vi.fn(), sendImage: vi.fn(), sendVoice: vi.fn(), getWahaConfig: vi.fn(), getSession: vi.fn(), checkNumberExists: vi.fn() }));
vi.mock("../voice-tts", () => ({ generateVoiceMp3: vi.fn() }));
vi.mock("../channels", () => ({ pickEnqueueChannel: vi.fn(), reassignIfQuarantined: vi.fn(), getLeadChannels: vi.fn(), warmupReroute: vi.fn() }));
vi.mock("../competitors", () => ({ findUnsafeCompetitorMention: vi.fn(), getCompetitorRanking: vi.fn(), rankingAutoCaption: vi.fn() }));
vi.mock("../ranking-card", () => ({ renderRankingPng: vi.fn() }));
vi.mock("../email-only", () => ({ EMAIL_ONLY_REASON: "email_only", isEmailOnlyLead: vi.fn(() => false) }));
import { chooseQueueChannelWithCapacity } from "../send-queue";

describe("chooseQueueChannelWithCapacity", () => {
  it("reroutes a new conversation when its assigned channel reached the new-chat cap", () => {
    const selected = chooseQueueChannelWithCapacity("sonia10", [
      { instanceName: "sonia10", blocked: false, newChatsCapReached: true },
      { instanceName: "sonia8", blocked: false, newChatsCapReached: false },
      { instanceName: null, blocked: false, newChatsCapReached: false }
    ], true);

    expect(selected).toBe("sonia8");
  });

  it("keeps the assigned channel when it still has capacity", () => {
    const selected = chooseQueueChannelWithCapacity("sonia10", [
      { instanceName: "sonia10", blocked: false, newChatsCapReached: false },
      { instanceName: "sonia8", blocked: false, newChatsCapReached: false }
    ], true);

    expect(selected).toBe("sonia10");
  });

  it("returns undefined only when every channel is unavailable for a new conversation", () => {
    const selected = chooseQueueChannelWithCapacity("sonia10", [
      { instanceName: "sonia10", blocked: false, newChatsCapReached: true },
      { instanceName: "sonia8", blocked: true, newChatsCapReached: false },
      { instanceName: null, blocked: false, newChatsCapReached: true }
    ], true);

    expect(selected).toBeUndefined();
  });

  it("allows a recontact on a channel whose new-chat cap is full", () => {
    const selected = chooseQueueChannelWithCapacity("sonia10", [
      { instanceName: "sonia10", blocked: false, newChatsCapReached: true }
    ], false);

    expect(selected).toBe("sonia10");
  });
});
