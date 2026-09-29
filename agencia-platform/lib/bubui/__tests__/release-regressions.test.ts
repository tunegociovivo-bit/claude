// Regression tests: fictional fixtures; no external service calls.
// Entirely fictional data; all persistence and external services are mocked.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => {
  const model = () => Object.fromEntries(["findUnique", "findFirst", "findMany", "count", "create", "update", "updateMany", "delete", "deleteMany", "upsert", "createMany"].map(k => [k, vi.fn()]));
  return { prisma: Object.fromEntries(["bubuiCustomer", "bubuiBusiness", "bubuiPurchase", "bubuiOffer", "bubuiTicketScan", "bubuiPushSubscription", "bubuiMobilePushToken", "bubuiTableParticipant", "bubuiTableSession", "bubuiBooking", "bubuiProcessedWebhook", "bubuiPushAd", "bubuiChallengeParticipant", "bubuiOperation"].map(k => [k, model()])) as any,
    unlock: vi.fn(), challenge: vi.fn(), alert: vi.fn(), cancel: vi.fn() };
});
vi.mock("@/lib/bubui/customer-media", () => ({ deleteCustomerMedia: vi.fn(async () => {}) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/bubui/core", () => ({ unlockOffersForPurchase: h.unlock, haversineMeters: () => 0, recalculateVisibilityScore: vi.fn(async () => {}), recalculateAmbassadorLevel: vi.fn(async () => {}) }));
vi.mock("@/lib/bubui/challenge-redemption", () => ({ reevaluateChallengeAfterFriendCouponRedemption: h.challenge }));
vi.mock("@/lib/bubui/referral", () => ({ notifyBusinessNewReferredClient: vi.fn(async () => {}) }));
vi.mock("@/lib/bubui/share-offer", () => ({ createShareChallengeOffer: vi.fn(async () => null) }));
vi.mock("@/lib/bubui/business-push", () => ({ alertBusiness: h.alert }));
vi.mock("@/lib/bubui/wallet", () => ({ computeWalletApplication: () => null, consumeWallet: vi.fn(), effectiveWalletPct: () => 0 }));
vi.mock("@/lib/bubui/plus", () => ({ getPlusEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/bubui/stripe", () => ({ verifyStripeSignature: () => true, cancelSubscriptionAtPeriodEnd: h.cancel, cancelSubscriptionImmediately: h.cancel }));
vi.mock("@/lib/bubui/notify", () => ({ notifyBubuiCustomer: vi.fn(async () => ({ sent: 0 })) }));
import { POST as scan } from "@/app/api/bubui/scan/route";
import { POST as confirm } from "@/app/api/bubui/purchase/confirm/route";
import { DELETE as deleteAccount } from "@/app/api/bubui/customer/[id]/route";
import { POST as webhook } from "@/app/api/bubui/stripe/webhook/route";
import { grantLoyaltyIfReached } from "@/lib/bubui/loyalty";
import { PATCH as profile } from "@/app/api/bubui/business/[id]/profile/route";
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
  it("A03: friend scan remains pending until the merchant confirms payment", async () => {
    h.prisma.bubuiOffer.findFirst.mockResolvedValue({ id: "friend-coupon", discountPct: 20, source: "referral_welcome", triggerBusinessId: "ref:welcome:challenge-test" });
    const response = await scan(request({ customerId: "customer-test", businessId: "business-test", amount: 250 }, "Bearer customer-test:test"));
    expect(await response.json()).toMatchObject({ status: "pending", discountAmount: 50 });
    expect(h.challenge).not.toHaveBeenCalled();
    expect(h.prisma.bubuiCustomer.update).not.toHaveBeenCalled();
  });
  it("A04: concurrent confirmations increment savings once", async () => {
    h.prisma.bubuiPurchase.findUnique.mockResolvedValue({ id: "purchase-test", businessId: "business-test", customerId: "customer-test", status: "pending", discountAmount: 50 });
    let claimed = false;
    h.prisma.bubuiPurchase.updateMany.mockImplementation(async () => { if (claimed) return { count: 0 }; claimed = true; return { count: 1 }; });
    const body = { purchaseId: "purchase-test", businessId: "business-test", action: "confirm" };
    const responses = await Promise.all([confirm(request(body, "Bearer business-test:test")), confirm(request(body, "Bearer business-test:test"))]);
    expect(responses.every(r => [200, 409].includes(r.status))).toBe(true);
    expect(h.prisma.bubuiCustomer.update).toHaveBeenCalledTimes(1);
    expect(h.prisma.$transaction).toHaveBeenCalled();
  });
  it("A05: express scan grants the completed loyalty reward", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ id: "business-test", apiToken: "test", active: true, loyaltyEnabled: true, loyaltyGoal: 5, loyaltyRewardPct: 20 });
    h.prisma.bubuiPurchase.count.mockResolvedValue(5);
    expect((await scan(request({ customerId: "customer-test", businessId: "business-test", amount: 25 }, "Bearer customer-test:test"))).status).toBe(200);
    expect(h.prisma.bubuiOffer.createMany).toHaveBeenCalledOnce();
  });
  it("A06: recovers a missed loyalty reward at the sixth purchase", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ loyaltyEnabled: true, loyaltyGoal: 5, loyaltyRewardPct: 20 });
    h.prisma.bubuiPurchase.count.mockResolvedValue(6);
    expect(await grantLoyaltyIfReached({ customerId: "customer-test", businessId: "business-test" })).toMatchObject({ granted: true, cycle: 1 });
  });
  it("A09: cancels a paid subscription before deleting the account", async () => {
    h.prisma.bubuiCustomer.findUnique.mockResolvedValue({ id: "customer-test", apiToken: "test", bubuiStripeSubscriptionId: "sub_fake", plan: "plus" });
    const response = await deleteAccount(request({}, "Bearer customer-test:test"), { params: { id: "customer-test" } });
    expect(response.status).toBe(200);
    expect(h.prisma.bubuiCustomer.delete).toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledWith("sub_fake");
  });
  it("A10: returns a retryable failure when webhook persistence fails", async () => {
    h.prisma.bubuiProcessedWebhook.create.mockRejectedValue(new Error("Database offline"));
    const response = await webhook(request({ id: "evt_fake", type: "checkout.session.completed" }));
    expect(response.status).toBe(500);
  });
  it("A12: activates the exact paid ad instead of a newer unpaid one", async () => {
    h.prisma.bubuiPushAd.findFirst.mockResolvedValue({ id: "newer-unpaid-ad" });
    h.prisma.bubuiPushAd.findUnique.mockResolvedValue({ id: "paid-ad", businessId: "business-test", pricePaidEur: 10, status: "scheduled" });
    await webhook(request({ id: "evt_fake", type: "checkout.session.completed", data: { object: { id: "cs_fake", payment_status: "paid", amount_total: 1000, currency: "eur", metadata: { bubui_business_id: "business-test", bubui_kind: "push_ad", bubui_ad_id: "paid-ad" } } } }));
    expect(h.prisma.bubuiPushAd.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.bubuiPushAd.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "paid-ad" }) }));
  });
  it("A13: rejects forged business sessions", async () => {
    h.prisma.bubuiBusiness.update.mockResolvedValue({ id: "business-test" });
    const response = await profile(request({ notificationEmail: "fake@example.test", defaultDiscountPct: 50 }, "Bearer business-test:FORGED"), { params: { id: "business-test" } });
    expect(response.status).toBe(401);
    expect(h.prisma.bubuiBusiness.update).not.toHaveBeenCalled();
  });
  it("A16: respects double-confirm purchase mode", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ id: "business-test", active: true, purchaseMode: "double_confirm", defaultDiscountPct: 10 });
    const response = await scan(request({ customerId: "customer-test", businessId: "business-test", amount: 50 }, "Bearer customer-test:test"));
    expect(await response.json()).toMatchObject({ status: "pending" });
  });
  it("A19: returns a validation error for malformed website URLs", async () => {
    expect((await profile(request({ websiteUrl: "example" }, "Bearer business-test:test"), { params: { id: "business-test" } })).status).toBe(400);
    expect(h.prisma.bubuiBusiness.update).not.toHaveBeenCalled();
  });
  it("rejects a legacy profile session without a stored secret even in lazy mode", async () => {
    process.env.BUBUI_BUSINESS_AUTH_MODE = "lazy";
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ id: "business-test", apiToken: null });
    expect((await profile(request({ description: "Edited" }, "Bearer business-test:anything"), { params: { id: "business-test" } })).status).toBe(401);
  });
  it("preserves an account when subscription cancellation fails", async () => {
    h.prisma.bubuiCustomer.findUnique.mockResolvedValue({ id: "customer-test", apiToken: "test", bubuiStripeSubscriptionId: "sub_fake" });
    h.cancel.mockRejectedValue(new Error("Stripe unavailable"));
    expect((await deleteAccount(request({}, "Bearer customer-test:test"), { params: { id: "customer-test" } })).status).toBe(502);
    expect(h.prisma.bubuiCustomer.delete).not.toHaveBeenCalled();
  });
  it("refuses deletion without a session even in lazy mode", async () => {
    process.env.BUBUI_CUSTOMER_AUTH_MODE = "lazy";
    expect((await deleteAccount(request({}), { params: { id: "customer-test" } })).status).toBe(401);
    expect(h.cancel).not.toHaveBeenCalled();
  });
  it.each([
    { payment_status: "unpaid", amount_total: 1000, currency: "eur", adId: "paid-ad", expected: 200 },
    { payment_status: "paid", amount_total: 1, currency: "eur", adId: "paid-ad", expected: 500 },
    { payment_status: "paid", amount_total: 1000, currency: "usd", adId: "paid-ad", expected: 500 },
    { payment_status: "paid", amount_total: 1000, currency: "eur", adId: undefined, expected: 500 }
  ])("does not activate an ad for incomplete or mismatched payment: %j", async ({ adId, expected, ...payment }) => {
    h.prisma.bubuiPushAd.findUnique.mockResolvedValue({ id: "paid-ad", businessId: "business-test", pricePaidEur: 10 });
    const response = await webhook(request({ id: "evt_fake", type: "checkout.session.completed", data: { object: { ...payment, metadata: { bubui_business_id: "business-test", bubui_kind: "push_ad", bubui_ad_id: adId } } } }));
    expect(response.status).toBe(expected);
    expect(h.prisma.bubuiPushAd.updateMany).not.toHaveBeenCalled();
  });
  it("recovers all completed loyalty cycles and propagates database errors", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ loyaltyEnabled: true, loyaltyGoal: 5, loyaltyRewardPct: 20 });
    h.prisma.bubuiPurchase.count.mockResolvedValue(11);
    await grantLoyaltyIfReached({ customerId: "customer-test", businessId: "business-test" });
    expect(h.prisma.bubuiOffer.createMany.mock.calls[0][0].data.map((o: any) => o.triggerBusinessId)).toEqual(["loyalty:business-test:1", "loyalty:business-test:2"]);
    h.prisma.bubuiOffer.createMany.mockRejectedValue(new Error("Database unavailable"));
    await expect(grantLoyaltyIfReached({ customerId: "customer-test", businessId: "business-test" })).rejects.toThrow("Database unavailable");
  });
  it("repairs effects when the merchant retries an already confirmed purchase without increasing savings", async () => {
    h.prisma.bubuiPurchase.findUnique.mockResolvedValue({ id: "purchase-test", customerId: "customer-test", businessId: "business-test", status: "confirmed", redeemedOfferId: "friend-coupon", discountAmount: 50 });
    h.prisma.bubuiOffer.findUnique.mockResolvedValue({ source: "referral_welcome", triggerBusinessId: "ref:welcome:challenge-test" });
    const response = await confirm(request({ purchaseId: "purchase-test", businessId: "business-test", action: "confirm" }, "Bearer business-test:test"));
    expect(response.status).toBe(200);
    expect(h.challenge).toHaveBeenCalledWith(expect.objectContaining({ triggerBusinessId: "ref:welcome:challenge-test" }));
    expect(h.prisma.bubuiCustomer.update).not.toHaveBeenCalled();
  });

  it("requires merchant confirmation for purchase-based legacy challenges even without a welcome coupon", async () => {
    h.prisma.bubuiBusiness.findUnique.mockResolvedValue({ id: "business-test", active: true, purchaseMode: "express", shareOfferRequiresPurchase: true, defaultDiscountPct: 10 });
    const response = await scan(request({ customerId: "customer-test", businessId: "business-test", amount: 50 }, "Bearer customer-test:test"));
    expect(await response.json()).toMatchObject({ status: "pending" });
    expect(h.prisma.bubuiCustomer.update).not.toHaveBeenCalled();
  });

});
