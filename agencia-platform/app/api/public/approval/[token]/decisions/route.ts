/**
 * POST /api/public/approval/[token]/decisions
 * Body: { postId, decision: "approved"|"rejected"|"comment", comment?: string }
 *
 * El cliente externo deja una decisión/comentario en una publicación.
 * También crea una EditorialRevision automáticamente para que aparezca
 * en el historial interno.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const bodySchema = z.object({
  postId: z.string().min(1),
  decision: z.enum(["approved", "rejected", "comment"]),
  comment: z.string().max(2000).optional()
});

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const link = await prisma.clientApprovalLink.findUnique({ where: { token: params.token } });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
    return NextResponse.json({ error: { code: "expired", message: "Link no válido" } }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation_error", message: parsed.error.message } }, { status: 400 });
  }

  // Verificar que el post existe y pertenece al cliente del link
  const post = await prisma.editorialPost.findFirst({
    where: { id: parsed.data.postId, workspaceId: link.workspaceId, clientId: link.clientId }
  });
  if (!post) {
    return NextResponse.json({ error: { code: "not_found", message: "Publicación no encontrada" } }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const dec = await tx.clientApprovalDecision.create({
      data: {
        linkId: link.id,
        postId: parsed.data.postId,
        decision: parsed.data.decision,
        comment: parsed.data.comment ?? null
      }
    });

    // Si aprobado/rechazado: marcar estado de la publicación en hub
    if (parsed.data.decision === "approved" && post.status === "REVIEW") {
      await tx.editorialPost.update({
        where: { id: post.id },
        data: { status: "APPROVED" }
      });
    } else if (parsed.data.decision === "rejected") {
      await tx.editorialPost.update({
        where: { id: post.id },
        data: { status: "DRAFT" }
      });
    }

    // Anotar en el historial interno
    const summaryMap = {
      approved: "Cliente aprobó esta publicación",
      rejected: "Cliente rechazó esta publicación",
      comment: "Comentario del cliente"
    } as const;
    await tx.editorialRevision.create({
      data: {
        postId: post.id,
        authorId: null,
        body: parsed.data.comment ?? null,
        changeSummary: summaryMap[parsed.data.decision]
      }
    });

    return dec;
  });

  return NextResponse.json(created, { status: 201 });
}
