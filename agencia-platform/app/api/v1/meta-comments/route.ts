import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { replyToMetaComment, syncMetaCampaignComments } from "@/lib/meta/comments";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), campaignId: z.string().regex(/^\d+$/), clientName: z.string().min(1).max(120), from: z.string().datetime().optional(), to: z.string().datetime().optional() }),
  z.object({ action: z.literal("reply"), commentId: z.string(), message: z.string().min(1).max(2000) })
]);

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.metaAdComment.findMany({ where: { workspaceId: api.workspaceId }, include: { feed: { select: { clientName: true, campaignId: true } } }, orderBy: { commentCreatedAt: "desc" }, take: 300 });
  const feeds = await prisma.metaCommentFeed.findMany({ where: { workspaceId: api.workspaceId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ items, feeds });
});

export const POST = withApi({ scope: "*", rate: "destructive" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (parsed.data.action === "sync") {
    if (Boolean(parsed.data.from) !== Boolean(parsed.data.to)) throw new ApiError(400, "invalid_range", "Debes indicar el inicio y el final del periodo");
    let range: { from: Date; to: Date } | undefined;
    if (parsed.data.from && parsed.data.to) {
      const from = new Date(parsed.data.from); const to = new Date(parsed.data.to);
      if (from > to) throw new ApiError(400, "invalid_range", "La fecha inicial debe ser anterior a la final");
      if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) throw new ApiError(400, "range_too_large", "El periodo máximo por importación es de 366 días");
      range = { from, to };
    }
    return NextResponse.json(await syncMetaCampaignComments(api.workspaceId, parsed.data.campaignId, parsed.data.clientName, range));
  }
  const comment = await prisma.metaAdComment.findFirst({ where: { id: parsed.data.commentId, workspaceId: api.workspaceId } });
  if (!comment) throw new ApiError(404, "not_found", "Comentario no encontrado");
  const replyId = await replyToMetaComment(api.workspaceId, comment.externalCommentId, parsed.data.message, comment.postId);
  await prisma.metaAdComment.update({ where: { id: comment.id }, data: { status: "replied", repliedAt: new Date(), externalReplyId: replyId, aiDraft: parsed.data.message } });
  return NextResponse.json({ ok: true, replyId });
});
