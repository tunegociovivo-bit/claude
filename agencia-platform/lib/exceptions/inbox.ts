/**
 * Aggregator de la bandeja de excepciones (FASE 4a) — consulta las fuentes
 * (scoped SIEMPRE por workspaceId) y compone la lista con el motor puro.
 *
 * Solo lectura. No expone importes € (los ítems de facturación llevan solo
 * antigüedad, no cantidades) → seguro para clients:read.
 */
import {
  fromAiDrafts,
  fromAiRuns,
  fromInvoices,
  fromTasks,
  dedupe,
  applyFilters,
  sortExceptions,
  summarize,
  type ExceptionFilters,
  type ExceptionItem,
  type Severity
} from "./engine";

type PrismaLike = any;
const DAY = 86_400_000;

export type ExceptionInbox = {
  items: ExceptionItem[];
  summary: Record<Severity, number> & { total: number };
  total: number;
};

export async function getExceptionInbox(
  prisma: PrismaLike,
  opts: { workspaceId: string; filters?: ExceptionFilters; now?: Date; limit?: number; recentDays?: number }
): Promise<ExceptionInbox> {
  const { workspaceId } = opts;
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 300);
  const since = new Date(now.getTime() - (opts.recentDays ?? 30) * DAY);

  const [drafts, runs, invoices, tasks] = await Promise.all([
    prisma.aiDraft.findMany({
      where: { workspaceId, status: { in: ["PENDING", "FAILED"] }, createdAt: { gte: since } },
      select: { id: true, kind: true, status: true, taskId: true, reviewedById: true, createdAt: true },
      take: 300
    }),
    prisma.aiAgentRun.findMany({
      where: { workspaceId, status: { in: ["REQUIRES_HUMAN", "FAILED"] }, createdAt: { gte: since } },
      select: { id: true, status: true, taskId: true, summary: true, error: true, createdAt: true },
      take: 300
    }),
    prisma.invoice.findMany({
      where: { workspaceId, deletedAt: null, status: "ISSUED", dueDate: { lt: now } },
      select: { id: true, number: true, status: true, totalCents: true, paidCents: true, dueDate: true, clientId: true },
      take: 300
    }),
    prisma.task.findMany({
      where: { workspaceId, deletedAt: null, parentId: null, completedAt: null, dueDate: { lt: now } },
      select: { id: true, title: true, dueDate: true, completedAt: true, clientId: true },
      take: 300
    })
  ]);

  const all: ExceptionItem[] = [
    ...fromAiDrafts(drafts as any, now),
    ...fromAiRuns(runs as any, now),
    ...fromInvoices(invoices as any, now),
    ...fromTasks(tasks as any, now)
  ];

  const deduped = dedupe(all);
  const filtered = applyFilters(deduped, opts.filters ?? {});
  const sorted = sortExceptions(filtered);

  return { items: sorted.slice(0, limit), summary: summarize(sorted), total: sorted.length };
}
