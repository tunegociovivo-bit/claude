/**
 * Importación de RECURRENCIAS de Holded → plantillas locales (Invoice.recurring).
 *
 * SEGURIDAD (no emitir facturas reales durante la validación):
 *  - El preview (dry-run) es SOLO LECTURA: no escribe nada.
 *  - El import crea las plantillas SIEMPRE PAUSADAS (`recurring:false`). El emisor
 *    (`runRecurringInvoices`) solo procesa `recurring:true`, así que una plantilla importada
 *    NO genera ninguna factura hasta que se ACTIVA explícitamente (activación gradual).
 *  - IDEMPOTENTE por `holdedRecurringId` (@@unique([workspaceId, holdedRecurringId])):
 *    reimportar no duplica.
 *  - `nextRunAt` se fija al SIGUIENTE ciclo desde ahora (no al pasado) → activar una plantilla
 *    nunca dispara un backfill de emisiones atrasadas.
 * Tenant-scoped SIEMPRE (workspaceId en toda consulta).
 */
import { prisma } from "@/lib/db/prisma";
import { holdedListRecurringInvoices, type HoldedRecurring } from "@/lib/integrations/holded";

export type NormalizedRecurring = {
  holdedId: string;
  description: string;
  contactName: string;
  contactId: string | null;
  totalCents: number;
  currency: "EUR" | "USD";
  intervalMonths: number;
};

/** Periodicidad de Holded (variantes) → meses de intervalo. Defensivo: por defecto mensual. */
export function periodicityToMonths(raw: HoldedRecurring): number {
  const p = String(raw.periodicity ?? raw.period ?? "").toLowerCase().trim();
  const every = Number(raw.every);
  if (/(year|anual|annual|yearly)/.test(p)) return 12;
  if (/(quarter|trimest)/.test(p)) return 3;
  if (/(semest|biannual|half)/.test(p)) return 6;
  if (/(month|mensual|monthly)/.test(p)) return 1;
  // numérico: si Holded manda "every N months"
  if (Number.isFinite(every) && every >= 1 && every <= 24) return Math.floor(every);
  const pn = Number(raw.periodicity ?? raw.period);
  if (Number.isFinite(pn) && pn >= 1 && pn <= 24) return Math.floor(pn);
  return 1;
}

function contactNameOf(raw: HoldedRecurring): string {
  if (raw.contactName) return String(raw.contactName).trim();
  const c: any = raw.contact;
  if (c && typeof c === "object") return String(c.name ?? c.contactName ?? "").trim();
  return "";
}
function contactIdOf(raw: HoldedRecurring): string | null {
  const c: any = raw.contact;
  const id = raw.contactId ?? (typeof c === "string" ? c : c?.id) ?? null;
  return id ? String(id).trim() : null;
}

export function normalizeRecurring(raw: HoldedRecurring): NormalizedRecurring | null {
  const holdedId = String(raw.id ?? "").trim();
  if (!holdedId) return null; // sin id no hay idempotencia posible → se descarta
  const totalCents = typeof raw.total === "number" && Number.isFinite(raw.total) ? Math.round(raw.total * 100) : 0;
  const currency = String(raw.currency ?? "EUR").toUpperCase().includes("USD") ? "USD" : "EUR";
  return {
    holdedId,
    description: String(raw.desc ?? "").trim(),
    contactName: contactNameOf(raw),
    contactId: contactIdOf(raw),
    totalCents,
    currency,
    intervalMonths: periodicityToMonths(raw)
  };
}

/** Fecha del SIGUIENTE ciclo desde ahora (nunca en el pasado). */
function nextRunFrom(now: Date, intervalMonths: number): Date {
  const d = new Date(now);
  const day = d.getDate();
  d.setMonth(d.getMonth() + Math.max(1, intervalMonths));
  if (d.getDate() < day) d.setDate(0);
  return d;
}

export type RecurringPreview = {
  fetched: number;
  toImport: number;
  alreadyImported: number;
  invalid: number;
  samples: Array<{ holdedId: string; contactName: string; totalCents: number; currency: string; intervalMonths: number; alreadyImported: boolean }>;
};

/** DRY-RUN: consulta Holded y calcula qué se importaría. NO escribe nada. */
export async function previewHoldedRecurring(workspaceId: string, limit = 1000): Promise<RecurringPreview> {
  const raw = await holdedListRecurringInvoices({ workspaceId, limit });
  const normalized = raw.map(normalizeRecurring);
  const valid = normalized.filter((n): n is NormalizedRecurring => n != null);
  const invalid = normalized.length - valid.length;

  const existing = await prisma.invoice.findMany({
    where: { workspaceId, holdedRecurringId: { in: valid.map((v) => v.holdedId) } },
    select: { holdedRecurringId: true }
  });
  const known = new Set(existing.map((e: any) => e.holdedRecurringId));

  const samples = valid.slice(0, 50).map((v) => ({
    holdedId: v.holdedId,
    contactName: v.contactName,
    totalCents: v.totalCents,
    currency: v.currency,
    intervalMonths: v.intervalMonths,
    alreadyImported: known.has(v.holdedId)
  }));
  return {
    fetched: raw.length,
    toImport: valid.filter((v) => !known.has(v.holdedId)).length,
    alreadyImported: valid.filter((v) => known.has(v.holdedId)).length,
    invalid,
    samples
  };
}

export type RecurringImportResult = { imported: number; skipped: number; total: number };

/** IMPORT idempotente: crea plantillas PAUSADAS (recurring:false). No emite nada. */
export async function importHoldedRecurringPaused(workspaceId: string, now = new Date(), limit = 1000): Promise<RecurringImportResult> {
  const raw = await holdedListRecurringInvoices({ workspaceId, limit });
  const valid = raw.map(normalizeRecurring).filter((n): n is NormalizedRecurring => n != null);
  let imported = 0;
  let skipped = 0;
  for (const v of valid) {
    const nextRunAt = nextRunFrom(now, v.intervalMonths);
    try {
      await prisma.invoice.create({
        data: {
          workspaceId,
          type: "NORMAL",
          status: "DRAFT",
          recurring: false, // PAUSADA por defecto → nunca emite hasta activarse
          holdedRecurringId: v.holdedId, // idempotencia
          currency: v.currency,
          clientSnapshot: v.contactName ? { name: v.contactName, holdedContactId: v.contactId } : undefined,
          lines: [{ description: v.description || `Recurrencia Holded ${v.holdedId}`, quantity: 1, unitPriceCents: v.totalCents, taxRate: 0, discountPct: 0 }],
          subtotalCents: v.totalCents,
          totalCents: v.totalCents,
          recurrenceConfig: {
            source: "holded",
            holdedId: v.holdedId,
            intervalMonths: v.intervalMonths,
            nextRunAt: nextRunAt.toISOString(),
            importedAt: now.toISOString(),
            paused: true
          }
        }
      });
      imported++;
    } catch (e: any) {
      if (e?.code === "P2002") { skipped++; continue; } // ya importada (idempotente)
      throw e;
    }
  }
  return { imported, skipped, total: valid.length };
}

export type RecurringTemplate = {
  id: string;
  holdedRecurringId: string | null;
  status: "active" | "paused";
  contactName: string | null;
  totalCents: number;
  currency: string;
  intervalMonths: number | null;
  intervalUnit: "DAYS" | "MONTHS" | "YEARS";
  intervalValue: number;
  nextRunAt: string | null;
  importedAt: string | null;
  recipientEmail: string | null;
  description: string | null;
  sendAutomatically: boolean;
};

/** Lista las plantillas recurrentes del workspace (importadas de Holded o no). */
export async function listRecurringTemplates(workspaceId: string): Promise<RecurringTemplate[]> {
  const rows = await prisma.invoice.findMany({
    where: { workspaceId, deletedAt: null, OR: [{ holdedRecurringId: { not: null } }, { recurring: true }] },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { id: true, holdedRecurringId: true, recurring: true, status: true, clientSnapshot: true, lines: true, totalCents: true, currency: true, recurrenceConfig: true }
  });
  return rows.map((r: any) => {
    const cfg = (r.recurrenceConfig as any) ?? {};
    return {
      id: r.id,
      holdedRecurringId: r.holdedRecurringId ?? null,
      status: r.recurring ? "active" : "paused",
      contactName: (r.clientSnapshot as any)?.name ?? null,
      totalCents: r.totalCents ?? 0,
      currency: r.currency ?? "EUR",
      intervalMonths: cfg.intervalMonths ?? null,
      intervalUnit: cfg.intervalUnit ?? "MONTHS",
      intervalValue: Math.max(1, Number(cfg.intervalValue ?? cfg.intervalMonths) || 1),
      nextRunAt: cfg.nextRunAt ?? null,
      importedAt: cfg.importedAt ?? null,
      recipientEmail: (r.clientSnapshot as any)?.billingEmail ?? (r.clientSnapshot as any)?.email ?? null,
      description: Array.isArray(r.lines) ? (r.lines[0] as any)?.description ?? null : null,
      sendAutomatically: r.status === "SENT"
    };
  });
}

export type RecurringTemplateUpdate = {
  intervalUnit: "DAYS" | "MONTHS" | "YEARS";
  intervalValue: number;
  recipientEmail: string;
  totalCents: number;
  currency: "EUR" | "USD";
  nextRunAt: string;
  sendAutomatically: boolean;
  contactName?: string;
  description?: string;
};

export async function updateRecurringTemplate(workspaceId: string, id: string, input: RecurringTemplateUpdate): Promise<{ ok: boolean }> {
  const current = await prisma.invoice.findFirst({
    where: { id, workspaceId, deletedAt: null }
  });
  if (!current) return { ok: false };
  const cfg = (current.recurrenceConfig as any) ?? {};
  const client = (current.clientSnapshot as any) ?? {};
  const lines = Array.isArray(current.lines) ? [...(current.lines as any[])] : [];
  const first = lines[0] ?? { quantity: 1, taxRate: 0, discountPct: 0 };
  lines[0] = {
    ...first,
    description: input.description?.trim() || first.description || "Servicio recurrente",
    quantity: 1,
    unitPriceCents: input.totalCents,
    taxRate: 0
  };
  const intervalMonths = input.intervalUnit === "YEARS"
    ? input.intervalValue * 12
    : input.intervalUnit === "MONTHS" ? input.intervalValue : 1;
  await prisma.invoice.update({
    where: { id },
    data: {
      status: input.sendAutomatically ? "SENT" : "ISSUED",
      currency: input.currency,
      totalCents: input.totalCents,
      subtotalCents: input.totalCents,
      taxCents: 0,
      lines,
      clientSnapshot: {
        ...client,
        ...(input.contactName?.trim() ? { name: input.contactName.trim() } : {}),
        billingEmail: input.recipientEmail.trim()
      },
      recurrenceConfig: {
        ...cfg,
        intervalMonths,
        intervalUnit: input.intervalUnit,
        intervalValue: input.intervalValue,
        nextRunAt: new Date(input.nextRunAt).toISOString()
      }
    }
  });
  return { ok: true };
}

/** Pausa/activa UNA plantilla (tenant-scoped). Activar = `recurring:true` (activación gradual). */
export async function setTemplatePaused(workspaceId: string, id: string, paused: boolean): Promise<{ ok: boolean }> {
  const res = await prisma.invoice.updateMany({
    where: { id, workspaceId, deletedAt: null },
    data: { recurring: !paused }
  });
  return { ok: res.count === 1 };
}

/** PAUSA GLOBAL segura: desactiva TODAS las plantillas recurrentes del workspace. */
export async function pauseAllRecurring(workspaceId: string): Promise<{ paused: number }> {
  const res = await prisma.invoice.updateMany({
    where: { workspaceId, recurring: true, deletedAt: null },
    data: { recurring: false }
  });
  return { paused: res.count };
}
