/**
 * POST /api/v1/gmb/clients/[id]/reviews/ai-bulk { reviewIds } — genera con IA respuestas para varias
 * reseñas a la vez (máx. 25). NO publica nada: devuelve borradores para revisar. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateReviewReply } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.reviewIds) ? body.reviewIds.map(String).slice(0, 25) : [];
  if (!ids.length) throw new ApiError(400, "validation_error", "Selecciona alguna reseña.");
  const client = await prisma.gmbClient.findFirst({
    where: { id: (params as any).id, workspaceId: api.workspaceId },
    select: { id: true, name: true, tone: true, customTone: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const tone = client.tone === "custom" && client.customTone ? client.customTone : client.tone;
  const reviews = await prisma.gmbReview.findMany({
    where: { workspaceId: api.workspaceId, clientId: client.id, reviewId: { in: ids } },
    select: { reviewId: true, rating: true, comment: true, authorName: true }
  });

  const drafts: { reviewId: string; reply?: string; error?: string }[] = [];
  const queue = [...reviews];
  async function worker() {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const reply = await generateReviewReply({
          workspaceId: api.workspaceId,
          businessName: client!.name,
          tone,
          rating: r.rating || 5,
          comment: r.comment ?? "",
          authorName: r.authorName
        });
        drafts.push({ reviewId: r.reviewId, reply });
      } catch (e: any) {
        drafts.push({ reviewId: r.reviewId, error: String(e?.message ?? e).slice(0, 200) });
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return NextResponse.json({ ok: true, drafts });
});
