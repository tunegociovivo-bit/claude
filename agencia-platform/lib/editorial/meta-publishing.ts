import { prisma } from "@/lib/db/prisma";
import { readMetaTokenByConnection } from "@/lib/meta/connection";
import { parseMediaUrls } from "./media";
import { resignUrlLong } from "@/lib/storage/resign";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

type Network = "facebook" | "instagram";

function parseNetworks(value: string | null | undefined): Network[] {
  const parsed = parseMediaUrls(value).map((item) => item.toLowerCase());
  return parsed.filter((item): item is Network => item === "facebook" || item === "instagram");
}

function contentForNetwork(post: { content: string | null; copyByNetwork: any; hashtags: string | null }, network: Network): string {
  const fromMap = post.copyByNetwork && typeof post.copyByNetwork === "object" ? post.copyByNetwork[network] : null;
  return [typeof fromMap === "string" && fromMap.trim() ? fromMap.trim() : post.content ?? "", post.hashtags ?? ""]
    .filter((part) => part.trim())
    .join("\n\n")
    .trim();
}

function externalPermalink(network: Network, id: string | null | undefined): string | null {
  if (!id) return null;
  if (network === "facebook") return `https://www.facebook.com/${id}`;
  return `https://www.instagram.com/p/${id}/`;
}

function isVideoUrl(url: string): boolean {
  try {
    return /\.mp4$/i.test(new URL(url).pathname);
  } catch {
    return /\.mp4(\?|$)/i.test(url);
  }
}

async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error?.message ?? `Meta Graph ${resp.status}`);
  return json as T;
}

async function graphPost<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(params);
  body.set("access_token", token);
  const resp = await fetch(`${GRAPH_BASE}/${path.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(60000)
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error?.message ?? `Meta Graph ${resp.status}`);
  return json as T;
}

async function resolvePageToken(profile: { facebookPageId: string | null; metaConnectionId: string | null }, workspaceId: string) {
  const userToken = await readMetaTokenByConnection(workspaceId, profile.metaConnectionId);
  if (!userToken) throw new Error("No hay conexión Meta vigente para este cliente.");
  if (!profile.facebookPageId) return { userToken, pageToken: userToken };
  const data = await graphGet<{ access_token?: string }>(`${profile.facebookPageId}`, userToken, { fields: "access_token" });
  return { userToken, pageToken: data.access_token ?? userToken };
}

export async function listEditorialMetaProfiles(workspaceId: string, clientId?: string | null) {
  return prisma.editorialMetaProfile.findMany({
    where: { workspaceId, ...(clientId ? { clientId } : {}) },
    include: { metaConnection: { select: { id: true, displayName: true, metaUserId: true, expiresAt: true } } },
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }]
  });
}

export async function upsertEditorialMetaProfile(opts: {
  workspaceId: string;
  clientId: string;
  metaConnectionId?: string | null;
  label: string;
  facebookPageId?: string | null;
  facebookPageName?: string | null;
  instagramUserId?: string | null;
  instagramName?: string | null;
  active?: boolean;
}) {
  const client = await prisma.client.findFirst({ where: { id: opts.clientId, workspaceId: opts.workspaceId } });
  if (!client) throw new Error("Cliente no encontrado");
  if (opts.metaConnectionId) {
    const connection = await prisma.metaConnection.findFirst({ where: { id: opts.metaConnectionId, workspaceId: opts.workspaceId } });
    if (!connection) throw new Error("Conexión Meta no encontrada");
  }
  return prisma.editorialMetaProfile.create({
    data: {
      workspaceId: opts.workspaceId,
      clientId: opts.clientId,
      metaConnectionId: opts.metaConnectionId ?? null,
      label: opts.label.trim() || opts.facebookPageName || opts.instagramName || client.name,
      facebookPageId: opts.facebookPageId ?? null,
      facebookPageName: opts.facebookPageName ?? null,
      instagramUserId: opts.instagramUserId ?? null,
      instagramName: opts.instagramName ?? null,
      active: opts.active ?? true
    }
  });
}

export async function prepareEditorialPublications(opts: {
  workspaceId: string;
  postId: string;
  profileId?: string | null;
  networks?: Network[];
  schedule?: boolean;
}) {
  const post = await prisma.editorialPost.findFirst({ where: { id: opts.postId, workspaceId: opts.workspaceId } });
  if (!post) throw new Error("Publicación no encontrada");
  if (!post.clientId) throw new Error("La publicación no tiene cliente asociado.");
  const profile = opts.profileId
    ? await prisma.editorialMetaProfile.findFirst({ where: { id: opts.profileId, workspaceId: opts.workspaceId, clientId: post.clientId, active: true } })
    : await prisma.editorialMetaProfile.findFirst({ where: { workspaceId: opts.workspaceId, clientId: post.clientId, active: true }, orderBy: { updatedAt: "desc" } });
  if (!profile) throw new Error("Este cliente no tiene perfil Meta activo.");
  const networks = opts.networks?.length ? opts.networks : parseNetworks(post.networks);
  const supported = networks.filter((network) => (network === "facebook" ? profile.facebookPageId : profile.instagramUserId));
  if (supported.length === 0) throw new Error("Selecciona Facebook o Instagram y vincula la cuenta correspondiente.");
  const rows = [];
  for (const network of supported) {
    const row = await prisma.editorialPublication.upsert({
      where: { workspaceId_idempotencyKey: { workspaceId: opts.workspaceId, idempotencyKey: `${post.id}:${profile.id}:${network}` } },
      create: {
        workspaceId: opts.workspaceId,
        postId: post.id,
        profileId: profile.id,
        network,
        status: opts.schedule ? "SCHEDULED" : "PENDING",
        scheduledFor: opts.schedule ? post.scheduledFor : null,
        idempotencyKey: `${post.id}:${profile.id}:${network}`
      },
      update: {
        profileId: profile.id,
        status: opts.schedule ? "SCHEDULED" : "PENDING",
        scheduledFor: opts.schedule ? post.scheduledFor : null,
        lastError: null
      }
    });
    rows.push(row);
  }
  await prisma.editorialPost.update({
    where: { id: post.id },
    data: { status: opts.schedule ? "SCHEDULED" : post.status === "DRAFT" ? "APPROVED" : post.status }
  });
  return rows;
}

async function publishFacebook(opts: { token: string; pageId: string; message: string; imageUrl?: string | null; videoUrl?: string | null }) {
  if (opts.videoUrl) {
    return graphPost<{ id: string }>(`${opts.pageId}/videos`, opts.token, {
      file_url: opts.videoUrl,
      description: opts.message,
      published: "true"
    });
  }
  if (opts.imageUrl) {
    return graphPost<{ id: string; post_id?: string }>(`${opts.pageId}/photos`, opts.token, {
      url: opts.imageUrl,
      caption: opts.message,
      published: "true"
    });
  }
  return graphPost<{ id: string }>(`${opts.pageId}/feed`, opts.token, { message: opts.message });
}

async function publishInstagram(opts: { token: string; igUserId: string; caption: string; imageUrl?: string | null; videoUrl?: string | null }) {
  if (!opts.imageUrl && !opts.videoUrl) throw new Error("Instagram requiere imagen o vídeo.");
  const create = await graphPost<{ id: string }>(`${opts.igUserId}/media`, opts.token, {
    ...(opts.videoUrl ? { media_type: "REELS", video_url: opts.videoUrl } : { image_url: opts.imageUrl! }),
    caption: opts.caption
  });
  return graphPost<{ id: string }>(`${opts.igUserId}/media_publish`, opts.token, { creation_id: create.id });
}

export async function publishEditorialPublication(workspaceId: string, publicationId: string) {
  const publication = await prisma.editorialPublication.findFirst({
    where: { id: publicationId, workspaceId },
    include: { post: true, profile: true }
  });
  if (!publication) throw new Error("Publicación Meta no encontrada");
  if (!publication.profile) throw new Error("El perfil Meta ya no está disponible.");
  if (publication.status === "PUBLISHED") return publication;
  await prisma.editorialPublication.update({
    where: { id: publication.id },
    data: { status: "PUBLISHING", attempts: { increment: 1 }, lastError: null }
  });
  try {
    const profile = publication.profile;
    const network = publication.network as Network;
    const { pageToken } = await resolvePageToken(profile, workspaceId);
    const message = contentForNetwork(publication.post, network);
    const mediaUrls = parseMediaUrls(publication.post.mediaUrls);
    const rawVideoUrl = mediaUrls.find(isVideoUrl) ?? null;
    const rawImageUrl = publication.post.thumbnail ?? mediaUrls.find((url) => !isVideoUrl(url)) ?? null;
    const videoUrl = await resignUrlLong(rawVideoUrl);
    const imageUrl = await resignUrlLong(rawImageUrl);
    const prefersVideo = ["reel", "story", "video"].some((part) => String(publication.post.format ?? "").toLowerCase().includes(part));
    const result =
      network === "facebook"
        ? await publishFacebook({ token: pageToken, pageId: profile.facebookPageId!, message, imageUrl, videoUrl: prefersVideo ? videoUrl : null })
        : await publishInstagram({ token: pageToken, igUserId: profile.instagramUserId!, caption: message, imageUrl: prefersVideo ? null : imageUrl, videoUrl: prefersVideo ? videoUrl : null });
    const externalPostId = (result as any).post_id ?? (result as any).id ?? null;
    const updated = await prisma.editorialPublication.update({
      where: { id: publication.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        externalPostId,
        externalUrl: externalPermalink(network, externalPostId),
        lastError: null
      }
    });
    const remaining = await prisma.editorialPublication.count({
      where: { postId: publication.postId, workspaceId, status: { not: "PUBLISHED" } }
    });
    if (remaining === 0) {
      await prisma.editorialPost.update({ where: { id: publication.postId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    }
    return updated;
  } catch (error: any) {
    await prisma.editorialPublication.update({
      where: { id: publication.id },
      data: { status: "FAILED", lastError: String(error?.message ?? error).slice(0, 1000) }
    });
    throw error;
  }
}

export async function publishScheduledEditorialMetaPublications(limit = 10) {
  const due = await prisma.editorialPublication.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: { id: true, workspaceId: true }
  });
  let published = 0;
  let failed = 0;
  for (const item of due) {
    const claimed = await prisma.editorialPublication.updateMany({
      where: { id: item.id, workspaceId: item.workspaceId, status: "SCHEDULED" },
      data: { status: "PUBLISHING" }
    });
    if (claimed.count === 0) continue;
    try {
      await publishEditorialPublication(item.workspaceId, item.id);
      published++;
    } catch {
      failed++;
    }
  }
  return { due: due.length, published, failed };
}

export async function publishDueEditorialPublications(opts: { limit?: number } = {}) {
  const now = new Date();
  const due = await prisma.editorialPublication.findMany({
    where: { status: "SCHEDULED", scheduledFor: { not: null, lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: opts.limit ?? 50
  });
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const item of due) {
    try {
      await publishEditorialPublication(item.workspaceId, item.id);
      results.push({ id: item.id, ok: true });
    } catch (error: any) {
      results.push({ id: item.id, ok: false, error: String(error?.message ?? error).slice(0, 300) });
    }
  }
  return { due: due.length, results };
}
