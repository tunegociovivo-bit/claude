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
      })
    }
  };
  return { prisma: prismaObj, holdedMock: vi.fn() };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/integrations/holded", () => ({ holdedListRecurringInvoices: holdedMock }));

import { previewHoldedRecurring, importHoldedRecurringPaused, setTemplatePaused, pauseAllRecurring, periodicityToMonths, normalizeRecurring } from "../holded-recurring-import";

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
