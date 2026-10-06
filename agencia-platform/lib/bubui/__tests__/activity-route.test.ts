import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    bubuiOffer: { findFirst: vi.fn() },
    bubuiBusiness: { findUnique: vi.fn() },
    bubuiActivityEvent: { findFirst: vi.fn(), create: vi.fn() }
  },
  authOk: vi.fn(),
  idFromAuth: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/bubui/customer-auth", () => ({ customerAuthOk: h.authOk, customerIdFromAuth: h.idFromAuth }));

import { POST } from "@/app/api/bubui/activity/route";

const req = (body: unknown) =>
  new Request("https://bubui.app/api/bubui/activity", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.idFromAuth.mockReturnValue("c1");
  h.authOk.mockResolvedValue(true);
  h.prisma.bubuiActivityEvent.findFirst.mockResolvedValue(null);
  h.prisma.bubuiActivityEvent.create.mockResolvedValue({});
});

it("exige el token del propio cliente", async () => {
  h.idFromAuth.mockReturnValue(null);
  const r = await POST(req({ customerId: "c1", type: "referral_shared" }));
  expect(r.status).toBe(401);
  expect(h.prisma.bubuiActivityEvent.create).not.toHaveBeenCalled();
});

it("rechaza tipos de evento que no están permitidos", async () => {
  const r = await POST(req({ customerId: "c1", type: "login" }));
  expect(r.status).toBe(400);
});

it("toma el comercio de la oferta solo si la oferta es del cliente", async () => {
  h.prisma.bubuiOffer.findFirst.mockResolvedValue({ id: "o1", businessId: "b9" });
  const r = await POST(req({ customerId: "c1", type: "offer_shared", offerId: "o1", businessId: "otro", channel: "whatsapp", platform: "android" }));
  expect(r.status).toBe(204);
  expect(h.prisma.bubuiOffer.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "o1", customerId: "c1" } }));
  expect(h.prisma.bubuiActivityEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ customerId: "c1", type: "offer_shared", offerId: "o1", businessId: "b9", channel: "whatsapp", platform: "android" })
  });
});

it("ignora una oferta ajena y un comercio inexistente", async () => {
  h.prisma.bubuiOffer.findFirst.mockResolvedValue(null);
  h.prisma.bubuiBusiness.findUnique.mockResolvedValue(null);
  await POST(req({ customerId: "c1", type: "offer_shared", offerId: "ajena", businessId: "fake" }));
  expect(h.prisma.bubuiActivityEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ offerId: null, businessId: null }) });
});

it("no duplica un doble toque en compartir", async () => {
  h.prisma.bubuiActivityEvent.findFirst.mockResolvedValue({ id: "e1" });
  const r = await POST(req({ customerId: "c1", type: "referral_shared" }));
  expect(r.status).toBe(204);
  expect(h.prisma.bubuiActivityEvent.create).not.toHaveBeenCalled();
});
