/**
 * Cliente 360 — resumen operativo AGREGADO (FASE 3).
 *
 * Una sola función que compone en paralelo lo esencial de un cliente (evita la
 * cascada de fetch de la pantalla actual). Reglas duras:
 *   - TENANT: cada subconsulta lleva `workspaceId` (no hay filtro automático).
 *   - ROL/PRIVACIDAD: los importes € (mrr, facturación) van GATED a admin
 *     (mismo patrón que la tarjeta MRR y el gestor de facturas). `accesos`
 *     (credenciales del cliente) NUNCA se incluye.
 *   - DATOS: costes/rentabilidad-real = "sin datos" (no existen en el modelo);
 *     nunca se inventan.
 *
 * Es agnóstica de framework: recibe `prisma` para poder testearla con mocks.
 */
import { computeProfitability, type Profitability } from "./profitability";
import { computeHealth, mergeHealthConfig, type HealthConfig, type HealthResult, type HealthSignals } from "./health";

type PrismaLike = any;

export type ClientOverviewOpts = {
  workspaceId: string;
  clientId: string;
  isAdmin: boolean;
  now?: Date;
  healthConfigPartial?: Partial<{ weights: any; thresholds: any }> | null;
};

export type ClientOverview = {
  essentials: Record<string, unknown>;
  projects: { activeCount: number; items: { id: string; name: string; progress: number; managerUserId: string | null }[] };
  tasks: { openCount: number; overdueCount: number; doneCount: number; recent: { id: string; title: string; status: string; dueDate: string | null }[] };
  activity: { lastActivityAt: string | null; daysSinceLastActivity: number | null; sources: Record<string, string | null> };
  responsables: { managers: { id: string; name: string | null }[]; aiOwner: { checkFreqDays: number | null; lastStatus: string | null } | null };
  billing: { visible: boolean; reason?: string; profitability?: Profitability };
  health: HealthResult;
  dataQuality: { costsTraceable: false; notes: string[] };
};

const DAY = 86_400_000;
function maxDate(dates: (Date | null | undefined)[]): Date | null {
  let m: Date | null = null;
  for (const d of dates) if (d && (!m || d.getTime() > m.getTime())) m = d;
  return m;
}
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function getClientOverview(prisma: PrismaLike, opts: ClientOverviewOpts): Promise<ClientOverview | null> {
  const { workspaceId, clientId, isAdmin } = opts;
  const now = opts.now ?? new Date();
  const config: HealthConfig = mergeHealthConfig(opts.healthConfigPartial);

  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId, deletedAt: null } });
  if (!client) return null;

  const taskBase = { clientId, workspaceId, deletedAt: null, parentId: null };
  const [
    projects,
    openCount,
    overdueCount,
    doneCount,
    recentTasks,
    invoices,
    latestTask,
    latestEditorial,
    latestEvent,
    latestDeliverable,
    latestComment,
    latestInvoice,
    pendingDeliverables,
    aiOwner
  ] = await Promise.all([
    prisma.project.findMany({
      where: { clientId, workspaceId, archived: false, deletedAt: null },
      select: { id: true, name: true, progress: true, managerUserId: true },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.task.count({ where: { ...taskBase, completedAt: null } }),
    prisma.task.count({ where: { ...taskBase, completedAt: null, dueDate: { lt: now } } }),
    prisma.task.count({ where: { ...taskBase, completedAt: { not: null } } }),
    prisma.task.findMany({ where: { ...taskBase, completedAt: null }, select: { id: true, title: true, status: true, dueDate: true }, orderBy: { updatedAt: "desc" }, take: 5 }),
    prisma.invoice.findMany({ where: { clientId, workspaceId, deletedAt: null }, select: { status: true, totalCents: true, paidCents: true, dueDate: true } }),
    prisma.task.findFirst({ where: { clientId, workspaceId, deletedAt: null }, select: { updatedAt: true }, orderBy: { updatedAt: "desc" } }),
    prisma.editorialPost.findFirst({ where: { clientId, workspaceId }, select: { updatedAt: true }, orderBy: { updatedAt: "desc" } }),
    prisma.calendarEvent.findFirst({ where: { clientId, workspaceId }, select: { startAt: true }, orderBy: { startAt: "desc" } }),
    prisma.deliverable.findFirst({ where: { clientId, workspaceId }, select: { updatedAt: true }, orderBy: { updatedAt: "desc" } }),
    prisma.comment.findFirst({ where: { workspaceId, targetType: "CLIENT", targetId: clientId }, select: { createdAt: true }, orderBy: { createdAt: "desc" } }),
    prisma.invoice.findFirst({ where: { clientId, workspaceId, deletedAt: null }, select: { issueDate: true }, orderBy: { issueDate: "desc" } }),
    prisma.deliverable.count({ where: { clientId, workspaceId, status: "PENDING" } }),
    prisma.aiOwnership.findFirst({ where: { clientId, workspaceId }, select: { checkFreqDays: true, lastStatus: true } })
  ]);

  // ── Actividad (recencia) ──
  const activitySources = {
    task: iso(latestTask?.updatedAt),
    editorial: iso(latestEditorial?.updatedAt),
    event: iso(latestEvent?.startAt),
    deliverable: iso(latestDeliverable?.updatedAt),
    comment: iso(latestComment?.createdAt),
    invoice: iso(latestInvoice?.issueDate)
  };
  const lastActivity = maxDate([
    latestTask?.updatedAt,
    latestEditorial?.updatedAt,
    latestEvent?.startAt,
    latestDeliverable?.updatedAt,
    latestComment?.createdAt,
    latestInvoice?.issueDate
  ]);
  const daysSinceLastActivity = lastActivity ? Math.floor((now.getTime() - lastActivity.getTime()) / DAY) : null;

  // ── Rentabilidad (ingresos trazables; costes sin datos) ──
  const profitability = computeProfitability({
    mrrEuros: (client.mrr as number) ?? 0,
    now,
    invoices: (invoices as any[]).map((i) => ({ status: i.status, totalCents: i.totalCents, paidCents: i.paidCents, dueDate: i.dueDate }))
  });

  // ── Salud (determinista; sin importes €) ──
  const avgProgress = projects.length ? Math.round(projects.reduce((s: number, p: any) => s + (p.progress ?? 0), 0) / projects.length) : null;
  const signals: HealthSignals = {
    overdueInvoiceCount: profitability.invoiced.overdueCount,
    overdueAmountCents: profitability.invoiced.overdueCents,
    daysSinceLastActivity,
    openOverdueTaskCount: overdueCount,
    hasMrr: profitability.recurring.hasMrr,
    activeProjectCount: projects.length,
    avgProjectProgress: avgProgress,
    status: String(client.status)
  };
  const health = computeHealth(signals, config);

  // ── Responsables ──
  const managerIds = [...new Set(projects.map((p: any) => p.managerUserId).filter(Boolean))] as string[];
  const managerUsers = managerIds.length
    ? await prisma.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, name: true } })
    : [];

  // ── Esenciales (con redacción por rol; accesos NUNCA) ──
  const essentials: Record<string, unknown> = {
    id: client.id,
    name: client.name,
    industry: client.industry ?? null,
    status: client.status,
    prioridad: client.prioridad,
    since: iso(client.since),
    servicios: Array.isArray(client.servicios) ? client.servicios : [],
    kitDigital: !!client.kitDigital,
    website: client.website ?? null,
    contactName: client.contactName ?? null,
    email: client.email ?? null,
    phone: client.phone ?? null,
    notes: client.notes ?? null
  };
  if (isAdmin) {
    essentials.legalName = client.legalName ?? null;
    essentials.taxId = client.taxId ?? null;
    essentials.city = client.city ?? null;
    essentials.province = client.province ?? null;
    essentials.sepaEnabled = !!client.sepaEnabled;
    essentials.stripeCustomerId = client.stripeCustomerId ?? null;
  }

  return {
    essentials,
    projects: {
      activeCount: projects.length,
      items: projects.slice(0, 8).map((p: any) => ({ id: p.id, name: p.name, progress: p.progress ?? 0, managerUserId: p.managerUserId ?? null }))
    },
    tasks: {
      openCount,
      overdueCount,
      doneCount,
      recent: (recentTasks as any[]).map((t) => ({ id: t.id, title: t.title, status: t.status, dueDate: iso(t.dueDate) }))
    },
    activity: { lastActivityAt: iso(lastActivity), daysSinceLastActivity, sources: activitySources },
    responsables: {
      managers: managerUsers.map((u: any) => ({ id: u.id, name: u.name ?? null })),
      aiOwner: aiOwner ? { checkFreqDays: aiOwner.checkFreqDays ?? null, lastStatus: aiOwner.lastStatus ?? null } : null
    },
    billing: isAdmin
      ? { visible: true, profitability }
      : { visible: false, reason: "Los importes de facturación y MRR solo son visibles para administradores." },
    health,
    dataQuality: {
      costsTraceable: false,
      notes: [
        "Rentabilidad: solo lado ingresos (facturas + MRR). Costes/horas no existen en el modelo → margen no calculable.",
        pendingDeliverables > 0 ? `${pendingDeliverables} entregable(s) pendiente(s) de aprobación.` : "Sin entregables pendientes."
      ]
    }
  };
}
