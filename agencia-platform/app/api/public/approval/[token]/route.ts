/**
 * GET /api/public/approval/[token]
 *
 * Endpoint público (sin auth) usado por la vista de aprobación que la
 * agencia comparte con el cliente. Devuelve metadatos del workspace,
 * datos del cliente y las publicaciones del mes con sus decisiones.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const link = await prisma.clientApprovalLink.findUnique({
    where: { token: params.token }
  });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
    return NextResponse.json({ error: { code: "expired", message: "Link no válido" } }, { status: 404 });
  }

  const [workspace, client, posts] = await Promise.all([
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
    (async () => {
      const [y, m] = link.month.split("-").map(Number);
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 1));
      return prisma.editorialPost.findMany({
        where: {
          workspaceId: link.workspaceId,
          clientId: link.clientId,
          scheduledFor: { gte: start, lt: end }
        },
        select: {
          id: true,
          title: true,
          content: true,
          hashtags: true,
          firstComment: true,
          copyByNetwork: true,
          format: true,
          networks: true,
          thumbnail: true,
          mediaUrls: true,
          status: true,
          scheduledFor: true
        },
        orderBy: { scheduledFor: "asc" }
      });
    })()
  ]);

  // Decisiones existentes de este link
  const decisions = await prisma.clientApprovalDecision.findMany({
    where: { linkId: link.id },
    orderBy: { createdAt: "asc" }
  });
  const decisionsByPost: Record<string, typeof decisions> = {};
  for (const d of decisions) {
    (decisionsByPost[d.postId] ??= []).push(d);
  }

  const wsSettings: any = workspace?.settings ?? {};
  return NextResponse.json({
    workspace: { name: workspace?.name ?? "", logoUrl: wsSettings?.branding?.logoUrl ?? null },
    client,
    month: link.month,
    expiresAt: link.expiresAt,
    posts: posts.map((p) => ({ ...p, decisions: decisionsByPost[p.id] ?? [] }))
  });
}
