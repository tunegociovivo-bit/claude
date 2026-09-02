import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { refreshRunStatus } from "@/lib/accountancy-invoices/service";

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 503 });
  const item = await prisma.accountancyInvoiceRunItem.findFirst({
    where: { status: "PENDING", run: { status: { in: ["PENDING", "PARTIAL"] } } },
    include: { client: true, run: { select: { id: true, workspaceId: true, periodKey: true, periodFrom: true, periodTo: true } } },
    orderBy: { createdAt: "asc" }
  });
  if (!item) return NextResponse.json({ item: null });
  const claimed = await prisma.accountancyInvoiceRunItem.updateMany({ where: { id: item.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date(), error: null } });
  if (!claimed.count) return NextResponse.json({ item: null });
  await prisma.accountancyInvoiceRun.update({ where: { id: item.runId }, data: { status: "RUNNING", startedAt: new Date() } });
  return NextResponse.json({ item: { ...item, status: "RUNNING" } });
}

export async function PATCH(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 503 });
  const body = await req.json();
  if (!body.id || !["DOWNLOADED", "FAILED", "SKIPPED"].includes(body.status)) return NextResponse.json({ error: "Resultado no válido" }, { status: 400 });
  const item = await prisma.accountancyInvoiceRunItem.update({
    where: { id: body.id },
    data: { status: body.status, invoiceCount: Math.max(0, Number(body.invoiceCount) || 0), amountCents: Math.max(0, Number(body.amountCents) || 0), currency: body.currency || "EUR", files: body.files || undefined, error: body.error?.slice(0, 1000) || null, finishedAt: new Date() }
  });
  await refreshRunStatus(item.runId);
  return NextResponse.json({ ok: true, item });
}
