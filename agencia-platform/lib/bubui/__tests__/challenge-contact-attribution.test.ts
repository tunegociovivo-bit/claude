import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    bubuiCustomer: { findUnique: vi.fn() },
    bubuiOffer: { findFirst: vi.fn() },
    bubuiChallengeParticipant: { findFirst: vi.fn(), updateMany: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/bubui/customer-auth", () => ({ customerIdFromAuth: () => "friend", customerAuthOk: h.auth }));
import { POST } from "@/app/api/bubui/customer/[id]/challenge-contact/route";

const request = (offerId = "welcome-new") => POST(new Request("https://example.test/contact", {
  method: "POST", body: JSON.stringify({ offerId, channel: "whatsapp" })
}), { params: { id: "friend" } });

beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue(true);
  h.prisma.bubuiCustomer.findUnique.mockResolvedValue({ name: "Amiga ficticia", phone: "+34600000000", phoneVerified: true });
  h.prisma.bubuiOffer.findFirst.mockResolvedValue({ triggerBusinessId: "ref:welcome:challenge-new", businessId: "biz" });
  h.prisma.bubuiChallengeParticipant.findFirst.mockResolvedValue({ status: "registered" });
  h.prisma.bubuiChallengeParticipant.updateMany.mockResolvedValue({ count: 1 });
});

describe("accepting the exact friend challenge", () => {
  it("records interest against the coupon's challenge and returns verified contact details", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, contact: { name: "Amiga ficticia", phone: "+34600000000" } });
    expect(h.prisma.bubuiOffer.findFirst.mock.calls[0][0].where).toMatchObject({ id: "welcome-new", customerId: "friend", redeemed: false });
    expect(h.prisma.bubuiChallengeParticipant.updateMany.mock.calls[0][0].where).toEqual({ friendCustomerId: "friend", offerId: "challenge-new", businessId: "biz", contactedAt: null });
    expect(h.prisma.bubuiChallengeParticipant.updateMany.mock.calls[0][0].data).not.toHaveProperty("status", "confirmed");
  });
  it("allows retry without overwriting first contact", async () => {
    h.prisma.bubuiChallengeParticipant.updateMany.mockResolvedValue({ count: 0 });
    expect((await request()).status).toBe(200);
  });
  it("rejects another customer's coupon or an expired coupon", async () => {
    h.prisma.bubuiOffer.findFirst.mockResolvedValue(null);
    expect((await request("not-owned")).status).toBe(404);
    expect(h.prisma.bubuiChallengeParticipant.updateMany).not.toHaveBeenCalled();
  });
  it("rejects an unverified phone", async () => {
    h.prisma.bubuiCustomer.findUnique.mockResolvedValue({ phone: "+34600000000", phoneVerified: false });
    expect((await request()).status).toBe(400);
  });
  it("rejects an invalid session", async () => {
    h.auth.mockResolvedValue(false);
    expect((await request()).status).toBe(401);
  });
});
