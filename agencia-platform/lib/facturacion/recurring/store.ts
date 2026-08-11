/**
 * Persistencia de plantillas recurrentes (Slice A). Commit IDEMPOTENTE por
 * @@unique([workspaceId, source, externalId]): reimportar el mismo fichero no
 * duplica; si el checksum cambió → update; si es igual → sin cambios. Tenant-scoped.
 * NUNCA emite facturas: todo entra como `status:"draft"`.
 */
import type { ParsedTemplate } from "./import";

type PrismaLike = any;

export type CommitResult = { created: number; updated: number; unchanged: number; errors: { externalId: string; error: string }[] };

function toData(workspaceId: string, source: string, t: ParsedTemplate, createdById: string | null) {
  return {
    workspaceId,
    source,
    externalId: t.externalId,
    status: "draft",
    lines: t.lines as any,
    currency: t.currency,
    subtotalCents: t.subtotalCents,
    taxCents: t.taxCents,
    totalCents: t.totalCents,
    intervalMonths: t.intervalMonths,
    dayOfMonth: t.dayOfMonth,
    startDate: t.startDate,
    endDate: t.endDate,
    paymentMethod: t.paymentMethod,
    series: t.series,
    sepa: t.paymentMethod === "REMITTANCE",
    checksum: t.checksum,
    clientSnapshot: { name: t.clientName, taxId: t.clientTaxId, email: t.clientEmail } as any,
    issuerSnapshot: { name: t.issuerName, taxId: t.issuerTaxId } as any,
    originalSnapshot: t.original as any,
    createdById
  };
}

export async function commitTemplates(prisma: PrismaLike, workspaceId: string, source: string, templates: ParsedTemplate[], createdById: string | null): Promise<CommitResult> {
  const res: CommitResult = { created: 0, updated: 0, unchanged: 0, errors: [] };
  for (const t of templates) {
    try {
      // Si ya existe y el checksum coincide → sin cambios (idempotente).
      const existing = await prisma.recurringInvoiceTemplate.findFirst({
        where: { workspaceId, source, externalId: t.externalId },
        select: { id: true, checksum: true }
      });
      if (existing && existing.checksum === t.checksum) {
        res.unchanged++;
        continue;
      }
      const data = toData(workspaceId, source, t, createdById);
      if (existing) {
        await prisma.recurringInvoiceTemplate.updateMany({ where: { id: existing.id, workspaceId }, data: { ...data, updatedAt: new Date() } });
        res.updated++;
      } else {
        await prisma.recurringInvoiceTemplate.create({ data });
        res.created++;
      }
    } catch (e: any) {
      // Carrera de creación concurrente (P2002) → tratar como idempotente.
      if (e?.code === "P2002") res.unchanged++;
      else res.errors.push({ externalId: t.externalId, error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return res;
}

export type TemplateListItem = {
  id: string;
  status: string;
  source: string;
  clientName: string | null;
  totalCents: number;
  currency: string;
  intervalMonths: number;
  nextIssueAt: string | null;
  pausedInHolded: boolean;
  syncStatus: string;
};

export async function listTemplates(prisma: PrismaLike, workspaceId: string, opts: { status?: string; q?: string; limit?: number }): Promise<{ items: TemplateListItem[]; summary: { active: number; paused: number; draft: number; error: number; monthlyCents: number; annualCents: number } }> {
  const where: any = { workspaceId };
  if (opts.status && ["active", "paused", "draft", "archived"].includes(opts.status)) where.status = opts.status;
  const rows = await prisma.recurringInvoiceTemplate.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(1, opts.limit ?? 200), 500),
    select: { id: true, status: true, source: true, clientSnapshot: true, totalCents: true, currency: true, intervalMonths: true, nextIssueAt: true, pausedInHolded: true, syncStatus: true }
  });
  const items: TemplateListItem[] = rows.map((r: any) => ({
    id: r.id,
    status: r.status,
    source: r.source,
    clientName: r.clientSnapshot?.name ?? null,
    totalCents: r.totalCents,
    currency: r.currency,
    intervalMonths: r.intervalMonths,
    nextIssueAt: r.nextIssueAt ? new Date(r.nextIssueAt).toISOString() : null,
    pausedInHolded: !!r.pausedInHolded,
    syncStatus: r.syncStatus
  }));
  // Resumen: normaliza cada plantilla a coste mensual (total / intervalMonths).
  const all = await prisma.recurringInvoiceTemplate.findMany({ where: { workspaceId }, select: { status: true, totalCents: true, intervalMonths: true, syncStatus: true } });
  const summary = { active: 0, paused: 0, draft: 0, error: 0, monthlyCents: 0, annualCents: 0 };
  for (const r of all as any[]) {
    if (r.status === "active") summary.active++;
    else if (r.status === "paused") summary.paused++;
    else if (r.status === "draft") summary.draft++;
    if (r.syncStatus === "error") summary.error++;
    if (r.status === "active") {
      const monthly = Math.round(r.totalCents / Math.max(1, r.intervalMonths));
      summary.monthlyCents += monthly;
    }
  }
  summary.annualCents = summary.monthlyCents * 12;
  return { items, summary };
}
