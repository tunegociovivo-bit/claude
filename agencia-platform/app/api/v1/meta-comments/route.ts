import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { blockMetaCommentAuthor, deleteMetaComment, notifyMetaOperational, regenerateMetaCommentDraft, replyToMetaComment, syncMetaCampaignComments } from "@/lib/meta/comments";
import { auditFromReq } from "@/lib/audit/log";
import { metaAdsListAdAccounts, metaAdsListCampaigns } from "@/lib/integrations/meta-ads";
import { listWorkspaceMetaTokens, readMetaTokenByConnection } from "@/lib/meta/connection";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), campaignId: z.string().regex(/^\d+$/), clientName: z.string().min(1).max(120), from: z.string().datetime().optional(), to: z.string().datetime().optional() }),
  z.object({ action: z.literal("reply"), commentId: z.string(), message: z.string().min(1).max(2000) })
  ,z.object({ action: z.literal("monitor"), campaignId: z.string().regex(/^\d+$/), campaignName: z.string().min(1).max(240), accountId: z.string().regex(/^act_\d+$/), accountName: z.string().min(1).max(240), connectionId: z.string().min(1) })
  ,z.object({ action: z.literal("unmonitor"), campaignId: z.string().regex(/^\d+$/) })
  ,z.object({ action: z.literal("monitor_many"), accountId: z.string().regex(/^act_\d+$/), accountName: z.string().min(1).max(240), connectionId: z.string().min(1), campaigns: z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().min(1).max(240) })).min(1).max(500) })
  ,z.object({ action: z.literal("delete_comment"), commentId: z.string().min(1) })
  ,z.object({ action: z.literal("block_author"), commentId: z.string().min(1) })
  ,z.object({ action: z.literal("rename_client"), campaignIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500), displayName: z.string().trim().min(1).max(120) })
  ,z.object({ action: z.literal("set_client_ai_context"), campaignIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500), aiContext: z.string().trim().max(5000) })
  ,z.object({ action: z.literal("add_alert_email"), email: z.string().trim().email().max(254) })
  ,z.object({ action: z.literal("set_alert_email"), recipientId: z.string().min(1), preference: z.enum(["active", "negativeComments", "allComments", "syncFailures", "publishedReplies"]), value: z.boolean() })
  ,z.object({ action: z.literal("remove_alert_email"), recipientId: z.string().min(1) })
  ,z.object({ action: z.literal("regenerate_draft"), commentId: z.string().min(1) })
  ,z.object({ action: z.literal("regenerate_drafts"), commentIds: z.array(z.string().min(1)).min(1).max(50) })
]);

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const catalog = url.searchParams.get("catalog");
  if (catalog === "accounts") {
    const connections = await listWorkspaceMetaTokens(api.workspaceId);
    const token = connections[0]?.token ?? null;
    if (!token) throw new ApiError(400, "meta_not_connected", "Meta no está conectado");
    const results = await Promise.allSettled(connections.map(async (connection) => (await metaAdsListAdAccounts(api.workspaceId, { META_ADS_TOKEN: connection.token })).map((account: any) => ({ ...account, connectionId: connection.id, connectionName: connection.displayName || connection.metaUserId || "Cuenta Meta" }))));
    const combined = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    return NextResponse.json({ items: [...new Map(combined.map((item: any) => [item.id, item])).values()], connections: connections.map(({ token: _token, ...connection }) => connection) });
  }
  if (catalog === "campaigns") {
    const accountId = url.searchParams.get("accountId");
    if (!accountId || !/^act_\d+$/.test(accountId)) throw new ApiError(400, "invalid_account", "Cuenta publicitaria no válida");
    const token = await readMetaTokenByConnection(api.workspaceId, url.searchParams.get("connectionId"));
    if (!token) throw new ApiError(400, "meta_not_connected", "Meta no está conectado");
    // `status` is the filter accepted by the campaigns edge for the switch
    // displayed by Ads Manager. `effective_status` included paused campaigns,
    // while filtering on `configured_status` returned an empty catalogue.
      const campaigns = await metaAdsListCampaigns({ workspaceId: api.workspaceId, status: "ACTIVE", statusField: "effective_status", limit: 500, adhoc: { META_ADS_TOKEN: token, META_ADS_AD_ACCOUNT_ID: accountId } });
    const now = Date.now();
    const items = campaigns.filter((campaign: { configured_status?: string; start_time?: string; stop_time?: string }) => {
      const startsAt = campaign.start_time ? Date.parse(campaign.start_time) : null;
      const stopsAt = campaign.stop_time ? Date.parse(campaign.stop_time) : null;
      return campaign.configured_status === "ACTIVE"
        && (!startsAt || Number.isNaN(startsAt) || startsAt <= now)
        && (!stopsAt || Number.isNaN(stopsAt) || stopsAt >= now);
    });
    return NextResponse.json({ items });
  }
  const items = await prisma.metaAdComment.findMany({ where: { workspaceId: api.workspaceId, deletedAt: null }, include: { feed: { select: { clientName: true, displayName: true, adAccountName: true, campaignId: true, campaignName: true } } }, orderBy: { commentCreatedAt: "desc" }, take: 300 });
  const feeds = await prisma.metaCommentFeed.findMany({ where: { workspaceId: api.workspaceId }, orderBy: { createdAt: "desc" } });
  const alertRecipients = await prisma.metaCommentAlertRecipient.findMany({ where: { workspaceId: api.workspaceId }, select: { id: true, email: true, active: true, negativeComments: true, allComments: true, syncFailures: true, publishedReplies: true }, orderBy: { email: "asc" } });
  return NextResponse.json({ items, feeds, alertRecipients });
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
    const feed = await prisma.metaCommentFeed.upsert({ where: { workspaceId_campaignId: { workspaceId: api.workspaceId, campaignId: parsed.data.campaignId } }, create: { workspaceId: api.workspaceId, campaignId: parsed.data.campaignId, clientName: parsed.data.accountName, campaignName: parsed.data.campaignName, adAccountId: parsed.data.accountId, adAccountName: parsed.data.accountName, metaConnectionId: parsed.data.connectionId }, update: { active: true, campaignName: parsed.data.campaignName, adAccountId: parsed.data.accountId, adAccountName: parsed.data.accountName, metaConnectionId: parsed.data.connectionId } });
    return NextResponse.json({ ok: true, feed });
  }
  if (parsed.data.action === "unmonitor") {
    await prisma.metaCommentFeed.updateMany({ where: { workspaceId: api.workspaceId, campaignId: parsed.data.campaignId }, data: { active: false } });
    return NextResponse.json({ ok: true });
  }
  if (parsed.data.action === "monitor_many") {
    const bulk = parsed.data;
    await prisma.$transaction(bulk.campaigns.map((campaign) => prisma.metaCommentFeed.upsert({ where: { workspaceId_campaignId: { workspaceId: api.workspaceId, campaignId: campaign.id } }, create: { workspaceId: api.workspaceId, campaignId: campaign.id, clientName: bulk.accountName, campaignName: campaign.name, adAccountId: bulk.accountId, adAccountName: bulk.accountName, metaConnectionId: bulk.connectionId }, update: { active: true, campaignName: campaign.name, adAccountId: bulk.accountId, adAccountName: bulk.accountName, metaConnectionId: bulk.connectionId } })));
    return NextResponse.json({ ok: true, selected: bulk.campaigns.length });
  }
  if (parsed.data.action === "rename_client") {
    const renamed = await prisma.metaCommentFeed.updateMany({ where: { workspaceId: api.workspaceId, campaignId: { in: parsed.data.campaignIds } }, data: { displayName: parsed.data.displayName } });
    if (renamed.count === 0) throw new ApiError(404, "not_found", "No se encontraron campañas de ese cliente");
    await auditFromReq(req, api, { action: "meta_comments.client_rename", targetType: "META_COMMENT_CLIENT", targetId: parsed.data.campaignIds.join(","), meta: { displayName: parsed.data.displayName, campaigns: renamed.count } });
    return NextResponse.json({ ok: true, updated: renamed.count });
  }
  if (parsed.data.action === "set_client_ai_context") {
    const updated = await prisma.metaCommentFeed.updateMany({
      where: { workspaceId: api.workspaceId, campaignId: { in: parsed.data.campaignIds } },
      data: { aiContext: parsed.data.aiContext || null }
    });
    if (updated.count === 0) throw new ApiError(404, "not_found", "No se encontraron campañas de ese cliente");
    await auditFromReq(req, api, { action: "meta_comments.client_ai_context_update", targetType: "META_COMMENT_CLIENT", targetId: parsed.data.campaignIds.join(","), meta: { campaigns: updated.count, configured: Boolean(parsed.data.aiContext) } });
    return NextResponse.json({ ok: true, updated: updated.count });
  }
  if (parsed.data.action === "add_alert_email") {
    const email = parsed.data.email.toLocaleLowerCase("es-ES");
    const recipient = await prisma.metaCommentAlertRecipient.upsert({
      where: { workspaceId_email: { workspaceId: api.workspaceId, email } },
      create: { workspaceId: api.workspaceId, email },
      update: { active: true },
      select: { id: true, email: true, active: true, negativeComments: true, allComments: true, syncFailures: true, publishedReplies: true }
    });
    await auditFromReq(req, api, { action: "meta_comments.alert_email_add", targetType: "META_COMMENT_ALERT_RECIPIENT", targetId: recipient.id, meta: { email } });
    return NextResponse.json({ ok: true, recipient });
  }
  if (parsed.data.action === "set_alert_email") {
    const updated = await prisma.metaCommentAlertRecipient.updateMany({ where: { id: parsed.data.recipientId, workspaceId: api.workspaceId }, data: { [parsed.data.preference]: parsed.data.value } });
    if (!updated.count) throw new ApiError(404, "not_found", "Destinatario no encontrado");
    await auditFromReq(req, api, { action: "meta_comments.alert_email_toggle", targetType: "META_COMMENT_ALERT_RECIPIENT", targetId: parsed.data.recipientId, meta: { preference: parsed.data.preference, value: parsed.data.value } });
    return NextResponse.json({ ok: true });
  }
  if (parsed.data.action === "remove_alert_email") {
    const removed = await prisma.metaCommentAlertRecipient.deleteMany({ where: { id: parsed.data.recipientId, workspaceId: api.workspaceId } });
    if (!removed.count) throw new ApiError(404, "not_found", "Destinatario no encontrado");
    await auditFromReq(req, api, { action: "meta_comments.alert_email_remove", targetType: "META_COMMENT_ALERT_RECIPIENT", targetId: parsed.data.recipientId });
    return NextResponse.json({ ok: true });
  }
  if (parsed.data.action === "regenerate_draft") {
    const comment = await prisma.metaAdComment.findFirst({
      where: { id: parsed.data.commentId, workspaceId: api.workspaceId, deletedAt: null },
      include: { feed: { select: { clientName: true, displayName: true, campaignName: true, aiContext: true } } }
    });
    if (!comment) throw new ApiError(404, "not_found", "Comentario no encontrado");
    const draft = await regenerateMetaCommentDraft(api.workspaceId, comment);
    await prisma.metaAdComment.update({ where: { id: comment.id }, data: { aiDraft: draft } });
    return NextResponse.json({ ok: true, draft });
  }
  if (parsed.data.action === "regenerate_drafts") {
    const commentIds = [...new Set(parsed.data.commentIds)];
    const comments = await prisma.metaAdComment.findMany({
      where: { id: { in: commentIds }, workspaceId: api.workspaceId, deletedAt: null },
      include: { feed: { select: { clientName: true, displayName: true, campaignName: true, aiContext: true } } }
    });
    const drafts: Record<string, string> = {};
    const foundIds = new Set(comments.map((comment) => comment.id));
    const failedIds = commentIds.filter((id) => !foundIds.has(id));
    for (let offset = 0; offset < comments.length; offset += 5) {
      await Promise.all(comments.slice(offset, offset + 5).map(async (comment) => {
        try {
          const draft = await regenerateMetaCommentDraft(api.workspaceId, comment);
          await prisma.metaAdComment.update({ where: { id: comment.id }, data: { aiDraft: draft } });
          drafts[comment.id] = draft;
        } catch {
          failedIds.push(comment.id);
        }
      }));
    }
    return NextResponse.json({ ok: true, drafts, failedIds });
  }
  if (parsed.data.action === "delete_comment" || parsed.data.action === "block_author") {
    const moderation = parsed.data;
    const comment = await prisma.metaAdComment.findFirst({ where: { id: moderation.commentId, workspaceId: api.workspaceId, deletedAt: null }, include: { feed: { select: { metaConnectionId: true } } } });
    if (!comment) throw new ApiError(404, "not_found", "Comentario no encontrado");
    if (moderation.action === "delete_comment") {
      await deleteMetaComment(api.workspaceId, comment.externalCommentId, comment.postId, comment.platform, comment.feed.metaConnectionId);
      await prisma.metaAdComment.update({ where: { id: comment.id }, data: { deletedAt: new Date(), status: "deleted" } });
      await auditFromReq(req, api, { action: "meta_comment.delete", targetType: "META_COMMENT", targetId: comment.id, meta: { externalCommentId: comment.externalCommentId, platform: comment.platform } });
      return NextResponse.json({ ok: true });
    }
    if (!comment.authorId) throw new ApiError(409, "author_unavailable", "Meta no ha proporcionado la identidad del autor; no se puede bloquear con seguridad");
    await blockMetaCommentAuthor(api.workspaceId, comment.authorId, comment.postId, comment.platform, comment.feed.metaConnectionId);
    await prisma.metaAdComment.updateMany({ where: { workspaceId: api.workspaceId, authorId: comment.authorId }, data: { authorBlockedAt: new Date() } });
    await auditFromReq(req, api, { action: "meta_comment.author_block", targetType: "META_COMMENT_AUTHOR", targetId: comment.authorId, meta: { commentId: comment.id, platform: comment.platform } });
    return NextResponse.json({ ok: true });
  }
  const comment = await prisma.metaAdComment.findFirst({ where: { id: parsed.data.commentId, workspaceId: api.workspaceId }, include: { feed: { select: { metaConnectionId: true } } } });
  if (!comment) throw new ApiError(404, "not_found", "Comentario no encontrado");
  const replyId = await replyToMetaComment(api.workspaceId, comment.externalCommentId, parsed.data.message, comment.postId, comment.platform, comment.feed.metaConnectionId);
  await prisma.metaAdComment.update({ where: { id: comment.id }, data: { status: "replied", repliedAt: new Date(), externalReplyId: replyId, aiDraft: parsed.data.message } });
  await notifyMetaOperational(api.workspaceId, "publishedReplies", "✅ Respuesta publicada en Meta", `${comment.authorName ?? "Usuario de Meta"}: ${parsed.data.message.slice(0, 800)}`).catch(() => {});
  return NextResponse.json({ ok: true, replyId });
});
