import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  share: vi.fn(),
  referral: vi.fn()
}));

vi.mock("react-native", () => ({ Share: { share: H.share } }));
vi.mock("../api", () => ({
  API_BASE: "https://bubui.app",
  api: { referral: H.referral }
}));

import { remindFriendForOffer, shareReferralForOffer } from "../share-referral";

beforeEach(() => vi.clearAllMocks());

describe("shareReferralForOffer", () => {
  it("shares a contextual challenge URL containing both referral code and offer", async () => {
    H.referral.mockResolvedValue({ code: "ABC123" });
    H.share.mockResolvedValue({ action: "sharedAction" });

    await expect(shareReferralForOffer("customer-1", { offerId: "offer12345678" })).resolves.toBe(true);

    expect(H.share).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("https://bubui.app/bubui/r/ABC123?offer=offer12345678"),
      url: "https://bubui.app/bubui/r/ABC123?offer=offer12345678"
    }));
  });

  it("does not report or share a generic link when the contextual invite cannot be created", async () => {
    H.referral.mockRejectedValue(new Error("network"));

    await expect(shareReferralForOffer("customer-1", { offerId: "offer12345678" })).resolves.toBe(false);
    expect(H.share).not.toHaveBeenCalled();
  });

  it("returns false when the share sheet is cancelled or fails", async () => {
    H.referral.mockResolvedValue({ code: "ABC123" });
    H.share.mockRejectedValue(new Error("cancelled"));

    await expect(shareReferralForOffer("customer-1", { offerId: "offer12345678" })).resolves.toBe(false);
  });
});

describe("remindFriendForOffer", () => {
  it("prepara un recordatorio nominal con el enlace del reto exacto", async () => {
    H.referral.mockResolvedValue({ code: "ABC123" });
    H.share.mockResolvedValue({ action: "sharedAction" });
    await expect(remindFriendForOffer("customer-1", "Ana", { offerId: "offer123", businessName: "Roman Trainer" })).resolves.toBe(true);
    expect(H.share).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Hola Ana"),
      url: "https://bubui.app/bubui/r/ABC123?offer=offer123"
    }));
  });
});
