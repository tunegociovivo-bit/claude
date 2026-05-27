/**
 * POST /api/v1/gmb/clients/[id]/reviews/[reviewId]/reply
 * Body: { reply }
 * Guarda la respuesta en local y la publica en Google vía webhook de Make
 * (si está configurado). reviewId = el id de Google de la reseña.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { publishReplyViaMake, logGmbActivity } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

const schema = z.object({ reply: z.string().min(1).max(4000) });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, name: true, accountId: true, locationId: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const review = await prisma.gmbReview.findFirst({
    where: { clientId: client.id, reviewId: params.reviewId }
  });
  if (!review) throw new ApiError(404, "not_found", "Reseña no encontrada");

  await prisma.gmbReview.update({
    where: { id: review.id },
    data: { reviewReply: parsed.data.reply, updateTime: new Date() }
  });

  const pub = await publishReplyViaMake({
    workspaceId: api.workspaceId,
    accountId: client.accountId,
    locationId: client.locationId,
    reviewId: params.reviewId,
    reply: parsed.data.reply
  });

  await logGmbActivity({
    workspaceId: api.workspaceId,
    clientId: client.id,
    actionType: "review_replied",
    description: `Respuesta a reseña de ${review.authorName || "cliente"}${pub.sentToGoogle ? " (publicada en Google)" : " (guardada; configura el webhook de Make para publicar)"}`
  });

  return NextResponse.json({ ok: true, sentToGoogle: pub.sentToGoogle, note: pub.error });
});
