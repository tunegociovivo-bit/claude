import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { replyToMetaComment, syncMetaCampaignComments } from "@/lib/meta/comments";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), campaignId: z.string().regex(/^\d+$/), clientName: z.string().min(1).max(120) }),
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
  if (parsed.data.action === "sync") return NextResponse.json(await syncMetaCampaignComments(api.workspaceId, parsed.data.campaignId, parsed.data.clientName));
  const comment = await prisma.metaAdComment.findFirst({ where: { id: parsed.data.commentId, workspaceId: api.workspaceId } });
  if (!comment) throw new ApiError(404, "not_found", "Comentario no encontrado");
  const replyId = await replyToMetaComment(api.workspaceId, comment.externalCommentId, parsed.data.message);
  await prisma.metaAdComment.update({ where: { id: comment.id }, data: { status: "replied", repliedAt: new Date(), externalReplyId: replyId, aiDraft: parsed.data.message } });
  return NextResponse.json({ ok: true, replyId });
});
