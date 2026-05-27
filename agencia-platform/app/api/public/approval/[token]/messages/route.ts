/**
 * Hilos de mensajes en cada pieza editorial, accedidos por el cliente
 * vía link público. El cliente lee y escribe; el equipo lee/escribe
 * desde el endpoint privado /api/v1/editorial/posts/[id]/messages.
 *
 * GET  ?postId=... → mensajes del hilo (orden cronológico).
 * POST { postId, body } → cliente añade mensaje. Notifica al equipo
 *   con una Notification para cada miembro asignado al cliente
 *   (fallback: cualquier admin del workspace si no hay asignación
 *   explícita).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/web-push";

export const dynamic = "force-dynamic";

async function loadLinkOr404(token: string) {
  const link = await prisma.clientApprovalLink.findUnique({ where: { token } });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
    return null;
  }
  return link;
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const link = await loadLinkOr404(params.token);
  if (!link) return NextResponse.json({ error: { code: "expired" } }, { status: 404 });

  const url = new URL(req.url);
  const postId = url.searchParams.get("postId");
  if (!postId) return NextResponse.json({ items: [] });

  // El postId debe pertenecer al cliente del link, si no devolvemos
  // 404 — un cliente no puede leer mensajes de posts de otro.
  const post = await prisma.editorialPost.findFirst({
    where: { id: postId, workspaceId: link.workspaceId, clientId: link.clientId },
    select: { id: true }
  });
  if (!post) return NextResponse.json({ error: { code: "post_not_found" } }, { status: 404 });

  const items = await prisma.editorialPostMessage.findMany({
    where: { postId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, image: true } } }
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const link = await loadLinkOr404(params.token);
  if (!link) return NextResponse.json({ error: { code: "expired" } }, { status: 404 });

  const body = await req.json().catch(() => null);
  const postId = body?.postId as string | undefined;
  const text = (body?.body as string | undefined)?.trim();
  if (!postId || !text) {
    return NextResponse.json({ error: { code: "validation", message: "postId y body requeridos" } }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: { code: "too_long" } }, { status: 400 });
  }

  const post = await prisma.editorialPost.findFirst({
    where: { id: postId, workspaceId: link.workspaceId, clientId: link.clientId },
    select: { id: true, title: true, clientId: true }
  });
  if (!post) return NextResponse.json({ error: { code: "post_not_found" } }, { status: 404 });

  const client = await prisma.client.findUnique({
    where: { id: link.clientId },
    select: { name: true }
  });

  const msg = await prisma.editorialPostMessage.create({
    data: {
      postId,
      authorType: "CLIENT",
      authorId: null,
      authorName: client?.name ?? "Cliente",
      body: text
    }
  });

  // Notificar al equipo. Estrategia simple: avisar a todos los ADMIN
  // del workspace. Más fino: respetar ProjectMember o asignaciones
  // por cliente, pero como aún no hay tabla "owners del cliente",
  // admins es lo más sensato.
  const admins = await prisma.membership.findMany({
    where: { workspaceId: link.workspaceId, role: "ADMIN" },
    select: { userId: true }
  });
  if (admins.length > 0) {
    const notifBody = `${client?.name ?? "Tu cliente"} comentó en "${post.title}"`;
    const notifLink = `/admin/editorial?post=${postId}`;
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.userId,
        type: "editorial_message",
        body: notifBody,
        link: notifLink
      }))
    });
    Promise.all(
      admins.map((a) =>
        sendPushToUser(a.userId, {
          title: "Mensaje del cliente",
          body: notifBody,
          link: notifLink,
          tag: `editorial-msg-${postId}`
        }).catch(() => {})
      )
    );
  }

  return NextResponse.json(msg, { status: 201 });
}
