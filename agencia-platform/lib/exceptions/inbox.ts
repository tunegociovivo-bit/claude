/**
 * Aggregator de la bandeja de excepciones (Slice 2a) — consulta las fuentes
 * (scoped SIEMPRE por workspaceId) y compone una vista CON VALOR con el motor puro.
 *
 * Cambios clave frente a Fase 4a:
 *  - Ventana de recencia también en tareas/facturas (antes solo drafts/runs) →
 *    la vista "actual" muestra trabajo accionable, no un histórico infinito.
 *  - Orden por prioridad (impacto + recencia), no "más antiguo primero".
 *  - Histórico (>ventana) se CUENTA y se agrupa (clusters), nunca se pierde.
 *  - Secciones ejecutivas (Hoy / Bloqueos / Cobros-SLA / Clientes en riesgo) y
 *    "Trabajo hecho por SONIA" (runs SUCCEEDED recientes).
 *
 * Solo lectura. No expone importes € (solo banda cualitativa) → seguro para clients:read.
 */
import {
  fromAiDrafts,
  fromAiRuns,
  fromInvoices,
  fromTasks,
  dedupe,
  applyFilters,
  summarize,
  ACTIVE_WINDOW_DAYS,
  type ExceptionFilters,
  type ExceptionItem,
  type ExceptionSource,
  type Severity
} from "./engine";
import { sortByPriority, partition, clusterHistorical, buildSections, fromDoneRuns, type Cluster, type Sections, type DoneItem } from "./priority";

type PrismaLike = any;
const DAY = 86_400_000;

export type HistoricalSummary = { source: ExceptionSource; count: number; label: string };

export type ExceptionInbox = {
  items: ExceptionItem[]; // vista actual, priorizada (o histórico si view=archive)
  summary: Record<Severity, number> & { total: number };
  total: number;
  capped: boolean;
  view: "active" | "archive";
  activeWindowDays: number;
  sections: Sections | null; // solo en view=active
  done: DoneItem[]; // solo en view=active
  historical: { total: number; bySource: HistoricalSummary[] };
  clusters: Cluster[]; // resumen del histórico (por cliente) en view=archive
};

const SOURCE_CAP = 300;
const DONE_CAP = 20;

export async function getExceptionInbox(
  prisma: PrismaLike,
  opts: {
    workspaceId: string;
    filters?: ExceptionFilters;
    now?: Date;
    limit?: number;
    recentDays?: number;
    includeBilling?: boolean;
    view?: "active" | "archive";
    activeWindowDays?: number;
  }
): Promise<ExceptionInbox> {
  const { workspaceId } = opts;
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(1, opts.limit ?? 100), SOURCE_CAP);
  const since = new Date(now.getTime() - (opts.recentDays ?? 30) * DAY);
  const includeBilling = opts.includeBilling !== false;
  const view = opts.view === "archive" ? "archive" : "active";
  const activeWindowDays = Math.max(1, opts.activeWindowDays ?? ACTIVE_WINDOW_DAYS);
  const activeSince = new Date(now.getTime() - activeWindowDays * DAY);

  const clientSel = { client: { select: { name: true } } };
  const mapTask = (r: any) => ({ ...r, clientName: r.client?.name ?? null });

  if (view === "archive") {
    // Histórico: tareas/facturas vencidas ANTES de la ventana. Más antiguas
    // primero (limpieza). Paginado por `limit`. Solo task/invoice tienen histórico.
    const [tasks, invoices] = await Promise.all([
      prisma.task.findMany({
        where: { workspaceId, deletedAt: null, parentId: null, completedAt: null, dueDate: { lt: activeSince } },
        select: { id: true, title: true, dueDate: true, completedAt: true, clientId: true, ...clientSel },
        orderBy: { dueDate: "asc" },
        take: SOURCE_CAP
      }),
      includeBilling
        ? prisma.invoice.findMany({
            where: { workspaceId, deletedAt: null, status: "ISSUED", dueDate: { lt: activeSince } },
            select: { id: true, number: true, status: true, totalCents: true, paidCents: true, dueDate: true, clientId: true, ...clientSel },
            orderBy: { dueDate: "asc" },
            take: SOURCE_CAP
          })
        : Promise.resolve([])
    ]);
    const capped = [tasks, invoices].some((r: any[]) => r.length >= SOURCE_CAP);
    const all = [...fromTasks(tasks.map(mapTask) as any, now), ...fromInvoices(invoices.map(mapTask) as any, now)];
    const deduped = dedupe(all);
    const filtered = applyFilters(deduped, opts.filters ?? {});
    const sorted = sortByPriority(filtered);
    return {
      items: sorted.slice(0, limit),
      summary: summarize(sorted),
      total: sorted.length,
      capped,
      view,
      activeWindowDays,
      sections: null,
      done: [],
      historical: { total: sorted.length, bySource: [] },
      clusters: clusterHistorical(sorted, activeWindowDays)
    };
  }

  // ── view = active ──────────────────────────────────────────────────────────
  const [drafts, runs, doneRuns, invoices, tasks, oldTaskCount, oldInvoiceCount] = await Promise.all([
    prisma.aiDraft.findMany({
      where: { workspaceId, status: { in: ["PENDING", "FAILED"] }, createdAt: { gte: since } },
      select: { id: true, kind: true, status: true, taskId: true, reviewedById: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: SOURCE_CAP
    }),
    prisma.aiAgentRun.findMany({
      where: { workspaceId, status: { in: ["REQUIRES_HUMAN", "FAILED"] }, createdAt: { gte: since } },
      select: { id: true, status: true, taskId: true, summary: true, error: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: SOURCE_CAP
    }),
    prisma.aiAgentRun.findMany({
      // taskId no nulo → el enlace /tareas?task= siempre es válido.
      where: { workspaceId, status: "SUCCEEDED", taskId: { not: null }, createdAt: { gte: since } },
      select: { id: true, taskId: true, summary: true, finishedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: DONE_CAP
    }),
    // Facturas vencidas DENTRO de la ventana. Más recientes primero → el cap
    // conserva lo actual, no lo ancestral.
    includeBilling
      ? prisma.invoice.findMany({
          where: { workspaceId, deletedAt: null, status: "ISSUED", dueDate: { gte: activeSince, lt: now } },
          select: { id: true, number: true, status: true, totalCents: true, paidCents: true, dueDate: true, clientId: true, ...clientSel },
          orderBy: { dueDate: "desc" },
          take: SOURCE_CAP
        })
      : Promise.resolve([]),
    prisma.task.findMany({
      where: { workspaceId, deletedAt: null, parentId: null, completedAt: null, dueDate: { gte: activeSince, lt: now } },
      select: { id: true, title: true, dueDate: true, completedAt: true, clientId: true, ...clientSel },
      orderBy: { dueDate: "desc" },
      take: SOURCE_CAP
    }),
    prisma.task.count({ where: { workspaceId, deletedAt: null, parentId: null, completedAt: null, dueDate: { lt: activeSince } } }),
    includeBilling
      ? prisma.invoice.count({ where: { workspaceId, deletedAt: null, status: "ISSUED", dueDate: { lt: activeSince } } })
      : Promise.resolve(0)
  ]);

  const capped = [drafts, runs, invoices, tasks].some((r: any[]) => r.length >= SOURCE_CAP);

  const all: ExceptionItem[] = [
    ...fromAiDrafts(drafts as any, now),
    ...fromAiRuns(runs as any, now),
    ...fromInvoices(invoices.map(mapTask) as any, now),
    ...fromTasks(tasks.map(mapTask) as any, now)
  ];

  const deduped = dedupe(all);
  const filtered = applyFilters(deduped, opts.filters ?? {});
  // Todo lo consultado ya está dentro de la ventana → `active`. `partition` es
  // defensivo por si un colector emitiera algo más antiguo.
  const { active } = partition(filtered, activeWindowDays);
  const sorted = sortByPriority(active);

  const bySource: HistoricalSummary[] = [];
  if (oldTaskCount > 0) bySource.push({ source: "task", count: oldTaskCount, label: `${oldTaskCount} tareas vencidas hace más de ${activeWindowDays} días` });
  if (oldInvoiceCount > 0) bySource.push({ source: "invoice", count: oldInvoiceCount, label: `${oldInvoiceCount} facturas vencidas hace más de ${activeWindowDays} días` });

  return {
    items: sorted.slice(0, limit),
    summary: summarize(sorted),
    total: sorted.length,
    capped,
    view,
    activeWindowDays,
    sections: buildSections(sorted, now),
    done: fromDoneRuns(doneRuns as any, now),
    historical: { total: oldTaskCount + oldInvoiceCount, bySource },
    clusters: []
  };
}
