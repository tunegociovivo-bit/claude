/**
 * Contrato FASE 3 — Cliente 360 agregado: tenant, redacción por rol, datos
 * parciales/nulos, not-found. Prisma mockeado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getClientOverview } from "../overview";

function makePrisma() {
  return {
    client: { findFirst: vi.fn() },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    task: { count: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    invoice: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    editorialPost: { findFirst: vi.fn().mockResolvedValue(null) },
    calendarEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    deliverable: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    comment: { findFirst: vi.fn().mockResolvedValue(null) },
    aiOwnership: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([]) }
  };
}

const CLIENT = {
  id: "c1",
  name: "Bar Pepe",
  status: "ACTIVE",
  prioridad: "NORMAL",
  mrr: 300,
  since: new Date("2025-01-01"),
  servicios: ["seo_web"],
  kitDigital: true,
  website: "https://x",
  contactName: "Ana",
  email: "a@x",
  phone: "600",
  notes: "interno",
  legalName: "Bar Pepe SL",
  taxId: "B123",
  accesos: "SECRETO-cpanel-pass",
  sepaEnabled: true,
  stripeCustomerId: "cus_1"
};

let prisma: ReturnType<typeof makePrisma>;
beforeEach(() => {
  prisma = makePrisma();
  prisma.client.findFirst.mockResolvedValue(CLIENT);
  prisma.task.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1).mockResolvedValueOnce(9); // open, overdue, done
});

const now = new Date("2026-08-11T00:00:00Z");

describe("getClientOverview — tenant", () => {
  it("toda subconsulta lleva workspaceId (aislamiento tenant)", async () => {
    await getClientOverview(prisma, { workspaceId: "w1", clientId: "c1", isAdmin: true, now });
    expect(prisma.client.findFirst.mock.calls[0][0].where).toMatchObject({ id: "c1", workspaceId: "w1", deletedAt: null });
    expect(prisma.project.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    expect(prisma.invoice.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    expect(prisma.comment.findFirst.mock.calls[0][0].where).toMatchObject({ workspaceId: "w1", targetType: "CLIENT", targetId: "c1" });
  });

  it("cliente inexistente → null (404 en la ruta)", async () => {
    prisma.client.findFirst.mockResolvedValue(null);
    const r = await getClientOverview(prisma, { workspaceId: "w1", clientId: "nope", isAdmin: true, now });
    expect(r).toBeNull();
  });
});

describe("getClientOverview — redacción por rol", () => {
  it("ADMIN ve importes y fiscal; NUNCA expone accesos", async () => {
    const r = (await getClientOverview(prisma, { workspaceId: "w1", clientId: "c1", isAdmin: true, now }))!;
    expect(r.billing.visible).toBe(true);
    expect(r.billing.profitability?.recurring.mrrEuros).toBe(300);
    expect(r.essentials.taxId).toBe("B123");
    // accesos jamás aparece
    expect(JSON.stringify(r)).not.toContain("SECRETO-cpanel-pass");
    expect((r.essentials as any).accesos).toBeUndefined();
  });

  it("NO-admin: sin importes ni fiscal, salud SÍ visible (sin €)", async () => {
    const r = (await getClientOverview(prisma, { workspaceId: "w1", clientId: "c1", isAdmin: false, now }))!;
    expect(r.billing.visible).toBe(false);
    expect(r.billing.profitability).toBeUndefined();
    expect(r.essentials.taxId).toBeUndefined();
    expect((r.essentials as any).stripeCustomerId).toBeUndefined();
    // la salud se calcula igual y no lleva importes
    expect(r.health.score).toBeTypeOf("number");
    expect(JSON.stringify(r.health)).not.toMatch(/€/);
  });
});

describe("getClientOverview — datos parciales/nulos honestos", () => {
  it("sin facturas ni actividad → daysSinceLastActivity null, salud no penaliza por dato ausente", async () => {
    const r = (await getClientOverview(prisma, { workspaceId: "w1", clientId: "c1", isAdmin: true, now }))!;
    expect(r.activity.lastActivityAt).toBeNull();
    expect(r.activity.daysSinceLastActivity).toBeNull();
    expect(r.health.dataQuality.activityKnown).toBe(false);
    expect(r.billing.profitability?.dataQuality.hasInvoices).toBe(false);
    expect(r.dataQuality.costsTraceable).toBe(false);
  });

  it("deriva overdue de facturas y actividad de la más reciente", async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { status: "ISSUED", totalCents: 5000, paidCents: 0, dueDate: new Date("2026-07-01") }
    ]);
    prisma.invoice.findFirst.mockResolvedValue({ issueDate: new Date("2026-08-01") });
    prisma.task.findFirst.mockResolvedValue({ updatedAt: new Date("2026-08-05") });
    const r = (await getClientOverview(prisma, { workspaceId: "w1", clientId: "c1", isAdmin: true, now }))!;
    expect(r.billing.profitability?.invoiced.overdueCount).toBe(1);
    expect(r.activity.lastActivityAt).toBe(new Date("2026-08-05").toISOString());
    expect(r.health.factors.some((f) => f.key === "overdue_invoices")).toBe(true);
  });
});
