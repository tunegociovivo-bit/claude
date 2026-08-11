/**
 * Persistencia del backfill legado → RecurringInvoiceTemplate (Slice B).
 * Preview (dry-run, NO escribe) · Commit (idempotente, solo `draft`) · Rollback
 * (borra SOLO lo backfilled, reversible). Tenant-scoped SIEMPRE. No toca las
 * facturas legadas ni el motor legado.
 */
import { mapLegacy, type LegacyInvoiceRow, type BackfillReport, type BackfillConflict } from "./backfill";

type PrismaLike = any;

const LEGACY_SELECT = {
  id: true,
  workspaceId: true,
  type: true,
  series: true,
  issuerId: true,
  clientId: true,
  issuerSnapshot: true,
  clientSnapshot: true,
  currency: true,
  paymentMethod: true,
  lines: true,
  subtotalCents: true,
  taxCents: true,
  totalCents: true,
  issueDate: true,
  recurrenceConfig: true
};

async function loadLegacy(prisma: PrismaLike, workspaceId: string): Promise<LegacyInvoiceRow[]> {
  return (await prisma.invoice.findMany({
    where: { workspaceId, recurring: true, deletedAt: null, status: { not: "CANCELLED" } },
    select: LEGACY_SELECT
  })) as LegacyInvoiceRow[];
}

/** DRY-RUN: informe de qué haría el backfill (crear/actualizar/sin-cambios/conflicto). NO escribe. */
export async function previewBackfill(prisma: PrismaLike, workspaceId: string): Promise<BackfillReport> {
  const legacy = await loadLegacy(prisma, workspaceId);
  const existing = (await prisma.recurringInvoiceTemplate.findMany({
    where: { workspaceId, source: "LEGACY_INVOICE" },
    select: { externalId: true, checksum: true }
  })) as { externalId: string; checksum: string | null }[];
  const byExt = new Map(existing.map((e) => [e.externalId, e.checksum]));

  const report: BackfillReport = { total: legacy.length, toCreate: 0, toUpdate: 0, unchanged: 0, conflicts: 0, items: [] };
  for (const row of legacy) {
    const m = mapLegacy(row);
    let action: "create" | "update" | "unchanged" | "conflict";
    if (!m.ok) {
      action = "conflict";
      report.conflicts++;
    } else if (!byExt.has(m.externalId)) {
      action = "create";
      report.toCreate++;
    } else if (byExt.get(m.externalId) === m.data!.checksum) {
      action = "unchanged";
      report.unchanged++;
    } else {
      action = "update";
      report.toUpdate++;
    }
    report.items.push({ legacyInvoiceId: m.legacyInvoiceId, externalId: m.externalId, action, clientName: m.clientName, conflicts: m.conflicts });
  }
  return report;
}

export type BackfillCommitResult = {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  conflictItems: { legacyInvoiceId: string; conflicts: BackfillConflict[] }[];
  errors: { externalId: string; error: string }[];
};

/** COMMIT idempotente: escribe/actualiza plantillas `draft` (source LEGACY_INVOICE). */
export async function commitBackfill(prisma: PrismaLike, workspaceId: string, createdById: string | null): Promise<BackfillCommitResult> {
  const legacy = await loadLegacy(prisma, workspaceId);
  const res: BackfillCommitResult = { created: 0, updated: 0, unchanged: 0, conflicts: 0, conflictItems: [], errors: [] };
  for (const row of legacy) {
    const m = mapLegacy(row);
    if (!m.ok || !m.data) {
      res.conflicts++;
      res.conflictItems.push({ legacyInvoiceId: m.legacyInvoiceId, conflicts: m.conflicts });
      continue;
    }
    try {
      const existing = await prisma.recurringInvoiceTemplate.findFirst({
        where: { workspaceId, source: "LEGACY_INVOICE", externalId: m.externalId },
        select: { id: true, checksum: true, nextIssueAt: true }
      });
      if (existing && existing.checksum === m.data.checksum) {
        // Contenido igual, pero el schedule legado avanza en cada emisión:
        // re-sincroniza nextIssueAt/anchorDate/endDate si cambió, para no llegar
        // al corte (slice E) con una próxima emisión obsoleta.
        const cur = existing.nextIssueAt ? new Date(existing.nextIssueAt).getTime() : null;
        const next = m.data.nextIssueAt ? m.data.nextIssueAt.getTime() : null;
        if (cur !== next) {
          await prisma.recurringInvoiceTemplate.updateMany({
            where: { id: existing.id, workspaceId },
            data: { nextIssueAt: m.data.nextIssueAt, anchorDate: m.data.anchorDate, endDate: m.data.endDate }
          });
        }
        res.unchanged++;
        continue;
      }
      const data = { ...m.data, createdById };
      if (existing) {
        await prisma.recurringInvoiceTemplate.updateMany({ where: { id: existing.id, workspaceId }, data: { ...data, updatedAt: new Date() } });
        res.updated++;
      } else {
        await prisma.recurringInvoiceTemplate.create({ data });
        res.created++;
      }
    } catch (e: any) {
      if (e?.code === "P2002") res.unchanged++; // carrera concurrente → idempotente
      else res.errors.push({ externalId: m.externalId, error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return res;
}

/** ROLLBACK: borra SOLO las plantillas backfilled (source LEGACY_INVOICE) del
 *  workspace. No toca CSV_IMPORT/HUB ni las facturas legadas. Reversible (re-preview). */
export async function rollbackBackfill(prisma: PrismaLike, workspaceId: string): Promise<{ deleted: number }> {
  const r = await prisma.recurringInvoiceTemplate.deleteMany({ where: { workspaceId, source: "LEGACY_INVOICE" } });
  return { deleted: r.count ?? 0 };
}

export type { BackfillConflict };
