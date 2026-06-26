/**
 * GET /api/v1/reviews/clients/[id]/opinions
 *
 * Lista las opiniones (URL "A") de un cliente de reseñas del workspace.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await prisma.reviewClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");

  const items = await prisma.reviewOpinion.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, name: true, body: true, createdAt: true }
  });
  return NextResponse.json({ items });
});
