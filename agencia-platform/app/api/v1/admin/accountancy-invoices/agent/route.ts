import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { prisma } from "@/lib/db/prisma";
import { buildCollectorTarget } from "@/lib/accountancy-invoices/collector";
import { refreshRunStatus } from "@/lib/accountancy-invoices/service";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  await requireAdmin(api);
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  await prisma.accountancyInvoiceRunItem.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore }, run: { workspaceId: api.workspaceId } },
    data: { status: "PENDING", startedAt: null, error: "Reintentada automáticamente tras interrumpirse la descarga anterior" }
  });
  const item = await prisma.accountancyInvoiceRunItem.findFirst({
    where: { status: "PENDING", run: { workspaceId: api.workspaceId } },
    include: { client: true, run: { select: { id: true, periodKey: true, periodFrom: true, periodTo: true } } },
    orderBy: { createdAt: "asc" }
  });
  if (!item) return NextResponse.json({ item: null });
  let target;
  try {
    target = buildCollectorTarget({ source: item.source, externalAccountId: item.client?.externalAccountId, periodFrom: item.run.periodFrom, periodTo: item.run.periodTo });
  } catch (error: any) {
    await prisma.accountancyInvoiceRunItem.update({ where: { id: item.id }, data: { status: "FAILED", error: String(error?.message || error).slice(0, 500), finishedAt: new Date() } });
    await refreshRunStatus(item.runId);
    return NextResponse.json({ skipped: item.id, reason: String(error?.message || error), retry: true });
  }
  const claimed = await prisma.accountancyInvoiceRunItem.updateMany({ where: { id: item.id, status: "PENDING", run: { workspaceId: api.workspaceId } }, data: { status: "RUNNING", startedAt: new Date(), error: null } });
  if (!claimed.count) return NextResponse.json({ item: null });
  await prisma.accountancyInvoiceRun.update({ where: { id: item.runId }, data: { status: "RUNNING", startedAt: new Date() } });
  return NextResponse.json({ item: { id: item.id, clientName: item.clientName, source: item.source, externalAccountId: item.client?.externalAccountId, periodKey: item.run.periodKey, periodFrom: item.run.periodFrom, periodTo: item.run.periodTo, target } });
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req: NextRequest, { api }) => {
  await requireAdmin(api);
  const body = await req.json();
  if (!body.id || !["DOWNLOADED", "FAILED", "SKIPPED"].includes(body.status)) throw new ApiError(400, "bad_result", "Resultado no válido");
  const current = await prisma.accountancyInvoiceRunItem.findFirst({ where: { id: body.id, run: { workspaceId: api.workspaceId } } });
  if (!current) throw new ApiError(404, "not_found", "Cuenta de ejecución no encontrada");
  const item = await prisma.accountancyInvoiceRunItem.update({
    where: { id: current.id },
    data: { status: body.status, invoiceCount: Math.max(0, Number(body.invoiceCount) || 0), amountCents: Math.max(0, Number(body.amountCents) || 0), currency: body.currency || "EUR", files: Array.isArray(body.files) ? body.files.slice(0, 200) : undefined, error: body.error ? String(body.error).slice(0, 1000) : null, finishedAt: new Date() }
  });
  await refreshRunStatus(item.runId);
  return NextResponse.json({ ok: true, item });
});
