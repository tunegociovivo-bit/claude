/**
 * Tests de la atribución de referidos (auditoría PR #284).
 * Prisma y colaboradores mockeados: se prueba la LÓGICA de applyReferral
 * (resultados verificables, idempotencia, reparación) y el fallback IP.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prisma, creditReferrerWallet } = vi.hoisted(() => ({
  prisma: {
    bubuiCustomer: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    bubuiCustomDeal: { findFirst: vi.fn() },
    bubuiBusiness: { findUnique: vi.fn() },
    bubuiOffer: { create: vi.fn(), findFirst: vi.fn() },
    bubuiBusinessNotification: { create: vi.fn() },
    bubuiReferralClick: { findFirst: vi.fn() }
  },
  creditReferrerWallet: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/integrations/email", () => ({ isEmailEnabled: () => false, sendEmail: vi.fn() }));
vi.mock("../wallet", () => ({ creditReferrerWallet }));
vi.mock("../share-offer", () => ({ unlockShareChallengeOffers: vi.fn(), sharesLeft: vi.fn() }));

import { applyReferral } from "../referral";
import { findRecentReferralClick, hashIpFromHeaders } from "../referral-click";

const REFERRER = { id: "ref-1", firstBusinessId: "biz-1" };
const BUSINESS = {
  id: "biz-1", referralEnabled: true, name: "Roman Trainer", ownerEmail: null,
  shareFriendDiscountPct: 15, newCustomerDiscountPct: 10, defaultDiscountPct: 5,
  referralReward1: null, referralReward3: null, referralReward5: null
};

function arm(opts: { friendReferredById?: string | null; offerCreate?: "ok" | "p2002" | "boom"; origin?: boolean }) {
  prisma.bubuiCustomer.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.referralCode) return where.referralCode === "GOOD01" ? { ...REFERRER, firstBusinessId: opts.origin === false ? null : "biz-1" } : null;
    if (where.id === "friend-1") return { referredById: opts.friendReferredById ?? null, name: "Ana", phone: "600" };
    return null;
  });
  prisma.bubuiCustomer.updateMany.mockResolvedValue({ count: 1 });
  prisma.bubuiCustomer.count.mockResolvedValue(1);
  prisma.bubuiCustomDeal.findFirst.mockResolvedValue(null);
  prisma.bubuiBusiness.findUnique.mockResolvedValue(BUSINESS);
  prisma.bubuiBusinessNotification.create.mockResolvedValue({});
  prisma.bubuiOffer.create.mockImplementation(async ({ data }: any) => {
    if (data.triggerBusinessId !== "ref:welcome") return {}; // hitos: siempre ok
    if (opts.offerCreate === "p2002") throw Object.assign(new Error("dup"), { code: "P2002" });
    if (opts.offerCreate === "boom") throw new Error("db down");
    return {};
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe("applyReferral — resultados verificables", () => {
  it("código inválido → no-op TERMINAL (la app puede descartar el pendiente)", async () => {
    arm({});
    const r = await applyReferral("friend-1", "NOPE99");
    expect(r).toMatchObject({ linked: false, terminal: true, reason: "invalid_code" });
  });

  it("autorreferencia → no-op TERMINAL", async () => {
    arm({});
    const r = await applyReferral("ref-1", "GOOD01");
    expect(r).toMatchObject({ linked: false, terminal: true, reason: "self_referral" });
  });

  it("ya referido por OTRO → no-op TERMINAL", async () => {
    arm({ friendReferredById: "otro" });
    const r = await applyReferral("friend-1", "GOOD01");
    expect(r).toMatchObject({ linked: false, terminal: true, reason: "already_referred_other" });
  });

  it("camino feliz → linked terminal con cupón, hucha una vez, vínculo con guard atómico", async () => {
    arm({ offerCreate: "ok" });
    const r = await applyReferral("friend-1", "GOOD01");
    expect(r).toMatchObject({ linked: true, terminal: true, reason: "linked", welcomeOfferCreated: true, referrerId: "ref-1" });
    expect(prisma.bubuiCustomer.updateMany).toHaveBeenCalledWith({
      where: { id: "friend-1", referredById: null }, data: { referredById: "ref-1" }
    });
    expect(creditReferrerWallet).toHaveBeenCalledTimes(1);
  });

  it("usuario YA vinculado a este referidor pero SIN cupón → repara el cupón (no sale por referredById) y no duplica hucha", async () => {
    arm({ friendReferredById: "ref-1", offerCreate: "ok" });
    const r = await applyReferral("friend-1", "GOOD01");
    expect(r).toMatchObject({ linked: true, terminal: true, reason: "repaired", welcomeOfferCreated: true });
    expect(creditReferrerWallet).not.toHaveBeenCalled();
  });

  it("cupón ya existente (P2002) → terminal, welcomeOfferCreated=true (idempotente)", async () => {
    arm({ friendReferredById: "ref-1", offerCreate: "p2002" });
    const r = await applyReferral("friend-1", "GOOD01");
    expect(r).toMatchObject({ linked: true, terminal: true, welcomeOfferCreated: true });
  });

  it("fallo real al crear el cupón → linked NO terminal (la app conserva el pendiente y reintenta)", async () => {
    arm({ offerCreate: "boom" });
    const r = await applyReferral("friend-1", "GOOD01");
    expect(r).toMatchObject({ linked: true, terminal: false, reason: "welcome_offer_failed", welcomeOfferCreated: false });
  });

  it("sin negocio de origen aún → linked NO terminal (reintento podrá crear el cupón)", async () => {
    arm({ origin: false });
    const r = await applyReferral("friend-1", "GOOD01");
    expect(r).toMatchObject({ linked: true, terminal: false, reason: "no_origin_yet" });
  });
});

describe("atribución web (WhatsApp→Play perdido) — fallback por IP", () => {
  it("hashIpFromHeaders usa la primera IP de x-forwarded-for y es estable", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    const a = hashIpFromHeaders(h);
    expect(a).toBe(hashIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4" })));
    expect(hashIpFromHeaders(new Headers())).toBeNull();
  });

  it("clic reciente desde la misma IP → devuelve el código; sin clic → null", async () => {
    prisma.bubuiReferralClick.findFirst.mockResolvedValueOnce({ code: "GOOD01", offerId: "offer-12345678" });
    const h = new Headers({ "x-forwarded-for": "1.2.3.4" });
    expect(await findRecentReferralClick(h)).toEqual({ code: "GOOD01", offerId: "offer-12345678" });
    prisma.bubuiReferralClick.findFirst.mockResolvedValueOnce(null);
    expect(await findRecentReferralClick(h)).toBeNull();
  });
});
