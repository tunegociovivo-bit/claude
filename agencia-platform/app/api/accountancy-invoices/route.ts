import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAccountancyInvoiceRun, DEFAULT_RECIPIENTS, processAllPendingGoogleAdsInvoiceRun, processPendingHoldedInvoiceRun, SOURCES } from "@/lib/accountancy-invoices/service";
import { validateRecipients } from "@/lib/accountancy-invoices/domain";

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
  const [clients, schedule, runs, googleAdsConnections, metaConnectionCount] = await Promise.all([
    prisma.accountancyInvoiceClient.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: [{ enabled: "desc" }, { source: "asc" }, { name: "asc" }] }),
    prisma.accountancyInvoiceSchedule.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    prisma.accountancyInvoiceRun.findMany({ where: { workspaceId: ctx.workspaceId }, include: { items: { orderBy: [{ status: "asc" }, { source: "asc" }, { clientName: "asc" }] } }, orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.googleAdsConnection.findMany({ where: { workspaceId: ctx.workspaceId }, select: { accountEmail: true, label: true, updatedAt: true } }),
    prisma.metaConnection.count({ where: { workspaceId: ctx.workspaceId } })
  ]);
  return NextResponse.json({ clients, schedule: schedule ?? { enabled: true, dayOfMonth: 2, time: "08:30", timezone: "Europe/Madrid", recipients: DEFAULT_RECIPIENTS }, runs, sources: SOURCES, integrations: { googleAds: googleAdsConnections, metaConnectionCount } });
}

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json();
  if (body.action === "run") {
    const run = await createAccountancyInvoiceRun(ctx.workspaceId, "MANUAL");
    setImmediate(() => processPendingHoldedInvoiceRun(run.id).catch((error) => console.warn("[facturas-gestoria] Holded manual:", error?.message || error)));
    setImmediate(() => processAllPendingGoogleAdsInvoiceRun(run.id).catch((error) => console.warn("[facturas-gestoria] Google Ads manual:", error?.message || error)));
    return NextResponse.json(run, { status: 201 });
  }
  if (body.action === "client") {
    if (!body.name?.trim() || !SOURCES.includes(body.source)) return NextResponse.json({ error: "Nombre y medio son obligatorios" }, { status: 400 });
    const client = await prisma.accountancyInvoiceClient.create({ data: { workspaceId: ctx.workspaceId, name: body.name.trim(), source: body.source, externalAccountId: body.externalAccountId?.trim() || null, connectionRef: body.connectionRef?.trim().toLowerCase() || null, notes: body.notes?.trim() || null } });
    return NextResponse.json(client, { status: 201 });
  }
  return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json();
  if (body.action === "schedule") {
    const recipients = validateRecipients(body.recipients ?? DEFAULT_RECIPIENTS);
    const schedule = await prisma.accountancyInvoiceSchedule.upsert({
      where: { workspaceId: ctx.workspaceId },
      create: { workspaceId: ctx.workspaceId, enabled: body.enabled !== false, dayOfMonth: Math.min(28, Math.max(1, Number(body.dayOfMonth) || 2)), time: /^\d{2}:\d{2}$/.test(body.time) ? body.time : "08:30", timezone: body.timezone || "Europe/Madrid", recipients },
      update: { enabled: body.enabled !== false, dayOfMonth: Math.min(28, Math.max(1, Number(body.dayOfMonth) || 2)), time: /^\d{2}:\d{2}$/.test(body.time) ? body.time : "08:30", timezone: body.timezone || "Europe/Madrid", recipients }
    });
    return NextResponse.json(schedule);
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
