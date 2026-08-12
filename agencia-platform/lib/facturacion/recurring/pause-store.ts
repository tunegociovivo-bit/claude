/**
 * Persistencia de la PAUSA MASIVA de plantillas Hub (Slice D). REVERSIBLE (pausar
 * ↔ reanudar restaura el estado previo), idempotente, por lotes con CHECKPOINT
 * (reanudable), auditada por plantilla, con resultado parcial. Tenant SIEMPRE.
 *
 * SOLO Hub (flag `status`). NUNCA toca Holded (la pausa remota es checklist manual).
 * La ejecución exige: frase de confirmación correcta + admin + flag opt-in (rutas).
 */
import { buildPausePlan, phraseMatches, type PauseAction, type PausePlan, inventoryCsv, type InventoryRow } from "./pause-plan";

type PrismaLike = any;

const BATCH = 50;

type StatusRow = { id: string; status: string; statusBeforePause: string | null; clientSnapshot: any };

async function loadStatuses(prisma: PrismaLike, workspaceId: string, ids: string[]): Promise<StatusRow[]> {
  if (ids.length === 0) return [];
  return (await prisma.recurringInvoiceTemplate.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true, status: true, statusBeforePause: true, clientSnapshot: true }
  })) as StatusRow[];
}

function withNames(rows: StatusRow[]) {
  return rows.map((r) => ({ id: r.id, status: r.status, clientName: r.clientSnapshot?.name ?? null }));
}

/** DRY-RUN: plan + frase esperada. NO escribe. */
export async function previewPause(prisma: PrismaLike, workspaceId: string, action: PauseAction, ids: string[]): Promise<PausePlan> {
  const rows = await loadStatuses(prisma, workspaceId, ids);
  return buildPausePlan(action, ids, withNames(rows), workspaceId);
}

export type PauseCommitResult = {
  ok: boolean;
  operationId?: string;
  action: PauseAction;
  status: "completed" | "partial" | "failed";
  total: number;
  processed: number;
  results: { id: string; ok: boolean; from?: string; to?: string; error?: string }[];
  error?: string;
};

/**
 * COMMIT: valida la frase, crea la operación (checkpoint) y procesa por lotes.
 * Cada plantilla se mueve con guard de estado (idempotente/concurrency-safe) y se
 * audita. Devuelve resultado parcial si algo falla a mitad (reanudable).
 */
export async function commitPause(
  prisma: PrismaLike,
  workspaceId: string,
  action: PauseAction,
  ids: string[],
  typedPhrase: string,
  createdById: string | null
): Promise<PauseCommitResult> {
  const rows = await loadStatuses(prisma, workspaceId, ids);
  const plan = buildPausePlan(action, ids, withNames(rows), workspaceId);

  // Confirmación FUERTE (ligada a acción + conteo exacto elegible + workspace).
  if (!phraseMatches(typedPhrase, plan.phrase)) {
    return { ok: false, action, status: "failed", total: plan.count, processed: 0, results: [], error: "phrase_mismatch" };
  }
  if (plan.eligibleIds.length === 0) {
    return { ok: true, action, status: "completed", total: 0, processed: 0, results: [] };
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const op = await prisma.recurringPauseOperation.create({
    data: { workspaceId, action, status: "running", requestedIds: ids, eligibleIds: plan.eligibleIds, processedIds: [], results: [], total: plan.eligibleIds.length, processed: 0, createdById }
  });

  const results = await processIds(prisma, workspaceId, action, plan.eligibleIds, byId, createdById, op.id);
  return finalizeOp(prisma, workspaceId, op.id, action, plan.eligibleIds.length, results);
}

/** REANUDA una operación interrumpida desde su checkpoint (idempotente). */
export async function resumeOperation(prisma: PrismaLike, workspaceId: string, operationId: string, createdById: string | null): Promise<PauseCommitResult> {
  const op = await prisma.recurringPauseOperation.findFirst({ where: { id: operationId, workspaceId } });
  if (!op) return { ok: false, action: "pause", status: "failed", total: 0, processed: 0, results: [], error: "not_found" };
  const eligible: string[] = Array.isArray(op.eligibleIds) ? op.eligibleIds : [];
  const done = new Set<string>(Array.isArray(op.processedIds) ? op.processedIds : []);
  const remaining = eligible.filter((id) => !done.has(id));
  const rows = await loadStatuses(prisma, workspaceId, remaining);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const prior: PauseCommitResult["results"] = Array.isArray(op.results) ? op.results : [];
  const fresh = await processIds(prisma, workspaceId, op.action, remaining, byId, createdById, op.id, done, prior);
  return finalizeOp(prisma, workspaceId, op.id, op.action, eligible.length, [...prior, ...fresh]);
}

async function processIds(
  prisma: PrismaLike,
  workspaceId: string,
  action: PauseAction,
  eligibleIds: string[],
  byId: Map<string, StatusRow>,
  actorId: string | null,
  operationId: string,
  alreadyDone: Set<string> = new Set(),
  priorResults: PauseCommitResult["results"] = []
): Promise<PauseCommitResult["results"]> {
  const results: PauseCommitResult["results"] = [];
  const processedIds = [...alreadyDone];
  for (let i = 0; i < eligibleIds.length; i += BATCH) {
    const batch = eligibleIds.slice(i, i + BATCH);
    for (const id of batch) {
      const row = byId.get(id);
      const from = row?.status;
      try {
        if (action === "pause") {
          // guard de estado → idempotente/concurrency-safe. Preserva estado previo.
          const r = await prisma.recurringInvoiceTemplate.updateMany({
            where: { id, workspaceId, status: from },
            data: { status: "paused", statusBeforePause: from }
          });
          results.push(r.count === 1 ? { id, ok: true, from, to: "paused" } : { id, ok: false, from, error: "estado cambió (concurrencia) o ya pausada" });
        } else {
          const restore = row?.statusBeforePause || "active";
          const r = await prisma.recurringInvoiceTemplate.updateMany({
            where: { id, workspaceId, status: "paused" },
            data: { status: restore, statusBeforePause: null }
          });
          results.push(r.count === 1 ? { id, ok: true, from: "paused", to: restore } : { id, ok: false, from, error: "no estaba pausada (concurrencia)" });
        }
        if (results[results.length - 1].ok) {
          await prisma.auditLog.create({
            data: { workspaceId, actorId, action: `recurring.template.${action}`, targetType: "recurring_template", targetId: id, meta: { operationId, from, to: results[results.length - 1].to } }
          });
        }
      } catch (e: any) {
        results.push({ id, ok: false, from, error: String(e?.message ?? e).slice(0, 160) });
      }
      processedIds.push(id);
    }
    // CHECKPOINT tras cada lote (reanudable si se interrumpe).
    await prisma.recurringPauseOperation.updateMany({
      where: { id: operationId, workspaceId },
      data: { processedIds, results: [...priorResults, ...results], processed: processedIds.length }
    });
  }
  return results;
}

async function finalizeOp(prisma: PrismaLike, workspaceId: string, operationId: string, action: PauseAction, total: number, allResults: PauseCommitResult["results"]): Promise<PauseCommitResult> {
  const failed = allResults.filter((r) => !r.ok).length;
  const okCount = allResults.filter((r) => r.ok).length;
  const status: PauseCommitResult["status"] = failed === 0 ? "completed" : okCount === 0 ? "failed" : "partial";
  await prisma.recurringPauseOperation.updateMany({ where: { id: operationId, workspaceId }, data: { status, processed: allResults.length, results: allResults } });
  return { ok: status !== "failed", operationId, action, status, total, processed: allResults.length, results: allResults };
}

// ── Holded: checklist asistido (NUNCA muta Holded) ──────────────────────────

/** Inventario de plantillas ACTIVAS para pausar A MANO en Holded (CSV saneado). */
export async function holdedInventory(prisma: PrismaLike, workspaceId: string): Promise<{ csv: string; rows: InventoryRow[] }> {
  const rows = (await prisma.recurringInvoiceTemplate.findMany({
    where: { workspaceId, status: "active" },
    select: { clientSnapshot: true, totalCents: true, currency: true, intervalMonths: true, series: true, pausedInHolded: true }
  })) as any[];
  const inv: InventoryRow[] = rows.map((r) => ({ clientName: r.clientSnapshot?.name ?? "", totalCents: r.totalCents, currency: r.currency, intervalMonths: r.intervalMonths, series: r.series ?? "", pausedInHolded: !!r.pausedInHolded }));
  return { csv: inventoryCsv(inv), rows: inv };
}

/**
 * Marca `pausedInHolded=true` SOLO tras verificación EXPLÍCITA del admin (no ejecuta
 * ninguna pausa en Holded; solo registra que se verificó manualmente). Auditado.
 */
export async function markPausedInHolded(prisma: PrismaLike, workspaceId: string, templateIds: string[], verified: boolean, actorId: string | null, note?: string): Promise<{ updated: number }> {
  if (!verified) return { updated: 0 }; // sin verificación explícita → no se marca
  const r = await prisma.recurringInvoiceTemplate.updateMany({
    where: { workspaceId, id: { in: templateIds } },
    data: { pausedInHolded: true, pausedInHoldedAt: new Date() }
  });
  if (r.count > 0) {
    await prisma.auditLog.create({
      data: { workspaceId, actorId, action: "recurring.template.marked_paused_in_holded", targetType: "recurring_template", targetId: templateIds.slice(0, 50).join(","), meta: { count: r.count, note: (note ?? "").slice(0, 200) } }
    });
  }
  return { updated: r.count ?? 0 };
}
