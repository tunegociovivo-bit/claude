/**
 * GET /api/v1/gmb/review-funnels/[id]/feedback — quejas privadas recibidas + reparto de estrellas.
 * PATCH { feedbackId, status } — marca una queja como contactada/resuelta. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const id = (params as any).id as string;
  const funnel = await prisma.gmbReviewFunnel.findFirst({ where: { id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!funnel) throw new ApiError(404, "not_found", "Embudo no encontrado");
  const [feedback, stars] = await Promise.all([
    prisma.gmbReviewFunnelFeedback.findMany({ where: { funnelId: id, workspaceId: api.workspaceId }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.gmbReviewFunnelEvent.groupBy({ by: ["stars"], where: { funnelId: id, workspaceId: api.workspaceId, type: "star" }, _count: { _all: true } })
  ]);
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of stars as any[]) if (s.stars >= 1 && s.stars <= 5) dist[s.stars] = s._count._all;
  return NextResponse.json({ ok: true, feedback, stars: dist });
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const status = String(body?.status ?? "");
  if (!["new", "contacted", "resolved"].includes(status)) throw new ApiError(400, "validation_error", "Estado no válido");
  const r = await prisma.gmbReviewFunnelFeedback.updateMany({
    where: { id: String(body?.feedbackId ?? ""), funnelId: (params as any).id, workspaceId: api.workspaceId },
    data: { status }
  });
  if (!r.count) throw new ApiError(404, "not_found", "Opinión no encontrada");
  return NextResponse.json({ ok: true });
});
