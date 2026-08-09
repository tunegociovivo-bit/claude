/**
 * Tests del preview del RETO en WhatsApp (metadata server-rendered) y del helper
 * de datos públicos. Reproduce la causa raíz reportada el 9-ago: la página del
 * reto NO exponía metadata específica y WhatsApp solo veía el título genérico.
 * Prisma mockeado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: { bubuiCustomDeal: { findUnique: vi.fn() }, bubuiDealTrace: { create: vi.fn(), findMany: vi.fn() } }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { getCustomDealPublic, customDealShareCopy } from "../custom-deal";
import { recordDealTrace } from "../deal-trace";
import { bubuiUrl } from "../url";

const REAL_TOKEN = "60df921bb7bdeb5d";
const DEAL_ROW = {
  token: REAL_TOKEN,
  title: "Entrenamiento personal",
  clientDiscountPct: 30,
  friendsRequired: 5,
  friendDiscountPct: 15,
  friendTitle: null,
  message: null,
  expiresAt: new Date(Date.now() + 86_400_000),
  claimedByCustomerId: null,
  business: { name: "Roman Trainer", city: "Málaga", logoUrl: null }
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BUBUI_URL = "https://bubui.app";
});

describe("customDealShareCopy — texto del preview de WhatsApp", () => {
  it("es ESPECÍFICO del reto (negocio, %, amigos) y no el genérico de Bubui", () => {
    const deal = {
      token: REAL_TOKEN, businessName: "Roman Trainer", city: "Málaga", logoUrl: null,
      title: "Entrenamiento personal", clientDiscountPct: 30, friendsRequired: 5,
      friendDiscountPct: 15, friendTitle: null, message: null, expired: false, claimed: false
    };
    const { title, description } = customDealShareCopy(deal);
    expect(title).toContain("Roman Trainer");
    expect(title).toContain("30%");
    expect(description).toContain("5");
    expect(description).toContain("Roman Trainer");
    expect(description).toContain("15%");
    // No debe ser el título genérico que se veía antes.
    expect(title).not.toBe("Bubui — Descuentos cruzados entre negocios cerca de ti");
  });

  it("cae a un texto genérico coherente si el token no existe", () => {
    const { title, description } = customDealShareCopy(null);
    expect(title.toLowerCase()).toContain("reto");
    expect(description.length).toBeGreaterThan(0);
  });
});

describe("metadata /reto/[token] — contenido y URLs absolutas (verificable sin JS)", () => {
  // La página construye la metadata con getCustomDealPublic + customDealShareCopy
  // y URLs absolutas con bubuiUrl. Aquí verificamos esa cadena de extremo a
  // extremo (la que consume el crawler de WhatsApp), sin renderizar el TSX.
  it("compone OG específico del reto con imagen y canónica absolutas", async () => {
    prisma.bubuiCustomDeal.findUnique.mockResolvedValue(DEAL_ROW as any);
    const deal = await getCustomDealPublic(REAL_TOKEN);
    const { title, description } = customDealShareCopy(deal);
    const canonical = bubuiUrl(`/reto/${REAL_TOKEN}`);
    const image = bubuiUrl(`/reto/${REAL_TOKEN}/opengraph-image`);
    expect(title).toContain("Roman Trainer");
    expect(description).toContain("30%");
    expect(canonical).toBe(`https://bubui.app/reto/${REAL_TOKEN}`);
    expect(image).toBe(`https://bubui.app/reto/${REAL_TOKEN}/opengraph-image`);
    expect(image.startsWith("https://")).toBe(true); // absoluta (WhatsApp la exige)
  });

  it("token inexistente → copy genérico (metadata no rompe)", async () => {
    prisma.bubuiCustomDeal.findUnique.mockResolvedValue(null);
    const deal = await getCustomDealPublic("deadbeef");
    const { title } = customDealShareCopy(deal);
    expect(deal).toBeNull();
    expect(title).toBeTruthy();
  });
});

describe("getCustomDealPublic", () => {
  it("marca expired cuando expiresAt es pasado", async () => {
    prisma.bubuiCustomDeal.findUnique.mockResolvedValue({ ...DEAL_ROW, expiresAt: new Date(Date.now() - 1000) } as any);
    const d = await getCustomDealPublic(REAL_TOKEN);
    expect(d?.expired).toBe(true);
  });
  it("devuelve null si el token no existe", async () => {
    prisma.bubuiCustomDeal.findUnique.mockResolvedValue(null);
    expect(await getCustomDealPublic("x")).toBeNull();
  });
});

describe("recordDealTrace — seguridad (sin PII, token válido)", () => {
  it("ignora tokens con formato inválido (no inserta basura)", async () => {
    await recordDealTrace({ token: "no-es-token!!", stage: "web_page_view" });
    expect(prisma.bubuiDealTrace.create).not.toHaveBeenCalled();
  });
  it("inserta etapa saneada para un token válido", async () => {
    prisma.bubuiDealTrace.create.mockResolvedValue({} as any);
    await recordDealTrace({ token: REAL_TOKEN, stage: "app_claim_ok", platform: "android", appBuild: "30", source: "client" });
    expect(prisma.bubuiDealTrace.create).toHaveBeenCalledTimes(1);
    const arg = prisma.bubuiDealTrace.create.mock.calls[0][0].data;
    expect(arg.token).toBe(REAL_TOKEN);
    expect(arg.stage).toBe("app_claim_ok");
    expect(arg.platform).toBe("android");
  });
});
