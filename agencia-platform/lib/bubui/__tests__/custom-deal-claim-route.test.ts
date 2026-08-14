import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  prisma: {
    bubuiCustomDeal: { findUnique: vi.fn(), update: vi.fn() },
    bubuiCustomer: { updateMany: vi.fn(), findUnique: vi.fn() },
    bubuiOffer: { create: vi.fn() }
  },
  authOk: vi.fn(),
  ensureReferralCode: vi.fn(),
  applyReferral: vi.fn(),
  recordDealTrace: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: H.prisma }));
vi.mock("@/lib/bubui/customer-auth", () => ({ customerAuthOk: H.authOk }));
vi.mock("@/lib/bubui/referral", () => ({
  ensureReferralCode: H.ensureReferralCode,
  applyReferral: H.applyReferral,
  countVerifiedReferrals: vi.fn(),
  countQualifiedReferrals: vi.fn()
}));
vi.mock("@/lib/bubui/business-push", () => ({ alertBusiness: vi.fn() }));
vi.mock("@/lib/bubui/deal-trace", () => ({ recordDealTrace: H.recordDealTrace }));

import { POST } from "../../../app/api/bubui/custom-deal/[token]/claim/route";

const TOKEN = "60df921bb7bdeb5d";

beforeEach(() => {
  vi.clearAllMocks();
  H.authOk.mockResolvedValue(true);
  H.prisma.bubuiCustomDeal.findUnique.mockResolvedValue({
    id: "deal-1",
    token: TOKEN,
    businessId: "biz-1",
    claimedByCustomerId: "owner-1",
    offerId: "offer-challenge-123",
    expiresAt: new Date(Date.now() + 60_000),
    clientDiscountPct: 30,
    friendsRequired: 5,
    friendDiscountPct: 15
  });
  H.ensureReferralCode.mockImplementation(async (id: string) => id === "owner-1" ? "OWNER1" : "FRIEND1");
  H.applyReferral.mockResolvedValue({ linked: true, terminal: true, reason: "linked", welcomeOfferCreated: true });
});

describe("POST claim de un /reto reenviado", () => {
  it("convierte al segundo usuario en amigo del participante sin reutilizar el claim", async () => {
    const req = new Request(`https://bubui.app/api/bubui/custom-deal/${TOKEN}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: "friend-1" })
    });

    const res = await POST(req, { params: { token: TOKEN } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(H.ensureReferralCode).toHaveBeenCalledWith("owner-1");
    expect(H.applyReferral).toHaveBeenCalledWith("friend-1", "OWNER1", "offer-challenge-123");
    expect(body).toMatchObject({ ok: true, joinedAsFriend: true, referralCode: "OWNER1" });
    expect(H.prisma.bubuiCustomDeal.update).not.toHaveBeenCalled();
  });
});
