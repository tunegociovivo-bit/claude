/**
 * Import de recurrencias de Holded → plantillas PAUSADAS. Dry-run no escribe; import es
 * idempotente y siempre pausado (nunca emite); pausa/activación tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prisma, holdedMock } = vi.hoisted(() => {
  const rows: any[] = [];
  const prismaObj: any = {
    _rows: rows,
    invoice: {
      findMany: vi.fn(async ({ where }: any) => {
        return rows.filter((r) => {
          if (r.workspaceId !== where.workspaceId) return false;
          if (where.holdedRecurringId?.in) return where.holdedRecurringId.in.includes(r.holdedRecurringId);
          if (where.deletedAt === null && r.deletedAt != null) return false;
          if (where.recurring === true && !r.recurring) return false;
          if (where.OR) return where.OR.some((o: any) => (o.holdedRecurringId?.not === null && r.holdedRecurringId != null) || (o.recurring === true && r.recurring));
          return true;
        });
      }),
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.workspaceId === where.workspaceId && r.deletedAt == null) ?? null),
      create: vi.fn(async ({ data }: any) => {
        if (data.holdedRecurringId && rows.some((r) => r.workspaceId === data.workspaceId && r.holdedRecurringId === data.holdedRecurringId)) {
          const e: any = new Error("uniq"); e.code = "P2002"; throw e;
        }
        const row = { id: `inv-${rows.length + 1}`, deletedAt: null, ...data };
        rows.push(row);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const r of rows) {
          if (r.workspaceId !== where.workspaceId) continue;
          if (where.id && r.id !== where.id) continue;
          if (where.recurring === true && !r.recurring) continue;
          if (where.deletedAt === null && r.deletedAt != null) continue;
          Object.assign(r, data);
          n++;
        }
        return { count: n };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      })
    }
  };
  return { prisma: prismaObj, holdedMock: vi.fn() };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/integrations/holded", () => ({ holdedListRecurringInvoices: holdedMock }));

import { previewHoldedRecurring, importHoldedRecurringPaused, setTemplatePaused, pauseAllRecurring, periodicityToMonths, normalizeRecurring, listRecurringTemplates, updateRecurringTemplate } from "../holded-recurring-import";

const NOW = new Date("2026-08-13T00:00:00Z");
const SAMPLE = [
  { id: "h1", contactName: "Acme SL", desc: "Mantenimiento", total: 121, currency: "EUR", periodicity: "monthly" },
  { id: "h2", contact: { id: "c2", name: "Beta SА" }, total: 300, periodicity: "quarterly" },
  { id: "", total: 10 } // inválido: sin id
];

beforeEach(() => {
  vi.clearAllMocks();
  prisma._rows.length = 0;
  holdedMock.mockResolvedValue(SAMPLE);
});

describe("edición de plantillas recurrentes", () => {
  it("expone la periodicidad real en días en lugar del fallback mensual", async () => {
    prisma._rows.push({
      id: "daily-1", workspaceId: "w1", recurring: true, deletedAt: null,
      holdedRecurringId: null, status: "SENT", totalCents: 64972, currency: "USD",
      clientSnapshot: { name: "Calle Ancha Rohrmoser, S.A.", billingEmail: "billing@example.com" },
      recurrenceConfig: { intervalMonths: 1, intervalUnit: "DAYS", intervalValue: 1, nextRunAt: "2026-08-31T00:00:00.000Z" }
    });

    const [template] = await listRecurringTemplates("w1");
    expect(template).toMatchObject({ intervalUnit: "DAYS", intervalValue: 1, recipientEmail: "billing@example.com", sendAutomatically: true });
  });

  it("actualiza frecuencia, correo e importe dentro del workspace", async () => {
    prisma._rows.push({
      id: "daily-1", workspaceId: "w1", recurring: true, deletedAt: null,
      status: "SENT", totalCents: 64972, subtotalCents: 64972, currency: "USD",
      clientSnapshot: { name: "Calle Ancha Rohrmoser, S.A.", email: "old@example.com" },
      lines: [{ description: "Servicio", quantity: 1, unitPriceCents: 64972, taxRate: 0 }],
      recurrenceConfig: { intervalUnit: "DAYS", intervalValue: 1, nextRunAt: "2026-08-31T00:00:00.000Z" }
    });

    expect((await updateRecurringTemplate("w1", "daily-1", {
      intervalUnit: "DAYS", intervalValue: 3, recipientEmail: "new@example.com",
      totalCents: 70000, currency: "USD", nextRunAt: "2026-09-02T00:00:00.000Z", sendAutomatically: true
    })).ok).toBe(true);
    expect(prisma._rows[0]).toMatchObject({
      totalCents: 70000,
      clientSnapshot: { name: "Calle Ancha Rohrmoser, S.A.", email: "old@example.com", billingEmail: "new@example.com" },
      recurrenceConfig: { intervalUnit: "DAYS", intervalValue: 3, nextRunAt: "2026-09-02T00:00:00.000Z" }
    });
  });

  it("normaliza plantillas antiguas con varias líneas a una línea contablemente coherente", async () => {
    prisma._rows.push({
      id: "multi-1", workspaceId: "w1", recurring: true, deletedAt: null, status: "SENT",
      totalCents: 24200, subtotalCents: 20000, taxCents: 4200, currency: "EUR",
      clientSnapshot: { name: "Cliente" },
      lines: [
        { description: "Servicio A", quantity: 1, unitPriceCents: 10000, taxRate: 21 },
        { description: "Servicio B", quantity: 1, unitPriceCents: 10000, taxRate: 21 }
      ],
      recurrenceConfig: { intervalUnit: "MONTHS", intervalValue: 1, nextRunAt: "2026-09-01T00:00:00.000Z" }
    });

    await updateRecurringTemplate("w1", "multi-1", {
      intervalUnit: "MONTHS", intervalValue: 1, recipientEmail: "billing@example.com",
      totalCents: 30000, currency: "EUR", nextRunAt: "2026-09-01T00:00:00.000Z",
      sendAutomatically: true, description: "Servicio mensual"
    }, new Date("2026-08-30T00:00:00.000Z"));

    expect(prisma._rows[0].lines).toEqual([{ description: "Servicio mensual", quantity: 1, unitPriceCents: 30000, taxRate: 0, discountPct: 0 }]);
    expect(prisma._rows[0]).toMatchObject({ subtotalCents: 30000, taxCents: 0, totalCents: 30000 });
  });

  it("rechaza una próxima emisión anterior a hoy", async () => {
    prisma._rows.push({
      id: "safe-1", workspaceId: "w1", recurring: true, deletedAt: null, status: "SENT",
      totalCents: 10000, currency: "EUR", clientSnapshot: { name: "Cliente" }, lines: [], recurrenceConfig: {}
    });
    const result = await updateRecurringTemplate("w1", "safe-1", {
      intervalUnit: "DAYS", intervalValue: 1, recipientEmail: "billing@example.com",
      totalCents: 10000, currency: "EUR", nextRunAt: "2026-08-29T00:00:00.000Z", sendAutomatically: true
    }, new Date("2026-08-30T12:00:00.000Z"));
    expect(result).toEqual({ ok: false, error: "past_next_run" });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });
});

describe("normalización de periodicidad", () => {
  it("mapea variantes a meses; default mensual", () => {
    expect(periodicityToMonths({ id: "x", periodicity: "yearly" } as any)).toBe(12);
    expect(periodicityToMonths({ id: "x", periodicity: "quarterly" } as any)).toBe(3);
    expect(periodicityToMonths({ id: "x", every: 6 } as any)).toBe(6);
    expect(periodicityToMonths({ id: "x" } as any)).toBe(1);
  });
  it("descarta recurrencias sin id (sin idempotencia posible)", () => {
    expect(normalizeRecurring({ id: "", total: 1 } as any)).toBeNull();
  });
});

describe("previewHoldedRecurring — DRY-RUN, no escribe", () => {
  it("cuenta lo importable e ignora inválidas; no crea filas", async () => {
    const p = await previewHoldedRecurring("w1");
    expect(p.fetched).toBe(3);
    expect(p.toImport).toBe(2); // h1, h2
    expect(p.alreadyImported).toBe(0);
    expect(p.invalid).toBe(1);
    expect(prisma.invoice.create).not.toHaveBeenCalled(); // SOLO lectura
  });
  it("marca las ya importadas", async () => {
    prisma._rows.push({ id: "inv-x", workspaceId: "w1", holdedRecurringId: "h1", recurring: false, deletedAt: null });
    const p = await previewHoldedRecurring("w1");
    expect(p.alreadyImported).toBe(1);
    expect(p.toImport).toBe(1); // solo h2
  });
});

describe("importHoldedRecurringPaused — idempotente y SIEMPRE pausado", () => {
  it("crea plantillas recurring:false con holdedRecurringId y nextRunAt futuro", async () => {
    const r = await importHoldedRecurringPaused("w1", NOW);
    expect(r).toMatchObject({ imported: 2, skipped: 0, total: 2 });
    for (const row of prisma._rows) {
      expect(row.recurring).toBe(false); // PAUSADA → no emite
      expect(row.holdedRecurringId).toBeTruthy();
      expect(new Date(row.recurrenceConfig.nextRunAt).getTime()).toBeGreaterThan(NOW.getTime()); // nunca en el pasado
      expect(row.recurrenceConfig.source).toBe("holded");
    }
  });
  it("reimportar NO duplica (P2002 → skipped)", async () => {
    await importHoldedRecurringPaused("w1", NOW);
    const r2 = await importHoldedRecurringPaused("w1", NOW);
    expect(r2.imported).toBe(0);
    expect(r2.skipped).toBe(2);
    expect(prisma._rows.filter((x: any) => x.workspaceId === "w1").length).toBe(2); // sin duplicados
  });
});

describe("pausa/activación tenant-scoped", () => {
  beforeEach(async () => {
    await importHoldedRecurringPaused("w1", NOW);
  });
  it("activar una plantilla → recurring:true; pausar → false", async () => {
    const id = prisma._rows[0].id;
    expect((await setTemplatePaused("w1", id, false)).ok).toBe(true);
    expect(prisma._rows[0].recurring).toBe(true);
    expect((await setTemplatePaused("w1", id, true)).ok).toBe(true);
    expect(prisma._rows[0].recurring).toBe(false);
  });
  it("no toca plantillas de otro tenant", async () => {
    const id = prisma._rows[0].id;
    expect((await setTemplatePaused("otro", id, false)).ok).toBe(false);
    expect(prisma._rows[0].recurring).toBe(false);
  });
  it("pausa global desactiva TODAS las activas del workspace", async () => {
    await setTemplatePaused("w1", prisma._rows[0].id, false);
    await setTemplatePaused("w1", prisma._rows[1].id, false);
    const r = await pauseAllRecurring("w1");
    expect(r.paused).toBe(2);
    expect(prisma._rows.every((x: any) => x.recurring === false)).toBe(true);
  });
});
