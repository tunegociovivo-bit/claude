/**
 * GET /api/public/portal/[token]
 *
 * Vista pública del portal del cliente. Reusa `ClientApprovalLink` —
 * el mismo token que da acceso al panel de aprobación editorial sirve
 * también para esta vista de "qué tenemos en marcha". Así no obligamos
 * a la agencia a manejar dos tokens por cliente.
 *
 * Devuelve:
 *   - workspace + branding del cliente
 *   - proyectos NO archivados del cliente con progreso
 *   - próximos eventos del calendario relacionados con el cliente
 *   - resumen del mes editorial: cuántos aprobados / pendientes / rechazados
 *   - link al panel de aprobación si hay pendientes
 *
 * No expone nada interno: tareas, mrr, miembros del equipo, etc.
 * quedan fuera. El cliente solo ve "el escaparate".
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimitPublic(req, { tag: "portal", limit: 60 });
  if (rl) return rl;

  const link = await prisma.clientApprovalLink.findUnique({
    where: { token: params.token }
  });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
    return NextResponse.json({ error: { code: "expired", message: "Link no válido" } }, { status: 404 });
  }

  const [y, m] = link.month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 1));

  const [workspace, client, projects, events, postsCount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: link.workspaceId },
      select: { id: true, name: true, settings: true }
    }),
    prisma.client.findUnique({
      where: { id: link.clientId },
      select: {
        id: true,
        name: true,
        brandColorPrimary: true,
        brandColorAccent: true,
        logoUrl: true
      }
    }),
    prisma.project.findMany({
      where: { workspaceId: link.workspaceId, clientId: link.clientId, archived: false },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        progress: true,
        updatedAt: true
      },
      orderBy: { updatedAt: "desc" },
      take: 20
    }),
    prisma.calendarEvent.findMany({
      where: {
        workspaceId: link.workspaceId,
        clientId: link.clientId,
        startAt: { gte: new Date() }
      },
      select: { id: true, title: true, startAt: true, endAt: true, allDay: true, type: true },
      orderBy: { startAt: "asc" },
      take: 10
    }),
    prisma.editorialPost.groupBy({
      by: ["status"],
      where: {
        workspaceId: link.workspaceId,
        clientId: link.clientId,
        scheduledFor: { gte: monthStart, lt: monthEnd }
      },
      _count: { _all: true }
    })
  ]);

  // Sumario del mes editorial. APPROVED/PUBLISHED son las "validadas";
  // REVIEW son las que esperan la decisión del cliente.
  const editorialSummary = {
    total: 0,
    approved: 0,
    review: 0,
    rejected: 0,
    other: 0
  };
  for (const row of postsCount) {
    editorialSummary.total += row._count._all;
    if (row.status === "APPROVED" || row.status === "PUBLISHED" || row.status === "SCHEDULED") {
      editorialSummary.approved += row._count._all;
    } else if (row.status === "REVIEW") {
      editorialSummary.review += row._count._all;
    } else if (row.status === "DRAFT") {
      // DRAFT tras un rechazo cuenta como rechazada; un draft "limpio" sin
      // decisión también cae aquí. Para no inducir alarma falsa lo
      // sumamos en "other". Si hay una decisión "rejected" en
      // ClientApprovalDecision lo movemos abajo.
      editorialSummary.other += row._count._all;
    } else {
      editorialSummary.other += row._count._all;
    }
  }
  // Marcar rechazadas reales (decisiones del cliente con rejected) —
  // así se nota cuando algo se reabrió por su feedback.
  const rejected = await prisma.clientApprovalDecision.count({
    where: { linkId: link.id, decision: "rejected" }
  });
  editorialSummary.rejected = rejected;

  const wsSettings: any = workspace?.settings ?? {};
  return NextResponse.json({
    workspace: { name: workspace?.name ?? "", logoUrl: wsSettings?.branding?.logoUrl ?? null },
    client,
    month: link.month,
    expiresAt: link.expiresAt,
    projects,
    events,
    editorial: editorialSummary,
    approvalUrl: `/p/editorial/${params.token}`
  });
}
