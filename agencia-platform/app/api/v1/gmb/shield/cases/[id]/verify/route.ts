/** POST /api/v1/gmb/shield/cases/[id]/verify → comprueba ahora si la reseña sigue publicada. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { verifyPlace } from "@/lib/gmb/fake-reviews/cases";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const POST = withApi({ scope: "*", rate: "ai" }, async (_req, { params, api }) => {
  const c = await prisma.gmbReviewCase.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!c) throw new ApiError(404, "not_found", "Caso no encontrado");
  await verifyPlace(api.workspaceId, c.placeKey, [c]);
  const out = await prisma.gmbReviewCase.findFirst({ where: { id: c.id, workspaceId: api.workspaceId } });
  const last = ((out?.checkLog as any[]) ?? [])[0];
  return NextResponse.json({ case: out, found: last?.found ?? null });
});
