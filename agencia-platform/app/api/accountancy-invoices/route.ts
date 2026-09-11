import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAccountancyInvoiceRun, DEFAULT_RECIPIENTS, SOURCES } from "@/lib/accountancy-invoices/service";
import { getPreviousMonthPeriod, validateRecipients } from "@/lib/accountancy-invoices/domain";
import { syncAllAccountancyExpenses } from "@/lib/accountancy-invoices/expense-ledger";

async function adminContext() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) return null;
  const member = await prisma.membership.findFirst({ where: { userId, workspaceId, role: "ADMIN" } });
  return member ? { userId, workspaceId } : null;
}

export async function GET() {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const [clients, schedule, runs, googleAdsConnections, metaConnectionCount, billingMailboxCount, rawBrowserAgents, archivedItems, linkedExpenses] = await Promise.all([
    prisma.accountancyInvoiceClient.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: [{ enabled: "desc" }, { source: "asc" }, { name: "asc" }] }),
    prisma.accountancyInvoiceSchedule.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    prisma.accountancyInvoiceRun.findMany({ where: { workspaceId: ctx.workspaceId }, include: { items: { orderBy: [{ status: "asc" }, { source: "asc" }, { clientName: "asc" }] } }, orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.googleAdsConnection.findMany({ where: { workspaceId: ctx.workspaceId }, select: { accountEmail: true, label: true, updatedAt: true } }),
    prisma.metaConnection.count({ where: { workspaceId: ctx.workspaceId } }),
    prisma.emailAccount.count({ where: { workspaceId: ctx.workspaceId } }),
    prisma.accountancyBrowserAgent.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { lastHeartbeatAt: "desc" } }),
    prisma.accountancyInvoiceRunItem.findMany({
      where: { run: { workspaceId: ctx.workspaceId }, status: "DOWNLOADED" },
      include: { run: { select: { periodKey: true, createdAt: true } } },
      orderBy: { finishedAt: "desc" },
      take: 500
    }),
    prisma.expense.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null, notes: { contains: "[accountancy-file:" } }, select: { id: true, notes: true } })
  ]);
  const expenseByFile = new Map<string, string>();
  for (const expense of linkedExpenses) {
    const match = expense.notes?.match(/\[accountancy-file:([^\]]+)\]/);
    if (match) expenseByFile.set(match[1], expense.id);
  }
  const documentMap = new Map<string, any>();
  for (const item of archivedItems) {
    const files = Array.isArray(item.files) ? item.files as Array<{ id?: string; name?: string }> : [];
    const details = Array.isArray(item.invoiceDetails) ? item.invoiceDetails as Array<{ number?: string; date?: string; amountCents?: number; currency?: string; business?: string }> : [];
    files.forEach((file, index) => {
      if (!file?.id) return;
      const detail = details[index] || {};
      const key = `${item.source}:${item.clientName}:${detail.number || file.name || file.id}`;
      if (!documentMap.has(key)) documentMap.set(key, {
        id: file.id,
        name: file.name || detail.number || "factura.pdf",
        number: detail.number || file.name?.replace(/\.pdf$/i, "") || "Sin número",
        date: detail.date || item.finishedAt?.toISOString().slice(0, 10) || item.run.createdAt.toISOString().slice(0, 10),
        amountCents: Math.max(0, Number(detail.amountCents) || (files.length === 1 ? item.amountCents : 0)),
        currency: detail.currency || item.currency || "EUR",
        clientName: detail.business || item.clientName,
        source: item.source,
        periodKey: item.run.periodKey,
        expenseId: expenseByFile.get(file.id) || null,
        viewUrl: `/api/accountancy-invoices/files/${file.id}`,
        downloadUrl: `/api/accountancy-invoices/files/${file.id}?download=1`
      });
    });
  }
  const referencedAgentKeys = new Set(clients.filter((client) => client.source === "META" && client.connectionRef).map((client) => client.connectionRef));
  const activeAgentAfter = Date.now() - 10 * 60 * 1000;
  const browserAgents = rawBrowserAgents.filter((agent) => referencedAgentKeys.has(agent.agentKey) || agent.lastHeartbeatAt.getTime() >= activeAgentAfter);
  return NextResponse.json({ clients, documents: [...documentMap.values()], schedule: schedule ?? { enabled: true, dayOfMonth: 2, time: "08:30", timezone: "Europe/Madrid", recipients: DEFAULT_RECIPIENTS }, runs, sources: SOURCES, integrations: { googleAds: googleAdsConnections, metaConnectionCount, billingMailboxConnected: billingMailboxCount > 0, browserAgents } });
}

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json();
  if (body.action === "run") {
    const periodKey = getPreviousMonthPeriod().key;
    const existing = await prisma.accountancyInvoiceRun.findFirst({
      where: { workspaceId: ctx.workspaceId, periodKey, trigger: "MANUAL", status: { in: ["PENDING", "RUNNING"] } },
      include: { items: true },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      const existingClientIds = existing.items.map((item) => item.clientId).filter((id): id is string => Boolean(id));
      const missingActiveClients = await prisma.accountancyInvoiceClient.findMany({
        where: { workspaceId: ctx.workspaceId, enabled: true, id: { notIn: existingClientIds } }
      });
      if (missingActiveClients.length) {
        await prisma.accountancyInvoiceRunItem.createMany({
          data: missingActiveClients.map((client) => ({
            runId: existing.id,
            clientId: client.id,
            clientName: client.name,
            source: client.source
          }))
        });
      }
      const refreshed = await prisma.accountancyInvoiceRun.findUnique({ where: { id: existing.id }, include: { items: true } });
      return NextResponse.json(refreshed, { status: 202 });
    }
    const run = await createAccountancyInvoiceRun(ctx.workspaceId, "MANUAL");
    return NextResponse.json(run, { status: 202 });
  }
  if (body.action === "retry-failed") {
    const run = await prisma.accountancyInvoiceRun.findFirst({
      where: { id: body.runId, workspaceId: ctx.workspaceId },
      include: { items: true }
    });
    if (!run) return NextResponse.json({ error: "Ejecución no encontrada" }, { status: 404 });
    const source = typeof body.source === "string" ? body.source : undefined;
    const orphanedRunningBefore = new Date(Date.now() - 2 * 60 * 1000);
    const activeKey = `${ctx.workspaceId}:${run.periodKey}:${run.trigger}`;
    let retried;
    try {
      retried = await prisma.$transaction(async (tx) => {
        await tx.accountancyInvoiceRun.update({
          where: { id: run.id },
          data: { status: "PENDING", startedAt: new Date(), finishedAt: null, activeKey }
        });
        const result = await tx.accountancyInvoiceRunItem.updateMany({
          where: {
            runId: run.id,
            ...(source ? { source } : {}),
            OR: [
              { status: "FAILED" },
              ...(source === "META" ? [{ status: "RUNNING" as const, startedAt: { lt: orphanedRunningBefore } }] : [])
            ]
          },
          data: { status: "PENDING", error: null, startedAt: null, finishedAt: null }
        });
        if (!result.count) throw new Error("NO_FAILED_ITEMS");
        return result;
      });
    } catch (error: any) {
      if (error?.message === "NO_FAILED_ITEMS") return NextResponse.json({ error: "No hay cuentas fallidas para reintentar" }, { status: 409 });
      if (error?.code === "P2002") return NextResponse.json({ error: "Ya existe una ejecución activa para este periodo" }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ ok: true, retried: retried.count }, { status: 202 });
  }
  if (body.action === "retry-meta") {
    const run = await prisma.accountancyInvoiceRun.findFirst({
      where: { id: body.runId, workspaceId: ctx.workspaceId },
      select: { id: true, periodKey: true, trigger: true }
    });
    if (!run) return NextResponse.json({ error: "Ejecución no encontrada" }, { status: 404 });
    const orphanedRunningBefore = new Date(Date.now() - 2 * 60 * 1000);
    const recovered = await prisma.accountancyInvoiceRunItem.updateMany({
      where: {
        runId: run.id,
        source: "META",
        OR: [{ status: "FAILED" }, { status: "RUNNING", startedAt: { lt: orphanedRunningBefore } }]
      },
      data: { status: "PENDING", error: null, startedAt: null, finishedAt: null }
    });
    await prisma.accountancyInvoiceRun.update({
      where: { id: run.id },
      data: { status: "PENDING", finishedAt: null, activeKey: `${ctx.workspaceId}:${run.periodKey}:${run.trigger}` }
    });
    return NextResponse.json({ ok: true, retried: recovered.count }, { status: 202 });
  }
  if (body.action === "sync-expenses") {
    const created = await syncAllAccountancyExpenses(ctx.workspaceId);
    return NextResponse.json({ ok: true, created });
  }
  if (body.action === "client") {
    if (!body.name?.trim() || !SOURCES.includes(body.source)) return NextResponse.json({ error: "Nombre y medio son obligatorios" }, { status: 400 });
    const client = await prisma.accountancyInvoiceClient.create({ data: { workspaceId: ctx.workspaceId, name: body.name.trim(), source: body.source, externalAccountId: body.externalAccountId?.trim() || null, connectionRef: body.connectionRef?.trim().toLowerCase() || null, notes: body.notes?.trim() || null } });
    return NextResponse.json(client, { status: 201 });
  }
  if (body.action === "agent-label") {
    if (!body.agentKey) return NextResponse.json({ error: "Falta el perfil" }, { status: 400 });
    const customLabel = typeof body.customLabel === "string" ? body.customLabel.trim().slice(0, 100) : "";
    const updated = await prisma.accountancyBrowserAgent.updateMany({
      where: { workspaceId: ctx.workspaceId, agentKey: body.agentKey },
      data: { customLabel: customLabel || null }
    });
    if (!updated.count) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json();
  if (body.action === "agent-label") {
    if (!body.agentKey) return NextResponse.json({ error: "Falta el perfil" }, { status: 400 });
    const customLabel = typeof body.customLabel === "string" ? body.customLabel.trim().slice(0, 100) : "";
    const updated = await prisma.accountancyBrowserAgent.updateMany({
      where: { workspaceId: ctx.workspaceId, agentKey: body.agentKey },
      data: { customLabel: customLabel || null }
    });
    if (!updated.count) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "schedule") {
    const recipients = validateRecipients(body.recipients ?? DEFAULT_RECIPIENTS);
    const schedule = await prisma.accountancyInvoiceSchedule.upsert({
      where: { workspaceId: ctx.workspaceId },
      create: { workspaceId: ctx.workspaceId, enabled: body.enabled !== false, dayOfMonth: Math.min(28, Math.max(1, Number(body.dayOfMonth) || 2)), time: /^\d{2}:\d{2}$/.test(body.time) ? body.time : "08:30", timezone: body.timezone || "Europe/Madrid", recipients },
      update: { enabled: body.enabled !== false, dayOfMonth: Math.min(28, Math.max(1, Number(body.dayOfMonth) || 2)), time: /^\d{2}:\d{2}$/.test(body.time) ? body.time : "08:30", timezone: body.timezone || "Europe/Madrid", recipients }
    });
    return NextResponse.json(schedule);
  }
  if (body.action === "client") {
    if (!body.id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const updated = await prisma.accountancyInvoiceClient.updateMany({
      where: { id: body.id, workspaceId: ctx.workspaceId },
      data: {
        ...(typeof body.externalAccountId === "string" ? { externalAccountId: body.externalAccountId.trim() || null } : {}),
        ...(typeof body.connectionRef === "string" ? { connectionRef: body.connectionRef.trim() || null } : {}),
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {})
      }
    });
    if (!updated.count) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    return NextResponse.json(updated);
  }
  const updated = await prisma.accountancyInvoiceClient.updateMany({ where: { id: body.id, workspaceId: ctx.workspaceId }, data: { enabled: Boolean(body.enabled) } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  await prisma.accountancyInvoiceClient.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  return NextResponse.json({ ok: true });
}
