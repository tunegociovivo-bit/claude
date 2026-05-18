/**
 * Cliente WordPress REST API minimal.
 *
 * Auth: usuario + Application Password (recomendado sobre el password
 * normal porque revocable individualmente). Config por WORKSPACE en
 * Workspace.settings.integrations.wordpress = {
 *   siteUrl: "https://midominio.com",
 *   user:    "admin",
 *   appPassword: <encrypted>
 * }
 *
 * O por CLIENTE — algunas agencias gestionan webs de varios clientes
 * y cada cliente tiene su WP. Si un Cliente.settings tiene wordpress
 * lo prioriza sobre el del workspace (config por cliente).
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

type WpConfig = {
  siteUrl: string;
  user: string;
  appPassword: string;
};

async function getWpConfig(opts: {
  workspaceId: string;
  clientId?: string | null;
}): Promise<WpConfig> {
  // Prioridad: cliente → workspace.
  if (opts.clientId) {
    const c = await prisma.client.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId }
    });
    const enc = (c as any)?.settings?.wordpress;
    if (enc?.siteUrl && enc?.user && enc?.appPasswordEnc) {
      const pass = decryptSecret(enc.appPasswordEnc);
      if (pass) return { siteUrl: enc.siteUrl, user: enc.user, appPassword: pass };
    }
  }
  const ws = await prisma.workspace.findUnique({ where: { id: opts.workspaceId } });
  const wp = (ws?.settings as any)?.integrations?.wordpress;
  if (!wp?.siteUrl || !wp?.user || !wp?.appPasswordEnc) {
    throw new Error(
      "WordPress no configurado. Define settings.integrations.wordpress.{siteUrl, user, appPasswordEnc} en el workspace."
    );
  }
  const pass = decryptSecret(wp.appPasswordEnc);
  if (!pass) throw new Error("WordPress appPassword inválido");
  return { siteUrl: wp.siteUrl, user: wp.user, appPassword: pass };
}

async function wpFetch<T = any>(
  cfg: WpConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const auth = Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString("base64");
  const base = cfg.siteUrl.replace(/\/+$/, "");
  const resp = await fetch(`${base}/wp-json${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`WordPress ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return resp.json();
}

export async function wpListPosts(opts: {
  workspaceId: string;
  clientId?: string | null;
  status?: "publish" | "draft" | "private" | "future" | "any";
  search?: string;
  limit?: number;
}): Promise<Array<{ id: number; title: string; status: string; date: string; link: string }>> {
  const cfg = await getWpConfig(opts);
  const params = new URLSearchParams({
    per_page: String(opts.limit ?? 30),
    status: opts.status ?? "publish",
    _fields: "id,title,status,date,link"
  });
  if (opts.search) params.set("search", opts.search);
  const data: any[] = await wpFetch(cfg, `/wp/v2/posts?${params.toString()}`);
  return data.map((p) => ({
    id: p.id,
    title: typeof p.title === "object" ? p.title.rendered : p.title,
    status: p.status,
    date: p.date,
    link: p.link
  }));
}

export async function wpCreatePost(opts: {
  workspaceId: string;
  clientId?: string | null;
  title: string;
  content: string; // HTML
  excerpt?: string;
  status?: "publish" | "draft" | "private" | "future";
  categories?: number[];
  tags?: number[];
  /** Slug URL-safe. Si no se da WP genera uno del título. */
  slug?: string;
  /** Feature image. URL pública (WP la descarga e importa) o ID
   *  de un media ya subido. */
  featuredMediaUrl?: string;
  featuredMediaId?: number;
  /** SEO Yoast/Rank Math fields opcionales (si plugin instalado). */
  yoastMetaTitle?: string;
  yoastMetaDescription?: string;
}): Promise<{ id: number; link: string; status: string }> {
  const cfg = await getWpConfig(opts);

  // Si pasan featuredMediaUrl, descargamos primero y subimos a /media.
  let featuredMediaId = opts.featuredMediaId;
  if (!featuredMediaId && opts.featuredMediaUrl) {
    featuredMediaId = await uploadImageFromUrl(cfg, opts.featuredMediaUrl);
  }

  const payload: any = {
    title: opts.title,
    content: opts.content,
    status: opts.status ?? "draft"
  };
  if (opts.excerpt) payload.excerpt = opts.excerpt;
  if (opts.slug) payload.slug = opts.slug;
  if (opts.categories) payload.categories = opts.categories;
  if (opts.tags) payload.tags = opts.tags;
  if (featuredMediaId) payload.featured_media = featuredMediaId;
  if (opts.yoastMetaTitle || opts.yoastMetaDescription) {
    payload.meta = {
      _yoast_wpseo_title: opts.yoastMetaTitle,
      _yoast_wpseo_metadesc: opts.yoastMetaDescription,
      rank_math_title: opts.yoastMetaTitle,
      rank_math_description: opts.yoastMetaDescription
    };
  }
  const data: any = await wpFetch(cfg, "/wp/v2/posts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return { id: data.id, link: data.link, status: data.status };
}

export async function wpUpdatePost(opts: {
  workspaceId: string;
  clientId?: string | null;
  postId: number;
  title?: string;
  content?: string;
  excerpt?: string;
  status?: "publish" | "draft" | "private" | "future";
  categories?: number[];
  tags?: number[];
}): Promise<{ id: number; link: string; status: string }> {
  const cfg = await getWpConfig(opts);
  const payload: any = {};
  if (opts.title) payload.title = opts.title;
  if (opts.content) payload.content = opts.content;
  if (opts.excerpt !== undefined) payload.excerpt = opts.excerpt;
  if (opts.status) payload.status = opts.status;
  if (opts.categories) payload.categories = opts.categories;
  if (opts.tags) payload.tags = opts.tags;
  if (Object.keys(payload).length === 0) throw new Error("Pasa al menos un campo a actualizar");
  const data: any = await wpFetch(cfg, `/wp/v2/posts/${opts.postId}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return { id: data.id, link: data.link, status: data.status };
}

export async function wpListCategories(opts: {
  workspaceId: string;
  clientId?: string | null;
}): Promise<Array<{ id: number; name: string; slug: string; count: number }>> {
  const cfg = await getWpConfig(opts);
  const data: any[] = await wpFetch(cfg, "/wp/v2/categories?per_page=100&_fields=id,name,slug,count");
  return data.map((c) => ({ id: c.id, name: c.name, slug: c.slug, count: c.count }));
}

async function uploadImageFromUrl(cfg: WpConfig, url: string): Promise<number> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch image ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const filename = url.split("?")[0].split("/").pop() || "image.jpg";
  const auth = Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString("base64");
  const base = cfg.siteUrl.replace(/\/+$/, "");
  const resp = await fetch(`${base}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": r.headers.get("content-type") ?? "image/jpeg",
      "Content-Disposition": `attachment; filename="${filename}"`
    },
    body: buf as any
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`WP media upload ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data: any = await resp.json();
  return data.id;
}
