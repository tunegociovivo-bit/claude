import { prisma } from "@/lib/db/prisma";
import { readMetaTokenByConnection } from "@/lib/meta/connection";
import { parseMediaUrls } from "./media";
import { resignUrlLong } from "@/lib/storage/resign";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

type Network = "facebook" | "instagram";
function publicationHistory(meta: unknown, status: string) {
  const value = meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
  const history = Array.isArray(value.history) ? value.history : [];
  return { ...value, history: [...history, { status, at: new Date().toISOString() }] } as any;
}

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

export async function editorialGraphGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error?.message ?? `Meta Graph ${resp.status}`);
  return json as T;
}
function mediaIdentity(value: string): string {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value; }
}
const graphGet = editorialGraphGet;

async function graphPost<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(params);
  body.set("access_token", token);
  const publishes = path.endsWith("/media_publish") || path.endsWith("/feed") || path.endsWith("/videos") || (path.endsWith("/photos") && params.published === "true") || (path.endsWith("/video_reels") && params.upload_phase === "finish");
  let resp: Response;
  try { resp = await fetch(`${GRAPH_BASE}/${path.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(60000)
  }); } catch (error) { if (publishes) throw new AmbiguousPublicationError("Meta no confirmó el resultado. Revisa la cuenta antes de volver a publicar."); throw error; }
  const json = await resp.json().catch(() => { if (publishes) throw new AmbiguousPublicationError("Respuesta de Meta incompleta; comprueba la publicación en Meta."); return {}; });
  if (publishes && resp.status >= 500) throw new AmbiguousPublicationError("Meta devolvió un error sin confirmar si publicó. Revisa la cuenta antes de reintentar.");
  if (!resp.ok) throw new Error(json?.error?.message ?? `Meta Graph ${resp.status}`);
  if (publishes && !json.id && !json.post_id && json.success !== true) throw new AmbiguousPublicationError("Meta no devolvió una confirmación válida de publicación.");
  return json as T;
}

async function resolvePageToken(profile: { facebookPageId: string | null; metaConnectionId: string | null }, workspaceId: string) {
  if (!profile.metaConnectionId) throw new Error("Vuelve a conectar la cuenta Meta de este cliente.");
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
  if (!opts.metaConnectionId || !opts.facebookPageId) throw new Error("Selecciona una página autorizada mediante Meta.");
  const token = await readMetaTokenByConnection(opts.workspaceId, opts.metaConnectionId);
  if (!token) throw new Error("La conexión Meta ha caducado. Renueva la vinculación.");
  const page = await graphGet<{ id: string; name: string; instagram_business_account?: { id: string; username?: string } }>(opts.facebookPageId, token, { fields: "id,name,access_token,instagram_business_account{id,username}" });
  opts.facebookPageName = page.name;
  opts.instagramUserId = page.instagram_business_account?.id ?? null;
  opts.instagramName = page.instagram_business_account?.username ?? null;
  const existing = await prisma.editorialMetaProfile.findFirst({ where: { workspaceId: opts.workspaceId, clientId: opts.clientId, facebookPageId: opts.facebookPageId } });
  const data = {
    metaConnectionId: opts.metaConnectionId, label: opts.label.trim() || page.name,
    facebookPageId: opts.facebookPageId, facebookPageName: page.name,
    instagramUserId: opts.instagramUserId, instagramName: opts.instagramName, active: opts.active ?? true
  };
  if (existing) return prisma.editorialMetaProfile.update({ where: { id: existing.id }, data });
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
  mediaUrls?: string[];
}) {
  const post = await prisma.editorialPost.findFirst({ where: { id: opts.postId, workspaceId: opts.workspaceId } });
  if (!post) throw new Error("Publicación no encontrada");
  if (!post.clientId) throw new Error("La publicación no tiene cliente asociado.");
  const isCarousel = ["carrusel", "carousel"].includes(post.format ?? "");
  const allowedMedia = new Map(parseMediaUrls(post.mediaUrls).map((url) => [mediaIdentity(url), url]));
  const requestedMedia = [...new Set((opts.mediaUrls ?? []).map(mediaIdentity))];
  if (requestedMedia.some((url) => !allowedMedia.has(url) || isVideoUrl(url))) throw new Error("Selecciona imágenes de esta publicación.");
  const selectedMedia = requestedMedia.map((identity) => allowedMedia.get(identity)!);
  if (isCarousel && (selectedMedia.length < 2 || selectedMedia.length > 10)) throw new Error("Selecciona entre 2 y 10 imágenes para el carrusel.");
  if (!["APPROVED", "SCHEDULED", "PUBLISHED"].includes(post.status)) throw new Error("Aprueba la publicación antes de programarla o publicarla.");
  if (opts.schedule && (!post.scheduledFor || post.scheduledFor <= new Date())) throw new Error("Elige una fecha y hora futura antes de programar.");
  const profile = opts.profileId
    ? await prisma.editorialMetaProfile.findFirst({ where: { id: opts.profileId, workspaceId: opts.workspaceId, clientId: post.clientId, active: true } })
    : await prisma.editorialMetaProfile.findFirst({ where: { workspaceId: opts.workspaceId, clientId: post.clientId, active: true }, orderBy: { updatedAt: "desc" } });
  if (!profile) throw new Error("Este cliente no tiene perfil Meta activo.");
  const networks = opts.networks?.length ? opts.networks : parseNetworks(post.networks);
  const supported = networks.filter((network) => (network === "facebook" ? profile.facebookPageId : profile.instagramUserId));
  if (supported.length === 0) throw new Error("Selecciona Facebook o Instagram y vincula la cuenta correspondiente.");
  const rows = [];
  for (const network of supported) {
    const existing = await prisma.editorialPublication.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: opts.workspaceId, idempotencyKey: `${post.id}:${profile.id}:${network}` } } });
    if (existing && ["PUBLISHED", "PUBLISHING", "UNKNOWN"].includes(existing.status)) { rows.push(existing); continue; }
    let row = await prisma.editorialPublication.upsert({
      where: { workspaceId_idempotencyKey: { workspaceId: opts.workspaceId, idempotencyKey: `${post.id}:${profile.id}:${network}` } },
      create: {
        workspaceId: opts.workspaceId,
        postId: post.id,
        profileId: profile.id,
        network,
        status: opts.schedule ? "SCHEDULED" : "PENDING",
        scheduledFor: opts.schedule ? post.scheduledFor : null,
        idempotencyKey: `${post.id}:${profile.id}:${network}`
        ,metaJson: publicationHistory({ mediaUrls: selectedMedia }, opts.schedule ? "SCHEDULED" : "PENDING")
      },
      update: {}
    });
    await prisma.editorialPublication.updateMany({ where: { id: row.id, status: { in: ["PENDING", "SCHEDULED", "FAILED", "CANCELLED"] } }, data: { status: opts.schedule ? "SCHEDULED" : "PENDING", scheduledFor: opts.schedule ? post.scheduledFor : null, lastError: null, metaJson: publicationHistory(row.status === "FAILED" ? row.metaJson : { ...(row.metaJson as object || {}), mediaUrls: selectedMedia }, opts.schedule ? "SCHEDULED" : "PENDING") } });
    row = (await prisma.editorialPublication.findUnique({ where: { id: row.id } }))!;
    rows.push(row);
  }
  await prisma.editorialPost.update({
    where: { id: post.id },
    data: { status: opts.schedule && rows.some((row) => row.status === "SCHEDULED") ? "SCHEDULED" : post.status }
  });
  return rows;
}

async function publishFacebook(opts: { token: string; pageId: string; message: string; imageUrl?: string | null; videoUrl?: string | null; images?: string[]; reel?: boolean; story?: boolean }) {
  if (opts.story) throw new Error("Las Stories de Facebook no están disponibles en este flujo. Selecciona Instagram o cambia el formato a Reel.");
  if (opts.reel) {
    if (!opts.videoUrl) throw new Error("Adjunta un vídeo para publicar un Reel.");
    const session = await graphPost<{ video_id: string }>(`${opts.pageId}/video_reels`, opts.token, { upload_phase: "start" });
    const uploaded = await fetch(`https://rupload.facebook.com/video-upload/${GRAPH_VERSION}/${encodeURIComponent(session.video_id)}`, { method: "POST", headers: { Authorization: `OAuth ${opts.token}`, file_url: opts.videoUrl }, signal: AbortSignal.timeout(60000) });
    if (!uploaded.ok) throw new Error("Meta no pudo subir el vídeo del Reel.");
    await graphPost(`${opts.pageId}/video_reels`, opts.token, { upload_phase: "finish", video_id: session.video_id, video_state: "PUBLISHED", description: opts.message });
    return { id: session.video_id };
  }
  if (opts.images && opts.images.length > 1) {
    const attached: Record<string, string> = { message: opts.message };
    for (const [index, url] of opts.images.entries()) {
      const photo = await graphPost<{ id: string }>(`${opts.pageId}/photos`, opts.token, { url, published: "false" });
      attached[`attached_media[${index}]`] = JSON.stringify({ media_fbid: photo.id });
    }
    return graphPost<{ id: string }>(`${opts.pageId}/feed`, opts.token, attached);
  }
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

async function waitForContainer(id: string, token: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const state = await graphGet<{ status_code: string; status?: string }>(id, token, { fields: "status_code,status" });
    if (state.status_code === "FINISHED") return;
    if (["ERROR", "EXPIRED"].includes(state.status_code)) throw new Error(state.status || "Meta no pudo procesar el archivo.");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Meta sigue procesando el archivo; espera unos minutos y reintenta.");
}
class AmbiguousPublicationError extends Error {}

async function publishInstagram(opts: { token: string; igUserId: string; caption: string; imageUrl?: string | null; videoUrl?: string | null; images?: string[]; story?: boolean }) {
  if (!opts.imageUrl && !opts.videoUrl) throw new Error("Instagram requiere imagen o vídeo.");
  const children: string[] = [];
  if (opts.images && opts.images.length > 1) {
    if (opts.images.length > 10) throw new Error("El carrusel de Instagram admite hasta 10 imágenes en este flujo.");
    for (const image of opts.images) {
      const child = await graphPost<{ id: string }>(`${opts.igUserId}/media`, opts.token, { image_url: image, is_carousel_item: "true" });
      await waitForContainer(child.id, opts.token);
      children.push(child.id);
    }
  }
  const create = await graphPost<{ id: string }>(`${opts.igUserId}/media`, opts.token, {
    ...(children.length ? { media_type: "CAROUSEL", children: children.join(",") } : opts.videoUrl ? { media_type: opts.story ? "STORIES" : "REELS", video_url: opts.videoUrl } : { image_url: opts.imageUrl!, ...(opts.story ? { media_type: "STORIES" } : {}) }),
    ...(!opts.story ? { caption: opts.caption } : {})
  });
  await waitForContainer(create.id, opts.token);
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
  if (!publication.profile.active) throw new Error("El perfil Meta está desconectado.");
  if (publication.workspaceId !== workspaceId || publication.post.workspaceId !== workspaceId || publication.profile.workspaceId !== workspaceId || !publication.post.clientId || publication.profile.clientId !== publication.post.clientId) {
    throw new Error("La cuenta Meta ya no corresponde al cliente de esta publicación. Selecciona de nuevo sus destinos.");
  }
  if (!["APPROVED", "SCHEDULED", "PUBLISHED"].includes(publication.post.status)) throw new Error("La publicación debe estar aprobada.");
  const now = new Date();
  const scheduled = publication.status === "SCHEDULED";
  // A due row may have been selected just before the editor moved its date.
  if (scheduled && (!publication.scheduledFor || publication.scheduledFor > now || !publication.post.scheduledFor || publication.post.scheduledFor > now)) return publication;
  const claimed = await prisma.editorialPublication.updateMany({
    where: {
      id: publication.id, workspaceId, updatedAt: publication.updatedAt,
      status: scheduled ? "SCHEDULED" : { in: ["PENDING", "FAILED"] },
      ...(scheduled ? { scheduledFor: { lte: now } } : {}),
      post: { is: { workspaceId, clientId: publication.post.clientId, updatedAt: publication.post.updatedAt, status: { in: ["APPROVED", "SCHEDULED", "PUBLISHED"] }, ...(scheduled ? { scheduledFor: { lte: now } } : {}) } },
      profile: { is: { workspaceId, clientId: publication.post.clientId, active: true } }
    },
    data: { status: "PUBLISHING", attempts: { increment: 1 }, lastError: null, metaJson: publicationHistory(publication.metaJson, "PUBLISHING") }
  });
  if (!claimed.count) return publication;
  let sent = false;
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
    const carousel = ["carrusel", "carousel"].includes(publication.post.format ?? "");
    const savedMedia = (publication.metaJson as { mediaUrls?: string[] } | null)?.mediaUrls ?? [];
    if (carousel && savedMedia.length < 2) throw new Error("Selecciona las imágenes del carrusel antes de publicar.");
    const images = carousel ? (await Promise.all(savedMedia.map(resignUrlLong))).filter((url): url is string => !!url) : undefined;
    const prefersVideo = ["reel", "story", "video"].some((part) => String(publication.post.format ?? "").toLowerCase().includes(part));
    const result =
      network === "facebook"
        ? await publishFacebook({ token: pageToken, pageId: profile.facebookPageId!, message, imageUrl, images, reel: publication.post.format === "reel", story: publication.post.format === "story", videoUrl: prefersVideo ? videoUrl : null })
        : await publishInstagram({ token: pageToken, igUserId: profile.instagramUserId!, caption: message, images, story: publication.post.format === "story", imageUrl: videoUrl && prefersVideo ? null : imageUrl, videoUrl: prefersVideo ? videoUrl : null });
    sent = true;
    const externalPostId = (result as any).post_id ?? (result as any).id ?? null;
    let externalUrl: string | null = network === "facebook" ? externalPermalink(network, externalPostId) : null;
    try {
      const link = await graphGet<{ permalink?: string; permalink_url?: string }>(externalPostId, pageToken, { fields: network === "instagram" ? "permalink" : "permalink_url" });
      externalUrl = link.permalink || link.permalink_url || externalUrl;
    } catch { /* The remote post is successful even if its permalink is not yet available. */ }
    const updated = await prisma.editorialPublication.update({
      where: { id: publication.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        externalPostId,
        externalUrl,
        metaJson: publicationHistory(publicationHistory(publication.metaJson, "PUBLISHING"), "PUBLISHED"),
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
      data: { status: sent || error instanceof AmbiguousPublicationError ? "UNKNOWN" : "FAILED", lastError: String(error?.message ?? error).slice(0, 1000), metaJson: publicationHistory(publicationHistory(publication.metaJson, "PUBLISHING"), sent || error instanceof AmbiguousPublicationError ? "UNKNOWN" : "FAILED") }
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
    try {
      const result = await publishEditorialPublication(item.workspaceId, item.id);
      if (result.status === "PUBLISHED") published++;
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
      const result = await publishEditorialPublication(item.workspaceId, item.id);
      results.push({ id: item.id, ok: result.status === "PUBLISHED" });
    } catch (error: any) {
      results.push({ id: item.id, ok: false, error: String(error?.message ?? error).slice(0, 300) });
    }
  }
  return { due: due.length, results };
}
