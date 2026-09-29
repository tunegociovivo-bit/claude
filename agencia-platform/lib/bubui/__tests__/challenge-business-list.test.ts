import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: { bubuiOffer: { findMany: vi.fn() }, bubuiCustomer: { findMany: vi.fn() }, bubuiChallengeParticipant: { findMany: vi.fn() }, bubuiPurchase: { findMany: vi.fn() } }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/bubui/auth", () => ({ businessTokenAllows: h.auth }));
vi.mock("@/lib/bubui/referral", () => ({ countVerifiedReferrals: vi.fn(), countQualifiedReferrals: vi.fn() }));
vi.mock("@/lib/bubui/share-offer", () => ({ sharesLeft: vi.fn() }));
import { GET } from "@/app/api/bubui/business/[id]/challenges/route";

beforeEach(() => {
  vi.resetAllMocks(); h.auth.mockResolvedValue(true);
  const date = new Date("2030-01-01");
  h.prisma.bubuiOffer.findMany.mockResolvedValueOnce([{ id: "challenge", customerId: "owner", usesExactReferralTracking: true, unlockShares: 2, unlockRequiresPurchase: true, expiresAt: date, createdAt: date }]).mockResolvedValueOnce([{ id: "welcome", customerId: "friend", triggerBusinessId: "ref:welcome:challenge", discountPct: 20 }]);
  h.prisma.bubuiCustomer.findMany.mockResolvedValueOnce([{ id: "owner", name: "Owner", phone: "+34600000000" }]).mockResolvedValueOnce([{ id: "friend", name: "Fictional friend", phone: "+34600000001", referralOfferId: "older-challenge", createdAt: date }]);
  h.prisma.bubuiChallengeParticipant.findMany.mockResolvedValue([{ offerId: "challenge", friendCustomerId: "friend", status: "confirmed", registeredAt: date, contactedAt: date, decidedAt: date }]);
  h.prisma.bubuiPurchase.findMany.mockResolvedValue([]);
});

describe("business challenge list", () => {
  it("shows contact details and one payment even when the friend's old referral is different", async () => {
    const response = await GET(new Request("https://example.test/challenges"), { params: Promise.resolve({ id: "business" }) });
    const { items } = await response.json();
    expect(items[0]).toMatchObject({ done: 1, left: 1, need: 2 });
    expect(items[0].friends[0]).toMatchObject({ customerId: "friend", phone: "+34600000001", redeemed: true });
  });
  it("does not count a purchase linked to a different coupon", async () => {
    h.prisma.bubuiChallengeParticipant.findMany.mockResolvedValue([{ offerId: "challenge", friendCustomerId: "friend", status: "registered", registeredAt: new Date() }]);
    h.prisma.bubuiPurchase.findMany.mockResolvedValue([{ redeemedOfferId: "unrelated-coupon" }]);
    const response = await GET(new Request("https://example.test/challenges"), { params: Promise.resolve({ id: "business" }) });
    const { items } = await response.json();
    expect(items[0]).toMatchObject({ done: 0, left: 2 });
    expect(h.prisma.bubuiPurchase.findMany.mock.calls[0][0].where).toEqual({ businessId: "business", status: "confirmed", redeemedOfferId: { in: ["welcome"] } });
  });
  it("rejects access without an authorized business session", async () => {
    h.auth.mockResolvedValue(false);
    expect((await GET(new Request("https://example.test/challenges"), { params: Promise.resolve({ id: "business" }) })).status).toBe(401);
    expect(h.prisma.bubuiOffer.findMany).not.toHaveBeenCalled();
  });
});
