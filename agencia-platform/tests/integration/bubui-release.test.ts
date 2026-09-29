import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { settlePurchase } from "@/lib/bubui/purchase-settlement";
import { grantLoyaltyIfReached } from "@/lib/bubui/loyalty";
import { countQualifiedOfferReferrals } from "@/lib/bubui/referral";
import { POST as scan } from "@/app/api/bubui/scan/route";
import { POST as confirm } from "@/app/api/bubui/purchase/confirm/route";
import { POST as markPaid } from "@/app/api/bubui/business/[id]/challenges/[offerId]/friends/[friendId]/route";
import { POST as webhook } from "@/app/api/bubui/stripe/webhook/route";

vi.mock("@/lib/bubui/core", () => ({
  haversineMeters: () => 0, unlockOffersForPurchase: async () => ({ created: 0 }),
  recalculateVisibilityScore: async () => {}, recalculateAmbassadorLevel: async () => {}
}));
vi.mock("@/lib/bubui/notify", () => ({ notifyBubuiCustomer: async () => ({ sent: 0 }) }));
vi.mock("@/lib/bubui/business-push", () => ({ alertBusiness: async () => {} }));
vi.mock("@/lib/integrations/email", () => ({ isEmailEnabled: () => false, sendEmail: async () => {} }));
vi.mock("@/lib/bubui/email", () => ({ sendPurchaseConfirmationEmail: async () => {} }));
vi.mock("@/lib/bubui/stripe", () => ({ verifyStripeSignature: () => true }));

const prefix = `audit-${randomUUID()}`;
let n = 0;
const id = () => `${prefix}-${++n}`;
const request = (body: unknown, owner: string) => new Request("http://localhost/test", {
  method: "POST", headers: { authorization: `Bearer ${owner}:test`, "stripe-signature": "fictional" }, body: JSON.stringify(body)
});
beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/bubui_audit_test") throw new Error("Only the isolated local fictional database is allowed");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden in integration tests"); }));
  vi.stubEnv("BUBUI_STRIPE_WEBHOOK_SECRET", "fictional");
});
afterAll(async () => {
  await prisma.bubuiChallengeParticipant.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.bubuiBusiness.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.bubuiCustomer.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.bubuiProcessedWebhook.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
async function fixtures() {
  const businessId = id(); const customerId = id();
  const business = await prisma.bubuiBusiness.create({ data: {
    id: businessId, slug: businessId, name: "Comercio ficticio", category: "fitness", ownerEmail: `${businessId}@example.test`,
    ownerPasswordHash: "not-a-real-password", apiToken: "test", active: true, purchaseMode: "double_confirm", shareOfferPct: 0
  } });
  const customer = await prisma.bubuiCustomer.create({ data: { id: customerId, email: `${customerId}@example.test`, apiToken: "test", phoneVerified: true } });
  return { business, customer };
}
async function purchase(businessId: string, customerId: string, extra = {}) {
  return prisma.bubuiPurchase.create({ data: { businessId, customerId, amount: 250, discountPct: 20, discountAmount: 50, ...extra } });
}
async function challengeFixture() {
  const { business, customer: inviter } = await fixtures();
  const parent = await prisma.bubuiOffer.create({ data: {
    customerId: inviter.id, businessId: business.id, discountPct: 20, source: "share_challenge", triggerBusinessId: id(),
    active: false, usesExactReferralTracking: true, unlockRequiresPurchase: true, unlockShares: 2, expiresAt: new Date(Date.now() + 86400000)
  } });
  const friends = [];
  for (let i = 0; i < 2; i++) {
    const friendId = id();
    const friend = await prisma.bubuiCustomer.create({ data: { id: friendId, email: `${friendId}@example.test`, phoneVerified: true, apiToken: "test", referredById: inviter.id } });
    const coupon = await prisma.bubuiOffer.create({ data: {
      customerId: friend.id, businessId: business.id, discountPct: 20, source: "referral_welcome",
      triggerBusinessId: `ref:welcome:${parent.id}`, expiresAt: parent.expiresAt
    } });
    await prisma.bubuiChallengeParticipant.create({ data: { id: id(), offerId: parent.id, friendCustomerId: friend.id, referrerCustomerId: inviter.id, businessId: business.id } });
    friends.push({ friend, coupon });
  }
  return { business, inviter, parent, friends };
}

describe("Bubui with real isolated PostgreSQL and fictional people", () => {
  it("20 concurrent confirmations save the purchase and savings only once", async () => {
    const { business, customer } = await fixtures();
    const p = await purchase(business.id, customer.id);
    const results = await Promise.all(Array.from({ length: 20 }, () => confirm(request({ purchaseId: p.id, businessId: business.id, action: "confirm" }, business.id))));
    expect(results.every(r => [200, 409].includes(r.status))).toBe(true);
    expect(await prisma.bubuiCustomer.findUnique({ where: { id: customer.id } })).toMatchObject({ totalSaved: 50, totalPurchases: 1 });
  });
  it("rolls back status, savings and coupon when reward persistence fails", async () => {
    const { business, customer } = await fixtures();
    const p = await purchase(business.id, customer.id);
    await expect(prisma.$transaction(async tx => {
      await settlePurchase(tx, p);
      throw new Error("simulated database failure before commit");
    })).rejects.toThrow("simulated database failure");
    expect(await prisma.bubuiPurchase.findUnique({ where: { id: p.id } })).toMatchObject({ status: "pending" });
    expect(await prisma.bubuiCustomer.findUnique({ where: { id: customer.id } })).toMatchObject({ totalSaved: 0, totalPurchases: 0 });
    await prisma.$transaction(tx => settlePurchase(tx, p));
    expect(await prisma.bubuiCustomer.findUnique({ where: { id: customer.id } })).toMatchObject({ totalSaved: 50, totalPurchases: 1 });
  });
  it("keeps both friend scans pending, then advances 0/2 → 1/2 → 2/2 on merchant confirmation", async () => {
    const { business, inviter, parent, friends } = await challengeFixture();
    const scans = [];
    for (const { friend } of friends) {
      const r = await scan(request({ businessId: business.id, customerId: friend.id, amount: 250 }, friend.id));
      expect(r.status).toBe(200); const body = await r.json(); expect(body.status).toBe("pending"); scans.push(body);
    }
    expect(await countQualifiedOfferReferrals(inviter.id, parent.id, business.id)).toBe(0);
    for (let i = 0; i < 2; i++) {
      const body = { businessId: business.id, purchaseId: scans[i].purchaseId, action: "confirm" };
      expect((await confirm(request(body, business.id))).status).toBe(200);
      expect((await confirm(request(body, business.id))).status).toBe(200);
      expect(await countQualifiedOfferReferrals(inviter.id, parent.id, business.id)).toBe(i + 1);
      expect((await prisma.bubuiOffer.findUnique({ where: { id: parent.id } }))?.active).toBe(i === 1);
    }
  });
  it("manual paid and purchase confirmation use the same pending purchase", async () => {
    const { business, parent, friends } = await challengeFixture();
    const { friend, coupon } = friends[0];
    const p = await purchase(business.id, friend.id, { redeemedOfferId: coupon.id });
    expect((await markPaid(request({ action: "yes" }, business.id), { params: { id: business.id, offerId: parent.id, friendId: friend.id } })).status).toBe(200);
    expect((await confirm(request({ businessId: business.id, purchaseId: p.id, action: "confirm" }, business.id))).status).toBe(200);
    expect(await prisma.bubuiCustomer.findUnique({ where: { id: friend.id } })).toMatchObject({ totalPurchases: 1, totalSaved: 50 });
  });
  it("concurrent scans create one pending purchase", async () => {
    const { business, customer } = await fixtures();
    const body = { customerId: customer.id, businessId: business.id, amount: 100 };
    const results = await Promise.all(Array.from({ length: 8 }, () => scan(request(body, customer.id))));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(await prisma.bubuiPurchase.count({ where: { customerId: customer.id } })).toBe(1);
  });
  it("recovers missed loyalty rewards at purchase 11 without duplicates", async () => {
    const { business, customer } = await fixtures();
    await prisma.bubuiBusiness.update({ where: { id: business.id }, data: { loyaltyEnabled: true, loyaltyGoal: 5, loyaltyRewardPct: 20 } });
    for (let i = 0; i < 11; i++) await purchase(business.id, customer.id, { status: "confirmed" });
    await Promise.all(Array.from({ length: 6 }, () => grantLoyaltyIfReached({ customerId: customer.id, businessId: business.id })));
    expect(await prisma.bubuiOffer.count({ where: { customerId: customer.id, source: "loyalty" } })).toBe(2);
  });
  it("concurrent payment webhooks activate only the paid ad, even when a newer one exists", async () => {
    const { business } = await fixtures();
    const ad = async () => prisma.bubuiPushAd.create({ data: { businessId: business.id, title: "Ficticio", body: "Prueba local", radiusKm: 1, centerLat: 0, centerLng: 0, reach: 1, pricePaidEur: 10, startsAt: new Date(), endsAt: new Date(Date.now() + 86400000) } });
    const paid = await ad(); const unpaid = await ad();
    const body = { id: id(), type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: 1000, currency: "eur", metadata: { bubui_kind: "push_ad", bubui_ad_id: paid.id, bubui_business_id: business.id } } } };
    const responses = await Promise.all(Array.from({ length: 6 }, () => webhook(request(body, business.id))));
    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(await prisma.bubuiPushAd.findUnique({ where: { id: paid.id } })).toMatchObject({ status: "ready" });
    expect(await prisma.bubuiPushAd.findUnique({ where: { id: unpaid.id } })).toMatchObject({ status: "scheduled" });
  });
});
