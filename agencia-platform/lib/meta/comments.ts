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

async function graphAll(workspaceId: string, path: string, explicitToken?: string, maxItems = 5000): Promise<any[]> {
  const found: any[] = [];
  let nextPath: string | null = path;
  let pages = 0;
  while (nextPath && found.length < maxItems && pages < 100) {
    const result = await graph(workspaceId, nextPath, undefined, explicitToken);
    found.push(...(result.data ?? []));
    const next = result.paging?.next;
    if (!next) break;
    const url = new URL(next);
    if (url.hostname !== "graph.facebook.com") throw new Error("Meta devolvió una paginación no válida");
    url.searchParams.delete("access_token");
    nextPath = `${url.pathname.replace(/^\/v\d+\.\d+\//, "")}${url.search}`;
    pages++;
  }
  return found.slice(0, maxItems);
}

async function pageTokens(workspaceId: string): Promise<{ facebook: Map<string, string>; instagram: Map<string, string> }> {
  const userToken = await readWorkspaceMetaToken(workspaceId);
  if (!userToken) return { facebook: new Map(), instagram: new Map() };
  const pages = await graphAll(workspaceId, "me/accounts?fields=id,access_token,instagram_business_account{id}&limit=100", userToken, 1000);
  const facebook = new Map<string, string>(); const instagram = new Map<string, string>();
  for (const page of pages) {
    if (!page.id || !page.access_token) continue;
    facebook.set(String(page.id), String(page.access_token));
    if (page.instagram_business_account?.id) instagram.set(String(page.instagram_business_account.id), String(page.access_token));
  }
  return { facebook, instagram };
}

type Range = { from: Date; to: Date };
type Analysis = { id: string; sentiment: string; reason: string; draft: string };

async function analyzeComments(workspaceId: string, clientName: string, comments: any[]) {
  const analyses = new Map<string, Analysis>();
  for (let offset = 0; offset < comments.length; offset += 15) {
    const batch = comments.slice(offset, offset + 15);
    const result = await completeJson<{ items: Analysis[] }>({
      workspaceId, model: "claude-haiku-4-5-20251001",
      system: "Clasifica cada comentario de anuncio como positive, neutral o negative y redacta una respuesta breve en español de España. Para negativos: empatía, no discutir y ofrecer resolver por privado. No inventes datos. Devuelve todos los ids recibidos en JSON.",
      user: `Cliente: ${clientName}\nComentarios:\n${batch.map((item) => `${item.id}: ${item.message}`).join("\n")}`,
      schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, reason: { type: "string" }, draft: { type: "string" } }, required: ["id", "sentiment", "reason", "draft"] } } }, required: ["items"] },
      maxTokens: 2500
    });
    for (const analysis of result.items ?? []) analyses.set(String(analysis.id), analysis);
  }
  return analyses;
}

export async function syncMetaCampaignComments(workspaceId: string, campaignId: string, clientName: string, range?: Range) {
  const feed = await prisma.metaCommentFeed.upsert({
    where: { workspaceId_campaignId: { workspaceId, campaignId } },
    create: { workspaceId, campaignId, clientName }, update: { clientName, active: true }
  });
  try {
    const ads = await graphAll(workspaceId, `${campaignId}/ads?fields=id,name,creative{effective_object_story_id,effective_instagram_story_id,instagram_actor_id}&limit=100`, undefined, 2000);
    const authorizedPages = await pageTokens(workspaceId);
    const discovered: any[] = [];
    for (const ad of ads) {
      const rangeQuery = range ? `&since=${Math.floor(range.from.getTime() / 1000)}&until=${Math.floor(range.to.getTime() / 1000)}` : "";
      const targets = [
        ad?.creative?.effective_object_story_id ? { id: String(ad.creative.effective_object_story_id), platform: "facebook", token: authorizedPages.facebook.get(String(ad.creative.effective_object_story_id).split("_")[0]) } : null,
        ad?.creative?.effective_instagram_story_id ? { id: String(ad.creative.effective_instagram_story_id), platform: "instagram", token: authorizedPages.instagram.get(String(ad.creative.instagram_actor_id ?? "")) } : null
      ].filter(Boolean) as Array<{ id: string; platform: "facebook" | "instagram"; token?: string }>;
      for (const target of targets) {
        const fields = target.platform === "instagram" ? "id,text,username,timestamp" : "id,message,from{id,name},created_time";
        const filter = target.platform === "facebook" ? "&filter=stream" : "";
        const comments = await graphAll(workspaceId, `${target.id}/comments?fields=${fields}&limit=100${filter}${rangeQuery}`, target.token, 5000);
        for (const raw of comments) {
          const comment = target.platform === "instagram" ? { ...raw, message: raw.text ?? "", from: { id: null, name: raw.username ?? null }, created_time: raw.timestamp } : raw;
          const createdAt = new Date(comment.created_time);
          if (range && (createdAt < range.from || createdAt > range.to)) continue;
          discovered.push({ ...comment, postId: target.id, platform: target.platform, adId: ad.id, adName: ad.name });
        }
      }
    }
    const unique = [...new Map(discovered.map((item) => [String(item.id), item])).values()];
    const existing = unique.length ? await prisma.metaAdComment.findMany({ where: { workspaceId, externalCommentId: { in: unique.map((item) => String(item.id)) } }, select: { externalCommentId: true } }) : [];
    const existingIds = new Set(existing.map((item) => item.externalCommentId));
    const pending = unique.filter((item) => !existingIds.has(String(item.id)));
    const processing = pending.slice(0, 50);
    const analyses = await analyzeComments(workspaceId, clientName, processing);
    let created = 0;
    for (const item of processing) {
      const analysis = analyses.get(String(item.id)) ?? { id: String(item.id), sentiment: "neutral", reason: "Pendiente de revisión", draft: "Gracias por tu comentario. ¿Podemos ayudarte con alguna duda?" };
      const row = await prisma.metaAdComment.create({ data: {
        workspaceId, feedId: feed.id, externalCommentId: String(item.id), postId: item.postId, platform: item.platform ?? "facebook",
        adId: item.adId, adName: item.adName, authorName: item.from?.name ?? null, authorId: item.from?.id ?? null,
        message: item.message ?? "", sentiment: analysis.sentiment, sentimentReason: analysis.reason?.slice(0, 300),
        aiDraft: analysis.draft?.slice(0, 2000), commentCreatedAt: new Date(item.created_time)
      }});
      created++;
      if (row.sentiment === "negative") await notifyNegative(workspaceId, row.id, clientName, row.authorName, row.message);
    }
    await prisma.metaCommentFeed.update({ where: { id: feed.id }, data: { lastSyncAt: new Date(), lastError: null } });
    return { discovered: unique.length, created, remaining: Math.max(0, pending.length - processing.length) };
  } catch (error: any) {
    await prisma.metaCommentFeed.update({ where: { id: feed.id }, data: { lastSyncAt: new Date(), lastError: String(error?.message ?? error).slice(0, 2000) } });
    throw error;
  }
}

async function notifyNegative(workspaceId: string, commentId: string, clientName: string, author: string | null, message: string) {
  const admins = await prisma.membership.findMany({ where: { workspaceId, role: "ADMIN" }, select: { userId: true } });
  await prisma.notification.createMany({ data: admins.map(({ userId }) => ({ userId, type: "meta_negative_comment", body: `⚠️ Comentario negativo en campaña de ${clientName} (${author ?? "usuario"}): ${message.slice(0, 180)}`, link: `/admin/meta-comments?comment=${commentId}` })) });
  const { sendPushToUser } = await import("@/lib/push/web-push");
  await Promise.all(admins.map(({ userId }) => sendPushToUser(userId, { title: `Comentario negativo · ${clientName}`, body: `${author ?? "Usuario"}: ${message.slice(0, 160)}`, link: `/admin/meta-comments?comment=${commentId}`, tag: `meta-negative-${commentId}` }).catch(() => {})));
}

export async function syncAllActiveMetaCommentFeeds() {
  const feeds = await prisma.metaCommentFeed.findMany({ where: { active: true }, select: { workspaceId: true, campaignId: true, clientName: true } });
  let created = 0; let failed = 0;
  for (const feed of feeds) {
    try { created += (await syncMetaCampaignComments(feed.workspaceId, feed.campaignId, feed.clientName)).created; }
    catch { failed++; }
  }
  return { feeds: feeds.length, created, failed };
}

export async function replyToMetaComment(workspaceId: string, externalCommentId: string, message: string, postId?: string | null, platform = "facebook") {
  const body = new URLSearchParams({ message });
  const pageId = postId ? postId.split("_")[0] : null;
  const tokens = await pageTokens(workspaceId);
  const token = pageId && platform === "facebook" ? tokens.facebook.get(pageId) : undefined;
  const edge = platform === "instagram" ? "replies" : "comments";
  const result = await graph(workspaceId, `${externalCommentId}/${edge}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, token);
  return String(result.id ?? "");
}
