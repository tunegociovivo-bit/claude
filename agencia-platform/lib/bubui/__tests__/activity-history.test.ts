import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const model = () => ({ findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), count: vi.fn(), aggregate: vi.fn() });
  return {
    prisma: {
      bubuiCustomer: model(),
      bubuiActivityEvent: model(),
      bubuiPurchase: model(),
      bubuiTicketScan: model(),
      bubuiOffer: model(),
      bubuiCustomDeal: model(),
      bubuiReferralClick: model(),
      bubuiChallengeParticipant: model(),
      bubuiReview: model(),
      bubuiGoogleReview: model(),
      bubuiSocialFollow: model(),
      bubuiTableSession: model(),
      bubuiTableParticipant: model(),
      bubuiBooking: model(),
      bubuiPushLog: model(),
      bubuiBusiness: model()
    } as Record<string, ReturnType<typeof model>>
  };
});
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import {
  describeActivity,
  loadCustomerActivity,
  logBubuiActivity,
  paginateActivity,
  platformFromUserAgent,
  type ActivityItem
} from "../activity";

const names = (id: string | null) => (id === "b1" ? "Café Sol" : id === "b2" ? "Peluquería Luna" : null);
const at = (s: string) => new Date(s);

function item(id: string, iso: string): ActivityItem {
  return { id, at: iso, kind: "scan", type: "x", title: id, detail: null, businessId: null, businessName: null, amount: null, status: null, tone: "neutral" };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of Object.values(h.prisma)) {
    m.findMany.mockResolvedValue([]);
    m.findUnique.mockResolvedValue(null);
  }
});

describe("describeActivity", () => {
  it("explica un escaneo pendiente con importe, descuento y cupón", () => {
    const r = describeActivity(
      {
        type: "purchase_scanned",
        id: "p1",
        at: at("2026-10-01T10:00:00Z"),
        businessId: "b1",
        amount: 25,
        discountPct: 10,
        discountAmount: 2.5,
        status: "pending",
        rejectionReason: null,
        usedCoupon: true,
        walletPctUsed: 0,
        scanDistanceM: 12.4
      },
      names
    );
    expect(r).toMatchObject({ kind: "scan", title: "Escaneó el QR de Café Sol", status: "Pendiente de confirmar", tone: "pending", amount: 25, businessName: "Café Sol" });
    expect(r.detail).toContain("10% de descuento");
    expect(r.detail).toContain("con cupón");
    expect(r.detail).toContain("a 12 m del local");
  });

  it("muestra el motivo de una compra rechazada", () => {
    const r = describeActivity(
      { type: "purchase_scanned", id: "p2", at: at("2026-10-01T10:00:00Z"), businessId: "b1", amount: 10, discountPct: 5, discountAmount: 0.5, status: "rejected", rejectionReason: "geo_mismatch", usedCoupon: false, walletPctUsed: 0, scanDistanceM: null },
      names
    );
    expect(r).toMatchObject({ status: "Rechazada: geo_mismatch", tone: "bad" });
  });

  it("distingue las ofertas compartidas por tipo y canal", () => {
    const offer = describeActivity({ type: "share", id: "e1", at: at("2026-10-01T10:00:00Z"), shareType: "offer_shared", businessId: "b2", channel: "whatsapp", platform: "android" }, names);
    expect(offer).toMatchObject({ kind: "share", title: "Compartió una oferta de Peluquería Luna", detail: "por WhatsApp · Android" });
    const link = describeActivity({ type: "share", id: "e2", at: at("2026-10-01T10:00:00Z"), shareType: "referral_shared", businessId: null, channel: null, platform: "web" }, names);
    expect(link.title).toBe("Compartió su enlace de invitación");
  });

  it("usa la etiqueta del premio en lugar del % y marca los retos bloqueados", () => {
    const r = describeActivity(
      { type: "offer_unlocked", id: "o1", at: at("2026-10-01T10:00:00Z"), businessId: "b1", discountPct: 30, rewardLabel: "Tapa gratis", source: "share_challenge", unlockShares: 5, active: false, expiresAt: at("2026-10-05T10:00:00Z") },
      names
    );
    expect(r).toMatchObject({ kind: "coupon", title: "Desbloqueó un reto de Tapa gratis en Café Sol", status: "Bloqueado", tone: "pending" });
    expect(r.detail).toContain("Tiene que traer 5 amigos");
  });

  it("no se rompe si el comercio ya no existe", () => {
    const r = describeActivity({ type: "review", id: "r1", at: at("2026-10-01T10:00:00Z"), businessId: "gone", rating: 5, comment: "  Genial  " }, names);
    expect(r).toMatchObject({ title: "Valoró un comercio con 5★", detail: "“Genial”", businessName: null });
  });
});

describe("paginateActivity", () => {
  it("ordena de más reciente a más antiguo y da el cursor de la siguiente página", () => {
    const page = paginateActivity([item("a", "2026-10-01T10:00:00.000Z"), item("b", "2026-10-03T10:00:00.000Z"), item("c", "2026-10-02T10:00:00.000Z")], 2);
    expect(page.items.map((i) => i.id)).toEqual(["b", "c"]);
    expect(page.nextBefore).toBe("2026-10-02T10:00:00.000Z");
  });

  it("no parte eventos con la misma fecha entre dos páginas", () => {
    const t = "2026-10-02T10:00:00.000Z";
    const page = paginateActivity([item("a", "2026-10-03T10:00:00.000Z"), item("b", t), item("c", t), item("d", "2026-10-01T10:00:00.000Z")], 2);
    expect(page.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(page.nextBefore).toBe(t);
  });

  it("sin más eventos no devuelve cursor", () => {
    expect(paginateActivity([item("a", "2026-10-03T10:00:00.000Z")], 5).nextBefore).toBeNull();
  });
});

describe("loadCustomerActivity", () => {
  const customer = { id: "c1", createdAt: at("2026-09-01T09:00:00Z"), referralCode: "ABC123", referredById: null, firstBusinessId: "b1" };

  it("devuelve null si el usuario no existe", async () => {
    expect(await loadCustomerActivity("nope")).toBeNull();
  });

  it("mezcla las fuentes en orden cronológico con nombres de comercio", async () => {
    h.prisma.bubuiCustomer.findUnique.mockResolvedValue(customer);
    h.prisma.bubuiPurchase.findMany.mockImplementation(async (args: any) =>
      args.where.status === "confirmed"
        ? [{ id: "p1", businessId: "b1", amount: 20, discountAmount: 2, confirmedAt: at("2026-10-02T12:00:00Z") }]
        : [{ id: "p1", businessId: "b1", amount: 20, discountPct: 10, discountAmount: 2, status: "confirmed", rejectionReason: null, redeemedOfferId: null, walletPctUsed: 0, scanDistanceM: null, scannedAt: at("2026-10-02T11:50:00Z") }]
    );
    h.prisma.bubuiActivityEvent.findMany.mockResolvedValue([
      { id: "e1", type: "offer_shared", businessId: "b2", channel: "whatsapp", platform: "ios", appBuild: null, createdAt: at("2026-10-03T08:00:00Z") }
    ]);
    h.prisma.bubuiBusiness.findMany.mockResolvedValue([
      { id: "b1", name: "Café Sol" },
      { id: "b2", name: "Peluquería Luna" }
    ]);

    const page = await loadCustomerActivity("c1");
    expect(page!.items.map((i) => i.type)).toEqual(["share", "purchase_confirmed", "purchase_scanned", "signup"]);
    expect(page!.items[0].title).toBe("Compartió una oferta de Peluquería Luna");
    expect(page!.items[3].detail).toBe("Llegó desde Café Sol");
    expect(page!.nextBefore).toBeNull();
  });

  it("solo consulta las fuentes de los tipos filtrados", async () => {
    h.prisma.bubuiCustomer.findUnique.mockResolvedValue(customer);
    await loadCustomerActivity("c1", { kinds: ["share"] });
    expect(h.prisma.bubuiActivityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: { in: expect.not.arrayContaining(["login"]) } }) })
    );
    expect(h.prisma.bubuiReferralClick.findMany).toHaveBeenCalled();
    expect(h.prisma.bubuiPurchase.findMany).not.toHaveBeenCalled();
    expect(h.prisma.bubuiPushLog.findMany).not.toHaveBeenCalled();
  });

  it("pide una fila más del límite a cada fuente para saber si hay más páginas", async () => {
    h.prisma.bubuiCustomer.findUnique.mockResolvedValue(customer);
    const before = at("2026-10-01T00:00:00Z");
    await loadCustomerActivity("c1", { kinds: ["review"], limit: 10, before });
    expect(h.prisma.bubuiReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 11, where: expect.objectContaining({ createdAt: { lt: before } }) })
    );
  });
});

describe("logBubuiActivity", () => {
  it("nunca lanza aunque falle la base de datos", async () => {
    h.prisma.bubuiActivityEvent.create.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(logBubuiActivity({ customerId: "c1", type: "login" })).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("platformFromUserAgent", () => {
  it("reconoce app Android, app iOS y navegador", () => {
    expect(platformFromUserAgent("okhttp/4.12.0")).toBe("android");
    expect(platformFromUserAgent("Bubui/1015 CFNetwork/1490.0.4 Darwin/23.2.0")).toBe("ios");
    expect(platformFromUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36")).toBe("web");
    expect(platformFromUserAgent(null)).toBeNull();
  });
});
