/**
 * GET  /api/v1/gmb/alerts — lista de alertas del workspace (filtros: status, severity, clientId).
 * POST /api/v1/gmb/alerts — genera/actualiza alertas AHORA (idempotente, auto-sanadora). Tenant.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { generateAlertsForWorkspace } from "@/lib/gmb/alerts-cron";
import { SEVERITY_ORDER, SLA_MINUTES, type AlertSeverity } from "@/lib/gmb/alerts";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined; // open|ack|resolved
  const severity = url.searchParams.get("severity") ?? undefined;
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const where: any = { workspaceId: api.workspaceId };
  if (status) where.status = status; else where.status = { in: ["open", "ack"] };
  if (severity) where.severity = severity;
  if (clientId) where.clientId = clientId;

  const alerts = await prisma.gmbAlert.findMany({ where, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, clientId: true, type: true, severity: true, title: true, body: true, status: true, assignedTo: true, deepLink: true, ackedAt: true, resolvedAt: true, createdAt: true } });
  // Orden por severidad (critical primero) manteniendo recencia dentro de cada nivel.
  alerts.sort((a: any, b: any) => (SEVERITY_ORDER[a.severity as AlertSeverity] ?? 3) - (SEVERITY_ORDER[b.severity as AlertSeverity] ?? 3));
  const now = Date.now();
  const items = alerts.map((a: any) => ({ ...a, slaMinutes: SLA_MINUTES[a.severity as AlertSeverity] ?? null, overdue: a.status !== "resolved" && (now - new Date(a.createdAt).getTime()) / 60000 > (SLA_MINUTES[a.severity as AlertSeverity] ?? Infinity) }));
  const byStatus: Record<string, number> = {};
  for (const a of alerts) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  return NextResponse.json({ ok: true, items, byStatus });
});

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const r = await generateAlertsForWorkspace(prisma, api.workspaceId);
  return NextResponse.json({ ok: true, ...r });
});
