import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { readWorkspaceMetaToken } from "@/lib/meta/connection";

const GRAPH = "https://graph.facebook.com/v19.0";

async function graph(workspaceId: string, path: string, init?: RequestInit, explicitToken?: string) {
  const token = explicitToken ?? await readWorkspaceMetaToken(workspaceId);
  if (!token) throw new Error("No hay conexión Meta activa en el workspace.");
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${GRAPH}/${path}${separator}access_token=${encodeURIComponent(token)}`, { ...init, cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta ${response.status} en ${path.split("?")[0]}: ${json?.error?.message ?? "error desconocido"}`);
  return json;
}

async function pageTokens(workspaceId: string): Promise<Map<string, string>> {
  const userToken = await readWorkspaceMetaToken(workspaceId);
  if (!userToken) return new Map();
  const pages = await graph(workspaceId, "me/accounts?fields=id,access_token&limit=100", undefined, userToken);
  return new Map((pages.data ?? []).filter((page: any) => page.id && page.access_token).map((page: any) => [String(page.id), String(page.access_token)]));
}

export async function syncMetaCampaignComments(workspaceId: string, campaignId: string, clientName: string) {
  const feed = await prisma.metaCommentFeed.upsert({
    where: { workspaceId_campaignId: { workspaceId, campaignId } },
    create: { workspaceId, campaignId, clientName }, update: { clientName, active: true }
  });
  try {
    const ads = await graph(workspaceId, `${campaignId}/ads?fields=id,name,creative{effective_object_story_id}&limit=100`);
    const authorizedPages = await pageTokens(workspaceId);
    const discovered: any[] = [];
    for (const ad of ads.data ?? []) {
      const postId = ad?.creative?.effective_object_story_id;
      if (!postId) continue;
      const pageId = String(postId).split("_")[0];
      const comments = await graph(workspaceId, `${postId}/comments?fields=id,message,from{id,name},created_time&filter=stream&limit=100`, undefined, authorizedPages.get(pageId));
      for (const comment of comments.data ?? []) discovered.push({ ...comment, postId, adId: ad.id, adName: ad.name });
    }
    let created = 0;
    for (const item of discovered) {
      const exists = await prisma.metaAdComment.findUnique({ where: { workspaceId_externalCommentId: { workspaceId, externalCommentId: item.id } } });
      if (exists) continue;
      const analysis = await completeJson<{ sentiment: string; reason: string; draft: string }>({
        workspaceId, model: "claude-haiku-4-5-20251001",
        system: "Clasifica un comentario de anuncio como positive, neutral o negative y redacta una respuesta breve en español de España. Para negativos: empatía, no discutir, ofrecer resolver por privado. No inventes datos. Devuelve JSON.",
        user: `Cliente: ${clientName}\nComentario: ${item.message}`,
        schema: { type: "object", properties: { sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, reason: { type: "string" }, draft: { type: "string" } }, required: ["sentiment", "reason", "draft"] }, maxTokens: 350
      });
      const row = await prisma.metaAdComment.create({ data: {
        workspaceId, feedId: feed.id, externalCommentId: item.id, postId: item.postId,
        adId: item.adId, adName: item.adName, authorName: item.from?.name ?? null, authorId: item.from?.id ?? null,
        message: item.message ?? "", sentiment: analysis.sentiment, sentimentReason: analysis.reason?.slice(0, 300),
        aiDraft: analysis.draft?.slice(0, 2000), commentCreatedAt: new Date(item.created_time)
      }});
      created++;
      if (row.sentiment === "negative") await notifyNegative(workspaceId, row.id, clientName, row.authorName, row.message);
    }
    await prisma.metaCommentFeed.update({ where: { id: feed.id }, data: { lastSyncAt: new Date(), lastError: null } });
    return { discovered: discovered.length, created };
  } catch (error: any) {
    await prisma.metaCommentFeed.update({ where: { id: feed.id }, data: { lastSyncAt: new Date(), lastError: String(error?.message ?? error).slice(0, 2000) } });
    throw error;
  }
}

async function notifyNegative(workspaceId: string, commentId: string, clientName: string, author: string | null, message: string) {
  const admins = await prisma.membership.findMany({ where: { workspaceId, role: "ADMIN" }, select: { userId: true } });
  await prisma.notification.createMany({ data: admins.map(({ userId }) => ({
    userId, type: "meta_negative_comment", body: `⚠️ Comentario negativo en campaña de ${clientName} (${author ?? "usuario"}): ${message.slice(0, 180)}`,
    link: `/admin/meta-comments?comment=${commentId}`
  })) });
  const { sendPushToUser } = await import("@/lib/push/web-push");
  await Promise.all(admins.map(({ userId }) => sendPushToUser(userId, {
    title: `Comentario negativo · ${clientName}`,
    body: `${author ?? "Usuario"}: ${message.slice(0, 160)}`,
    link: `/admin/meta-comments?comment=${commentId}`,
    tag: `meta-negative-${commentId}`
  }).catch(() => {})));
}

export async function syncAllActiveMetaCommentFeeds() {
  const feeds = await prisma.metaCommentFeed.findMany({ where: { active: true }, select: { workspaceId: true, campaignId: true, clientName: true } });
  let created = 0;
  let failed = 0;
  for (const feed of feeds) {
    try {
      const result = await syncMetaCampaignComments(feed.workspaceId, feed.campaignId, feed.clientName);
      created += result.created;
    } catch {
      failed++;
    }
  }
  return { feeds: feeds.length, created, failed };
}

export async function replyToMetaComment(workspaceId: string, externalCommentId: string, message: string, postId?: string | null) {
  const body = new URLSearchParams({ message });
  const pageId = postId ? postId.split("_")[0] : null;
  const token = pageId ? (await pageTokens(workspaceId)).get(pageId) : undefined;
  const result = await graph(workspaceId, `${externalCommentId}/comments`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, token);
  return String(result.id ?? "");
}
