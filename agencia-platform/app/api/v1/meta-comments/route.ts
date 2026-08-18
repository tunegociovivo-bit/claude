import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { blockMetaCommentAuthor, deleteMetaComment, replyToMetaComment, syncMetaCampaignComments } from "@/lib/meta/comments";
import { auditFromReq } from "@/lib/audit/log";
import { metaAdsListAdAccounts, metaAdsListCampaigns } from "@/lib/integrations/meta-ads";
import { readWorkspaceMetaToken } from "@/lib/meta/connection";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), campaignId: z.string().regex(/^\d+$/), clientName: z.string().min(1).max(120), from: z.string().datetime().optional(), to: z.string().datetime().optional() }),
  z.object({ action: z.literal("reply"), commentId: z.string(), message: z.string().min(1).max(2000) })
  ,z.object({ action: z.literal("monitor"), campaignId: z.string().regex(/^\d+$/), campaignName: z.string().min(1).max(240), accountId: z.string().regex(/^act_\d+$/), accountName: z.string().min(1).max(240) })
  ,z.object({ action: z.literal("unmonitor"), campaignId: z.string().regex(/^\d+$/) })
  ,z.object({ action: z.literal("monitor_many"), accountId: z.string().regex(/^act_\d+$/), accountName: z.string().min(1).max(240), campaigns: z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().min(1).max(240) })).min(1).max(500) })
  ,z.object({ action: z.literal("delete_comment"), commentId: z.string().min(1) })
  ,z.object({ action: z.literal("block_author"), commentId: z.string().min(1) })
]);

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const catalog = url.searchParams.get("catalog");
  if (catalog === "accounts") {
    const token = await readWorkspaceMetaToken(api.workspaceId);
    if (!token) throw new ApiError(400, "meta_not_connected", "Meta no está conectado");
    return NextResponse.json({ items: await metaAdsListAdAccounts(api.workspaceId, { META_ADS_TOKEN: token }) });
  }
  if (catalog === "campaigns") {
    const accountId = url.searchParams.get("accountId");
    if (!accountId || !/^act_\d+$/.test(accountId)) throw new ApiError(400, "invalid_account", "Cuenta publicitaria no válida");
    const token = await readWorkspaceMetaToken(api.workspaceId);
    if (!token) throw new ApiError(400, "meta_not_connected", "Meta no está conectado");
    const campaigns = await metaAdsListCampaigns({ workspaceId: api.workspaceId, status: "ACTIVE", limit: 500, adhoc: { META_ADS_TOKEN: token, META_ADS_AD_ACCOUNT_ID: accountId } });
    // Meta can return configured/paused campaigns even when filtering by
    // effective_status. Apply the state check again before exposing bulk actions.
    const items = campaigns.filter((campaign: { status?: string; effective_status?: string }) =>
      campaign.status === "ACTIVE" && campaign.effective_status === "ACTIVE"
    );
    return NextResponse.json({ items });
  }
  const items = await prisma.metaAdComment.findMany({ where: { workspaceId: api.workspaceId, deletedAt: null }, include: { feed: { select: { clientName: true, campaignId: true } } }, orderBy: { commentCreatedAt: "desc" }, take: 300 });
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
  if (parsed.data.action === "monitor") {
    const feed = await prisma.metaCommentFeed.upsert({ where: { workspaceId_campaignId: { workspaceId: api.workspaceId, campaignId: parsed.data.campaignId } }, create: { workspaceId: api.workspaceId, campaignId: parsed.data.campaignId, clientName: parsed.data.accountName, campaignName: parsed.data.campaignName, adAccountId: parsed.data.accountId, adAccountName: parsed.data.accountName }, update: { active: true, campaignName: parsed.data.campaignName, adAccountId: parsed.data.accountId, adAccountName: parsed.data.accountName } });
    return NextResponse.json({ ok: true, feed });
  }
  if (parsed.data.action === "unmonitor") {
    await prisma.metaCommentFeed.updateMany({ where: { workspaceId: api.workspaceId, campaignId: parsed.data.campaignId }, data: { active: false } });
    return NextResponse.json({ ok: true });
  }
  if (parsed.data.action === "monitor_many") {
    const bulk = parsed.data;
    await prisma.$transaction(bulk.campaigns.map((campaign) => prisma.metaCommentFeed.upsert({ where: { workspaceId_campaignId: { workspaceId: api.workspaceId, campaignId: campaign.id } }, create: { workspaceId: api.workspaceId, campaignId: campaign.id, clientName: bulk.accountName, campaignName: campaign.name, adAccountId: bulk.accountId, adAccountName: bulk.accountName }, update: { active: true, campaignName: campaign.name, adAccountId: bulk.accountId, adAccountName: bulk.accountName } })));
    return NextResponse.json({ ok: true, selected: bulk.campaigns.length });
  }
  if (parsed.data.action === "delete_comment" || parsed.data.action === "block_author") {
    const moderation = parsed.data;
    const comment = await prisma.metaAdComment.findFirst({ where: { id: moderation.commentId, workspaceId: api.workspaceId, deletedAt: null } });
    if (!comment) throw new ApiError(404, "not_found", "Comentario no encontrado");
    if (moderation.action === "delete_comment") {
      await deleteMetaComment(api.workspaceId, comment.externalCommentId, comment.postId, comment.platform);
      await prisma.metaAdComment.update({ where: { id: comment.id }, data: { deletedAt: new Date(), status: "deleted" } });
      await auditFromReq(req, api, { action: "meta_comment.delete", targetType: "META_COMMENT", targetId: comment.id, meta: { externalCommentId: comment.externalCommentId, platform: comment.platform } });
      return NextResponse.json({ ok: true });
    }
    if (!comment.authorId) throw new ApiError(409, "author_unavailable", "Meta no ha proporcionado la identidad del autor; no se puede bloquear con seguridad");
    await blockMetaCommentAuthor(api.workspaceId, comment.authorId, comment.postId, comment.platform);
    await prisma.metaAdComment.updateMany({ where: { workspaceId: api.workspaceId, authorId: comment.authorId }, data: { authorBlockedAt: new Date() } });
    await auditFromReq(req, api, { action: "meta_comment.author_block", targetType: "META_COMMENT_AUTHOR", targetId: comment.authorId, meta: { commentId: comment.id, platform: comment.platform } });
    return NextResponse.json({ ok: true });
  }
  const comment = await prisma.metaAdComment.findFirst({ where: { id: parsed.data.commentId, workspaceId: api.workspaceId } });
  if (!comment) throw new ApiError(404, "not_found", "Comentario no encontrado");
  const replyId = await replyToMetaComment(api.workspaceId, comment.externalCommentId, parsed.data.message, comment.postId, comment.platform);
  await prisma.metaAdComment.update({ where: { id: comment.id }, data: { status: "replied", repliedAt: new Date(), externalReplyId: replyId, aiDraft: parsed.data.message } });
  return NextResponse.json({ ok: true, replyId });
});
