import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  allowed: vi.fn(), notify: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    bubuiOffer: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    bubuiCustomer: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    bubuiChallengeParticipant: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    bubuiPurchase: { findMany: vi.fn() },
    bubuiBusiness: { findUnique: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/bubui/auth", () => ({ businessTokenAllows: h.allowed }));
vi.mock("@/lib/bubui/notify", () => ({ notifyBubuiCustomer: h.notify }));
vi.mock("@/lib/integrations/email", () => ({ sendEmail: vi.fn(), isEmailEnabled: () => false }));
import { POST } from "@/app/api/bubui/business/[id]/challenges/[offerId]/friends/[friendId]/route";
import { countQualifiedOfferReferrals } from "../referral";

let active: boolean;
let expired: boolean;
let rows: { id: string; friendCustomerId: string; referrerCustomerId: string; status: string; contactedAt: Date | null; nextFollowupAt: Date | null; reminderSentAt: Date | null }[];
const call = (friendId: string, action = "yes", businessId = "business-test") => POST(new Request("https://example.test/payment", {
  method: "POST", body: JSON.stringify({ action })
}), { params: { id: businessId, offerId: "challenge-test", friendId } });

beforeEach(() => {
  vi.resetAllMocks();
  active = false; expired = false;
  rows = ["friend-one", "friend-two"].map((id) => ({ id, friendCustomerId: id, referrerCustomerId: "inviter", status: "registered", contactedAt: null, nextFollowupAt: new Date("2030-01-01"), reminderSentAt: null }));
  h.allowed.mockResolvedValue(true);
  h.prisma.$transaction.mockImplementation(async (callback) => callback(h.prisma));
  h.notify.mockResolvedValue(undefined);
  h.prisma.bubuiOffer.findFirst.mockImplementation(async () => expired ? null : { id: "challenge-test" });
  h.prisma.bubuiChallengeParticipant.findFirst.mockImplementation(async ({ where }) => where.businessId === "business-test" ? rows.find((row) => row.friendCustomerId === where.friendCustomerId) : null);
  h.prisma.bubuiChallengeParticipant.updateMany.mockImplementation(async ({ where, data }) => {
    const row = rows.find((r) => r.id === where.id && (!where.status || r.status === where.status) && (where.contactedAt !== null || r.contactedAt === null));
    if (!row) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  h.prisma.bubuiChallengeParticipant.findMany.mockImplementation(async () => rows);
  h.prisma.bubuiCustomer.count.mockResolvedValue(2);
  h.prisma.bubuiCustomer.findMany.mockImplementation(async ({ where }) => rows.filter((r) => where.id.in.includes(r.id)).map((r) => ({ id: r.id })));
  h.prisma.bubuiCustomer.findUnique.mockResolvedValue({ name: "Amigo ficticio", phone: "+34600000000" });
  h.prisma.bubuiPurchase.findMany.mockResolvedValue([]);
  h.prisma.bubuiOffer.findMany.mockImplementation(async ({ where }) => where.source === "share_challenge"
    ? active ? [] : [{ id: "challenge-test", businessId: "business-test", customerId: "inviter", usesExactReferralTracking: true, unlockRequiresPurchase: true, unlockShares: 2, business: { name: "Negocio ficticio" }, discountPct: 20 }]
    : rows.map((r) => ({ id: `welcome-${r.id}`, customerId: r.id })));
  h.prisma.bubuiOffer.updateMany.mockImplementation(async ({ where }) => {
    if (where.source === "referral_welcome") return { count: 1 };
    if (active) return { count: 0 };
    active = true;
    return { count: 1 };
  });
});

describe("two-friend payment journey with fictional in-memory data", () => {
  it("progresses 0/2 → 1/2 → 2/2 and unlocks once, with safe retries", async () => {
    expect(await countQualifiedOfferReferrals("inviter", "challenge-test", "business-test")).toBe(0);
    expect((await call("friend-one")).status).toBe(200);
    expect(await countQualifiedOfferReferrals("inviter", "challenge-test", "business-test")).toBe(1);
    expect(active).toBe(false);
    expect(h.prisma.bubuiOffer.updateMany).toHaveBeenCalledWith({ where: { customerId: "friend-one", businessId: "business-test", source: "referral_welcome", triggerBusinessId: "ref:welcome:challenge-test", redeemed: false }, data: { redeemed: true, redeemedAt: expect.any(Date) } });
    expect((await call("friend-one")).status).toBe(200);
    expect(await countQualifiedOfferReferrals("inviter", "challenge-test", "business-test")).toBe(1);
    expect((await call("friend-two")).status).toBe(200);
    expect(await countQualifiedOfferReferrals("inviter", "challenge-test", "business-test")).toBe(2);
    expect(active).toBe(true);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect((await call("friend-two")).status).toBe(200);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
  it("does not allow a paid friend to be changed back to pending", async () => {
    await call("friend-one");
    expect((await call("friend-one", "later")).status).toBe(409);
    expect(rows[0].status).toBe("confirmed");
  });
  it("does not modify another business's challenge", async () => {
    expect((await call("friend-one", "yes", "other-business")).status).toBe(404);
    expect(rows[0].status).toBe("registered");
  });
  it("does not unlock expired challenges", async () => {
    expired = true;
    expect((await call("friend-one")).status).toBe(409);
    expect(h.prisma.bubuiChallengeParticipant.updateMany).not.toHaveBeenCalled();
  });
  it("preserves the follow-up schedule when sending a reminder", async () => {
    const scheduled = rows[0].nextFollowupAt;
    expect((await call("friend-one", "remind")).status).toBe(200);
    expect(rows[0].nextFollowupAt).toEqual(scheduled);
  });
  it("rejects an unauthorized business", async () => {
    h.allowed.mockResolvedValue(false);
    expect((await call("friend-one")).status).toBe(401);
    expect(h.prisma.bubuiChallengeParticipant.findFirst).not.toHaveBeenCalled();
  });
});
