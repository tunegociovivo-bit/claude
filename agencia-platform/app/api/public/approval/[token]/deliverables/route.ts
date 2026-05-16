/**
 * Entregables del cliente vía link público. Mismo token que el resto
 * del portal. El cliente ve los pendientes y los APROBADOS recientes,
 * con sus archivos descargables.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { dispatchWebhook } from "@/lib/webhooks/dispatch";
import { sendPushToUser } from "@/lib/push/web-push";

export const dynamic = "force-dynamic";

async function loadLinkOr404(token: string) {
  const link = await prisma.clientApprovalLink.findUnique({ where: { token } });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) return null;
  return link;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const link = await loadLinkOr404(params.token);
  if (!link) return NextResponse.json({ error: { code: "expired" } }, { status: 404 });

  const items = await prisma.deliverable.findMany({
    where: { workspaceId: link.workspaceId, clientId: link.clientId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      file: { select: { id: true, name: true, mimeType: true, sizeBytes: true } },
      decisions: { orderBy: { createdAt: "asc" } }
    }
  });

  // URLs firmadas para descarga directa de los archivos. Si tu storage
  // ya da URL pública en File.url, salta este bloque y usa esa.
  // Aquí devolvemos sólo el fileId/name; el cliente pedirá la URL
  // firmada en el endpoint /api/v1/files/[id]/download si lo necesitas.
  // (Para no inflar, devuelvo lo que hay con la URL relativa de
  // descarga interna.)

  return NextResponse.json({
    items: items.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      status: d.status,
      dueAt: d.dueAt,
      createdAt: d.createdAt,
      file: d.file,
      decisions: d.decisions
    }))
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const link = await loadLinkOr404(params.token);
  if (!link) return NextResponse.json({ error: { code: "expired" } }, { status: 404 });

  const body = await req.json().catch(() => null);
  const deliverableId = body?.deliverableId as string | undefined;
  const decision = body?.decision as string | undefined;
  const comment = (body?.comment as string | undefined)?.trim() || null;

  if (!deliverableId || !decision || !["approved", "rejected", "comment"].includes(decision)) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }

  const d = await prisma.deliverable.findFirst({
    where: { id: deliverableId, workspaceId: link.workspaceId, clientId: link.clientId },
    select: { id: true, title: true }
  });
  if (!d) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  // Transacción: crea la decisión y, si es aprobado/rechazado, actualiza
  // el status del Deliverable. "comment" no cambia el status.
  const newStatus = decision === "approved" ? "APPROVED" : decision === "rejected" ? "REJECTED" : null;
  const [created] = await prisma.$transaction([
    prisma.deliverableDecision.create({
      data: { deliverableId, decision, comment }
    }),
    ...(newStatus
      ? [prisma.deliverable.update({ where: { id: deliverableId }, data: { status: newStatus } })]
      : [])
  ]);

  // Notificar al equipo
  const admins = await prisma.membership.findMany({
    where: { workspaceId: link.workspaceId, role: "ADMIN" },
    select: { userId: true }
  });
  if (admins.length > 0) {
    const client = await prisma.client.findUnique({ where: { id: link.clientId }, select: { name: true } });
    const verb = decision === "approved" ? "aprobó" : decision === "rejected" ? "rechazó" : "comentó";
    const notifBody = `${client?.name ?? "Tu cliente"} ${verb} "${d.title}"${comment ? `: ${comment.slice(0, 80)}` : ""}`;
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.userId,
        type: "deliverable_decision",
        body: notifBody,
        link: `/admin/entregables?d=${deliverableId}`
      }))
    });
    Promise.all(
      admins.map((a) =>
        sendPushToUser(a.userId, {
          title: `Cliente ${verb}`,
          body: notifBody,
          link: `/admin/entregables?d=${deliverableId}`,
          tag: `deliverable-${deliverableId}`
        }).catch(() => {})
      )
    );
  }

  dispatchWebhook(link.workspaceId, decision === "approved" ? "editorial.approved" : "editorial.rejected", {
    type: "deliverable",
    id: deliverableId,
    title: d.title,
    comment
  });

  return NextResponse.json(created, { status: 201 });
}
