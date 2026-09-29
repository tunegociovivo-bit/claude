// Regression tests: fictional fixtures; no external service calls.
// Entirely fictional data; all persistence and external services are mocked.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => {
  const model = () => Object.fromEntries(["findUnique", "findFirst", "findMany", "count", "create", "update", "updateMany", "delete", "deleteMany", "upsert", "createMany"].map(k => [k, vi.fn()]));
  return { prisma: Object.fromEntries(["bubuiCustomer", "bubuiBusiness", "bubuiPurchase", "bubuiOffer", "bubuiTicketScan", "bubuiPushSubscription", "bubuiMobilePushToken", "bubuiTableParticipant", "bubuiTableSession", "bubuiBooking", "bubuiProcessedWebhook", "bubuiPushAd"].map(k => [k, model()])) as any,
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
vi.mock("@/lib/bubui/stripe", () => ({ verifyStripeSignature: () => true, cancelSubscriptionAtPeriodEnd: h.cancel, cancelSubscriptionImmediately: h.cancel }));
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
  h.prisma.bubuiOffer.createMany.mockResolvedValue({ count: 1 });
  h.prisma.bubuiPurchase.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.bubuiPushAd.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.bubuiPushSubscription.findMany.mockResolvedValue([]);
  h.prisma.bubuiMobilePushToken.findMany.mockResolvedValue([]);
  h.unlock.mockResolvedValue({ created: 0 });
  h.alert.mockResolvedValue(undefined);
  h.challenge.mockResolvedValue(undefined);
});
afterEach(() => { process.env = { ...originalEnv }; vi.unstubAllGlobals(); });
describe("Bubui release regressions", () => {
  it("A03: customer scan confirms a challenge coupon without merchant payment approval or location", async () => {
    h.prisma.bubuiOffer.findFirst.mockResolvedValue({ id: "friend-coupon", discountPct: 20, source: "referral_welcome", triggerBusinessId: "ref:welcome:challenge-test" });
    const response = await scan(request({ customerId: "customer-test", businessId: "business-test", amount: 250 }, "Bearer customer-test:test"));
    expect(await response.json()).toMatchObject({ status: "pending", discountAmount: 50 });
    expect(h.challenge).not.toHaveBeenCalled();
    expect(h.prisma.bubuiCustomer.update).not.toHaveBeenCalled();
  });
  it("A04: concurrent confirmations increment savings twice for a single pending purchase", async () => {
    h.prisma.bubuiPurchase.findUnique.mockResolvedValue({ id: "purchase-test", businessId: "business-test", customerId: "customer-test", status: "pending", discountAmount: 50 });
    let claimed = false;
    h.prisma.bubuiPurchase.updateMany.mockImplementation(async () => { if (claimed) return { count: 0 }; claimed = true; return { count: 1 }; });
    const body = { purchaseId: "purchase-test", businessId: "business-test", action: "confirm" };
    const responses = await Promise.all([confirm(request(body, "Bearer business-test:test")), confirm(request(body, "Bearer business-test:test"))]);
    expect(responses.every(r => [200, 409].includes(r.status))).toBe(true);
    expect(h.prisma.bubuiCustomer.update).toHaveBeenCalledTimes(1);
    expect(h.prisma.$transaction).toHaveBeenCalled();
  });
  it("A05: scan completes the fifth loyalty stamp without creating the reward", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ id: "business-test", apiToken: "test", active: true, loyaltyEnabled: true, loyaltyGoal: 5, loyaltyRewardPct: 20 });
    h.prisma.bubuiPurchase.count.mockResolvedValue(5);
    expect((await scan(request({ customerId: "customer-test", businessId: "business-test", amount: 25 }, "Bearer customer-test:test"))).status).toBe(200);
    expect(h.prisma.bubuiOffer.createMany).toHaveBeenCalledOnce();
  });
  it("A06: a reward missed at five purchases is not recovered at six", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ loyaltyEnabled: true, loyaltyGoal: 5, loyaltyRewardPct: 20 });
    h.prisma.bubuiPurchase.count.mockResolvedValue(6);
    expect(await grantLoyaltyIfReached({ customerId: "customer-test", businessId: "business-test" })).toMatchObject({ granted: true, cycle: 1 });
  });
  it("A09: account deletion does not cancel its paid subscription", async () => {
    h.prisma.bubuiCustomer.findUnique.mockResolvedValue({ id: "customer-test", apiToken: "test", bubuiStripeSubscriptionId: "sub_fake", plan: "plus" });
    const response = await deleteAccount(request({}, "Bearer customer-test:test"), { params: { id: "customer-test" } });
    expect(response.status).toBe(200);
    expect(h.prisma.bubuiCustomer.delete).toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledWith("sub_fake");
  });
  it("A10: webhook treats a database outage as an already processed payment", async () => {
    h.prisma.bubuiProcessedWebhook.create.mockRejectedValue(new Error("Database offline"));
    const response = await webhook(request({ id: "evt_fake", type: "checkout.session.completed" }));
    expect(response.status).toBe(500);
  });
  it("A12: ad payment chooses the latest scheduled campaign instead of the paid campaign", async () => {
    h.prisma.bubuiPushAd.findFirst.mockResolvedValue({ id: "newer-unpaid-ad" });
    h.prisma.bubuiPushAd.findUnique.mockResolvedValue({ id: "paid-ad", businessId: "business-test", pricePaidEur: 10, status: "scheduled" });
    await webhook(request({ id: "evt_fake", type: "checkout.session.completed", data: { object: { id: "cs_fake", payment_status: "paid", amount_total: 1000, currency: "eur", metadata: { bubui_business_id: "business-test", bubui_kind: "push_ad", bubui_ad_id: "paid-ad" } } } }));
    expect(h.prisma.bubuiPushAd.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.bubuiPushAd.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "paid-ad" }) }));
  });
  it("A13: forged business token changes profile and contact destination even in strict mode", async () => {
    h.prisma.bubuiBusiness.update.mockResolvedValue({ id: "business-test" });
    const response = await profile(request({ notificationEmail: "fake@example.test", defaultDiscountPct: 50 }, "Bearer business-test:FORGED"), { params: { id: "business-test" } });
    expect(response.status).toBe(401);
    expect(h.prisma.bubuiBusiness.update).not.toHaveBeenCalled();
  });
  it("A16: double-confirm purchase mode is ignored by scan", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ id: "business-test", active: true, purchaseMode: "double_confirm", defaultDiscountPct: 10 });
    const response = await scan(request({ customerId: "customer-test", businessId: "business-test", amount: 50 }, "Bearer customer-test:test"));
    expect(await response.json()).toMatchObject({ status: "pending" });
  });
  it("A19: malformed website URL throws instead of returning a validation error", async () => {
    expect((await profile(request({ websiteUrl: "example" }, "Bearer business-test:test"), { params: { id: "business-test" } })).status).toBe(400);
    expect(h.prisma.bubuiBusiness.update).not.toHaveBeenCalled();
  });
});
