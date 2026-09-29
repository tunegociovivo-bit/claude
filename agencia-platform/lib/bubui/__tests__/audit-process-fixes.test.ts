// Audit characterization: passing tests reproduce defects, NOT release readiness.
// Entirely fictional data; all persistence and external services are mocked.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => {
  const model = () => Object.fromEntries(["findUnique", "findFirst", "findMany", "count", "create", "update", "updateMany", "delete", "deleteMany", "upsert", "createMany"].map(k => [k, vi.fn()]));
  return { prisma: Object.fromEntries(["bubuiCustomer", "bubuiBusiness", "bubuiPurchase", "bubuiOffer", "bubuiTicketScan", "bubuiPushSubscription", "bubuiMobilePushToken", "bubuiTableParticipant", "bubuiTableSession", "bubuiBooking", "bubuiProcessedWebhook", "bubuiPushAd", "bubuiGoogleReview", "bubuiSocialFollow", "bubuiOperation"].map(k => [k, model()])) as any,
    unlock: vi.fn(), challenge: vi.fn(), alert: vi.fn(), cancel: vi.fn() };
});
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/bubui/core", () => ({ unlockOffersForPurchase: h.unlock, haversineMeters: () => 0, recalculateVisibilityScore: vi.fn(async () => {}), recalculateAmbassadorLevel: vi.fn(async () => {}) }));
vi.mock("@/lib/bubui/challenge-redemption", () => ({ reevaluateChallengeAfterFriendCouponRedemption: h.challenge }));
vi.mock("@/lib/bubui/referral", () => ({ notifyBusinessNewReferredClient: vi.fn(async () => {}) }));
vi.mock("@/lib/bubui/share-offer", () => ({ createShareChallengeOffer: vi.fn(async () => null) }));
vi.mock("@/lib/bubui/business-push", () => ({ alertBusiness: h.alert }));
vi.mock("@/lib/bubui/wallet", () => ({ computeWalletApplication: () => null, consumeWallet: vi.fn(), effectiveWalletPct: () => 0 }));
vi.mock("@/lib/bubui/plus", () => ({ getPlusEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/bubui/stripe", () => ({ verifyStripeSignature: () => true, cancelSubscriptionAtPeriodEnd: h.cancel }));
vi.mock("@/lib/storage/r2", () => ({ isStorageEnabled: () => true, uploadBuffer: vi.fn(async () => {}), signedDownloadUrl: vi.fn(async () => "https://example.test/fake-image") }));
vi.mock("@/lib/ai/anthropic", () => ({ completeVision: vi.fn(async () => '{"amount":null,"confidence":0}') }));
vi.mock("@/lib/bubui/notify", () => ({ notifyBubuiCustomer: vi.fn(async () => ({ sent: 0 })) }));
import { POST as scan } from "@/app/api/bubui/scan/route";
import { POST as confirm } from "@/app/api/bubui/purchase/confirm/route";
import { POST as booking } from "@/app/api/bubui/booking/route";
import { POST as signup } from "@/app/api/bubui/customer/signup/route";
import { DELETE as deleteAccount } from "@/app/api/bubui/customer/[id]/route";
import { POST as webhook } from "@/app/api/bubui/stripe/webhook/route";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { finalizeMesaBill } from "@/lib/bubui/table";
import { grantLoyaltyIfReached } from "@/lib/bubui/loyalty";
import { PATCH as profile } from "@/app/api/bubui/business/[id]/profile/route";
import { POST as readTicket } from "@/app/api/bubui/scan/read-ticket/route";
import { POST as postPurchase } from "@/app/api/bubui/post-purchase/[purchaseId]/action/route";
import { POST as subscribePush } from "@/app/api/bubui/push/subscribe/route";
const request = (body: unknown, auth?: string) => new Request("https://example.test/audit", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}), "stripe-signature": "mock-only" }, body: JSON.stringify(body) });
const originalEnv = { ...process.env };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Audit forbids network"); }));
  process.env.BUBUI_CUSTOMER_AUTH_MODE = "strict";
  process.env.BUBUI_BUSINESS_AUTH_MODE = "strict";
  process.env.BUBUI_STRIPE_WEBHOOK_SECRET = "fictional-test-only";
  h.prisma.$transaction = vi.fn(async (ops: any) => typeof ops === "function" ? ops(h.prisma) : Promise.all(ops));
  h.prisma.bubuiCustomer.findUnique.mockResolvedValue({ id: "customer-test", apiToken: "test", totalPurchases: 0, email: null });
  h.prisma.bubuiCustomer.update.mockResolvedValue({ id: "customer-test", email: null });
  h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ id: "business-test", apiToken: "test", active: true, bookingEnabled: true, defaultDiscountPct: 10, loyaltyEnabled: false });
  h.prisma.bubuiPurchase.findFirst.mockResolvedValue(null);
  h.prisma.bubuiPurchase.create.mockImplementation(async ({ data }: any) => ({ id: "purchase-test", ...data }));
  h.prisma.bubuiPurchase.update.mockResolvedValue({});
  h.prisma.bubuiTicketScan.update.mockResolvedValue({});
  h.prisma.bubuiOffer.findFirst.mockResolvedValue(null);
  h.prisma.bubuiOffer.update.mockResolvedValue({});
  h.prisma.bubuiPurchase.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.bubuiTicketScan.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.bubuiTableSession.updateMany.mockResolvedValue({ count: 1 });
  h.unlock.mockResolvedValue({ created: 0 });
  h.prisma.bubuiOperation.upsert.mockResolvedValue({});
  h.alert.mockResolvedValue(undefined);
  h.challenge.mockResolvedValue(undefined);
});
afterEach(() => { process.env = { ...originalEnv }; vi.unstubAllGlobals(); });

describe("process security regression", () => {
  it("A07: expired or cancelled tables can still be finalized", async () => {
    for (const status of ["expired", "cancelled"]) {
      h.prisma.bubuiTableSession.findUnique.mockResolvedValue({ id: "table-test", status, expiresAt: new Date(0), business: { id: "business-test" }, participants: [] });
      await expect(finalizeMesaBill("table-test", 100, "customer-test")).rejects.toThrow("mesa_closed");
      expect(h.prisma.bubuiOffer.upsert).not.toHaveBeenCalled();
    }
  });
  it("A08: anonymous booking can attach another customer's identifier", async () => {
    h.prisma.bubuiBooking.upsert.mockImplementation(async ({ create }: any) => ({ id: "booking-test", ...create }));
    const response = await booking(request({ businessId: "business-test", customerId: "someone-else", customerName: "Ficticio", customerPhone: "600000000", startsAt: new Date(Date.now() + 86400000).toISOString() }));
    expect(response.status).toBe(401);
    expect(h.prisma.bubuiBooking.upsert).not.toHaveBeenCalled();
  });
  it("A15: a required but unreadable ticket still permits an arbitrary manual amount", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ id: "business-test", active: true, requireTicket: true, defaultDiscountPct: 10 });
    h.prisma.bubuiTicketScan.findUnique.mockResolvedValue({ id: "ticket-test", createdAt: new Date(), customerId: "customer-test", usedByPurchaseId: null, amount: null, confidence: 0, ticketUrl: "https://example.test/fake-image" });
    const response = await scan(request({ customerId: "customer-test", businessId: "business-test", amount: 9999, ticketScanId: "ticket-test" }, "Bearer customer-test:test"));
    expect(await response.json()).toMatchObject({ status: "pending", discountAmount: 999.9 });
  });
  it("A17: a rejected purchase can earn a post-purchase share coupon without proof", async () => {
    h.prisma.bubuiPurchase.findUnique.mockResolvedValue({ id: "purchase-test", customerId: "customer-test", businessId: "business-test", status: "rejected", business: { id: "business-test", shareOfferPct: 20 } });
    h.prisma.bubuiOffer.findUnique.mockResolvedValue(null);
    const data = new FormData(); data.set("action", "share");
    const response = await postPurchase(new Request("https://example.test/post-purchase", { method: "POST", headers: { authorization: "Bearer customer-test:test" }, body: data }), { params: Promise.resolve({ purchaseId: "purchase-test" }) });
    expect(response.status).toBe(409);
    expect(h.prisma.bubuiOffer.create).not.toHaveBeenCalled();
  });
  it("A20: booking persists then fails if merchant notification fails", async () => {
    h.prisma.bubuiBooking.upsert.mockImplementation(async ({ data }: any) => ({ id: "booking-test", ...data }));
    h.alert.mockRejectedValue(new Error("Notification unavailable"));
    const response = await booking(request({ businessId: "business-test", customerName: "Ficticio", customerPhone: "600000000", startsAt: new Date(Date.now() + 86400000).toISOString() }));
    expect(response.status).toBe(201);
    expect(h.prisma.bubuiBooking.upsert).toHaveBeenCalledOnce();
  });
});
