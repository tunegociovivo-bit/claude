/**
 * Cliente REST para la web WordPress de cada cliente (Application Password).
 */
import { decryptSecret } from "@/lib/ai/crypto";
import { decodeEntities, plainText, untrailingslash } from "./util";

export type WpSite = { id: string; siteUrl: string; wpUser: string; wpAppPasswordEnc: string | null };

const restQueryMode = new Set<string>(); // sitios con permalinks simples → ?rest_route=

export class WpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function url(site: WpSite, route: string): string {
  const base = untrailingslash(site.siteUrl);
  const r = "/" + route.replace(/^\/+/, "");
  if (restQueryMode.has(site.id)) {
    const [path, qs] = r.split("?");
    return `${base}/?rest_route=${path}${qs ? "&" + qs : ""}`;
  }
  return `${base}/wp-json${r}`;
}

function auth(site: WpSite): string {
  const pass = (site.wpAppPasswordEnc ? decryptSecret(site.wpAppPasswordEnc) : "") ?? "";
  return "Basic " + Buffer.from(`${site.wpUser}:${pass.replace(/\s+/g, "")}`).toString("base64");
}

export async function wpRequest<T = any>(
  site: WpSite,
  method: string,
  route: string,
  body?: unknown,
  opts: { raw?: boolean; headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<T> {
  if (!site.siteUrl || !site.wpUser || !site.wpAppPasswordEnc) {
    throw new WpError(400, "El cliente no tiene configurada la conexión WordPress (URL, usuario y Application Password).");
  }
  const headers: Record<string, string> = {
    Authorization: auth(site),
    Accept: "application/json",
    "User-Agent": "NV-Hub-Publicador/1.0",
    ...(opts.headers ?? {})
  };
  let payload: any = undefined;
  if (body !== undefined) {
    if (opts.raw) payload = body;
    else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const r = await fetch(url(site, route), {
    method,
    headers,
    body: payload,
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000)
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (r.status === 404 && data === null && !restQueryMode.has(site.id)) {
    restQueryMode.add(site.id);
    return wpRequest(site, method, route, body, opts);
  }
  if (!r.ok) {
    const msg = data?.message ?? plainText(text).slice(0, 300);
    throw new WpError(r.status, `Web cliente (${r.status}): ${msg}`);
  }
  if (data === null) throw new WpError(502, diagnoseNonJson(r, text));
  return data as T;
}

/** Explica por qué la web devolvió algo que no es JSON (para que el equipo sepa qué tocar en la web del cliente). */
function diagnoseNonJson(r: Response, text: string): string {
  const ct = r.headers.get("content-type") ?? "";
  const server = r.headers.get("server") ?? "";
  const cfRay = r.headers.get("cf-ray");
  const title = /<title[^>]*>([^<]{0,120})<\/title>/i.exec(text)?.[1]?.trim();
  const low = text.toLowerCase();
  const finalUrl = r.url || "";
  let why = "";
  if (cfRay && (low.includes("cf-chl") || low.includes("just a moment") || low.includes("challenge-platform") || low.includes("attention required"))) {
    why = "Cloudflare está mostrando un reto/bloqueo (Bot Fight Mode o una regla WAF). En Cloudflare del cliente: Security → WAF → crear regla «Skip» para la ruta /wp-json/* (o desactivar Bot Fight Mode).";
  } else if (low.includes("wordfence")) {
    why = "Wordfence bloquea la petición. En Wordfence → Firewall → Allowlist, añade la IP del Hub o la URL /wp-json/*.";
  } else if (low.includes("sucuri") || low.includes("access denied") || low.includes("mod_security") || low.includes("modsecurity")) {
    why = "Un firewall (Sucuri/ModSecurity/hosting) está devolviendo una página de bloqueo. Hay que permitir /wp-json/* desde el Hub.";
  } else if (finalUrl.includes("wp-login.php") || low.includes("wp-login") || low.includes("name=\"log\"")) {
    why = "La web redirige a la pantalla de login: un plugin de seguridad o de «sitio privado» está protegiendo la API REST. Desactiva esa protección para /wp-json/*.";
  } else if (low.includes("coming soon") || low.includes("maintenance") || low.includes("próximamente") || low.includes("mantenimiento") || low.includes("seedprod")) {
    why = "La web está en modo «próximamente/mantenimiento» y ese plugin responde en lugar de la API REST. Excluye /wp-json/* o desactívalo.";
  } else if (ct.includes("text/html") && low.includes("<!doctype html") && !low.includes("wp-json")) {
    why = "La URL responde con una página HTML normal en lugar de la API REST. Comprueba que la URL es la raíz del WordPress (p. ej. https://dominio.com, sin /blog ni /wp-admin) y que los enlaces permanentes no están en «Simple».";
  } else {
    why = "La API REST no devuelve JSON. Suele ser un firewall/CDN, un plugin de seguridad que desactiva la REST API o una URL incorrecta.";
  }
  const meta = [
    `HTTP ${r.status}`,
    ct ? `tipo ${ct.split(";")[0]}` : "",
    server ? `servidor ${server}` : "",
    cfRay ? "Cloudflare" : "",
    title ? `título «${title}»` : "",
    finalUrl ? `URL final ${finalUrl}` : ""
  ].filter(Boolean).join(" · ");
  return `Respuesta no JSON de la web cliente (${meta}). ${why}`;
}

/** Normaliza la URL escrita a mano: añade https://, quita /wp-admin, /wp-login.php, ?query, #hash y barras finales. */
export function normalizeSiteUrl(input: string): string {
  let s = String(input ?? "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  try {
    const u = new URL(s);
    let path = u.pathname.replace(/\/+$/, "");
    path = path.replace(/\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|index\.php)(\/.*)?$/i, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

/**
 * Descubre la raíz real del WordPress a partir de cualquier URL de la web
 * (cabecera Link rel="https://api.w.org/" o <link> en el HTML). Devuelve "" si no la encuentra.
 */
export async function discoverWpRoot(anyUrl: string): Promise<string> {
  const start = normalizeSiteUrl(anyUrl);
  if (!start) return "";
  const candidates = [start];
  try {
    const u = new URL(start);
    if (u.pathname && u.pathname !== "/") candidates.push(`${u.protocol}//${u.host}`);
  } catch {}
  for (const c of candidates) {
    try {
      const r = await fetch(c + "/", {
        headers: { "User-Agent": "NV-Hub-Publicador/1.0", Accept: "text/html,application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000)
      });
      const link = r.headers.get("link") ?? "";
      let m = /<([^>]+\/wp-json\/?)>;\s*rel="https:\/\/api\.w\.org\/"/i.exec(link);
      if (!m) {
        const html = (await r.text()).slice(0, 200_000);
        m = /<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]+href=["']([^"']+)["']/i.exec(html) ?? /href=["']([^"']+)["'][^>]+rel=["']https:\/\/api\.w\.org\/["']/i.exec(html);
      }
      if (m) {
        const root = m[1].replace(/\\\//g, "/").replace(/\/wp-json\/?$/i, "").replace(/\/+$/, "");
        if (/^https?:\/\//i.test(root)) return root;
      }
    } catch {}
  }
  return "";
}

export async function wpTest(site: WpSite) {
  const me = await wpRequest<any>(site, "GET", "/wp/v2/users/me?context=edit");
  let root: any = {};
  try {
    root = await wpRequest<any>(site, "GET", "/");
  } catch {}
  const ns: string[] = Array.isArray(root?.namespaces) ? root.namespaces : [];
  const caps = me?.capabilities ?? {};
  return {
    user: me?.name ?? me?.slug ?? "",
    userId: me?.id ?? 0,
    canPublish: !!caps.publish_posts,
    canUpload: !!caps.upload_files,
    siteName: root?.name ?? "",
    bridge: ns.includes("nvseo/v1"),
    yoast: ns.includes("yoast/v1"),
    rankmath: ns.includes("rankmath/v1")
  };
}

export type SitePage = { id: number; url: string; title: string; excerpt: string; type: "post" | "page" };

export async function wpSitePages(site: WpSite): Promise<SitePage[]> {
  const out: SitePage[] = [];
  for (let page = 1; page <= 5; page++) {
    let r: any[];
    try {
      r = await wpRequest<any[]>(site, "GET", `/wp/v2/posts?per_page=100&page=${page}&status=publish&_fields=id,link,title,excerpt`);
    } catch {
      break;
    }
    for (const p of r ?? []) {
      out.push({
        id: p.id,
        url: p.link,
        title: decodeEntities(plainText(p.title?.rendered ?? "")),
        excerpt: decodeEntities(plainText(p.excerpt?.rendered ?? "")).slice(0, 160),
        type: "post"
      });
    }
    if ((r ?? []).length < 100) break;
  }
  try {
    const pages = await wpRequest<any[]>(site, "GET", "/wp/v2/pages?per_page=50&status=publish&_fields=id,link,title");
    for (const p of pages ?? []) {
      out.push({ id: p.id, url: p.link, title: decodeEntities(plainText(p.title?.rendered ?? "")), excerpt: "", type: "page" });
    }
  } catch {}
  return out;
}

export async function wpUploadMedia(
  site: WpSite,
  bytes: Buffer,
  filename: string,
  mime: string,
  meta: { alt?: string; title?: string; caption?: string }
) {
  const r = await wpRequest<any>(site, "POST", "/wp/v2/media", bytes, {
    raw: true,
    timeoutMs: 120_000,
    headers: { "Content-Type": mime, "Content-Disposition": `attachment; filename="${filename}"` }
  });
  const upd: Record<string, string> = {};
  if (meta.alt) upd.alt_text = meta.alt;
  if (meta.title) upd.title = meta.title;
  if (meta.caption) upd.caption = meta.caption;
  if (Object.keys(upd).length) await wpRequest(site, "POST", `/wp/v2/media/${r.id}`, upd).catch(() => null);
  const large = r?.media_details?.sizes?.large;
  return {
    id: Number(r.id),
    url: String(r.source_url ?? ""),
    largeUrl: String(large?.source_url ?? r.source_url ?? ""),
    width: Number(large?.width ?? r?.media_details?.width ?? 0) || undefined,
    height: Number(large?.height ?? r?.media_details?.height ?? 0) || undefined
  };
}

export async function wpEnsureTerm(site: WpSite, taxonomy: "category" | "post_tag", name: string): Promise<number> {
  const n = name.trim();
  if (!n) return 0;
  const rest = taxonomy === "category" ? "categories" : "tags";
  try {
    const found = await wpRequest<any[]>(site, "GET", `/wp/v2/${rest}?search=${encodeURIComponent(n)}&per_page=20&_fields=id,name`);
    const hit = (found ?? []).find((t) => decodeEntities(String(t.name)).toLowerCase() === n.toLowerCase());
    if (hit) return Number(hit.id);
  } catch {}
  try {
    const created = await wpRequest<any>(site, "POST", `/wp/v2/${rest}`, { name: n });
    return Number(created.id);
  } catch {
    return 0;
  }
}

export function wpUpsertPost(site: WpSite, payload: Record<string, unknown>, remoteId = 0) {
  return wpRequest<any>(site, "POST", remoteId ? `/wp/v2/posts/${remoteId}` : "/wp/v2/posts", payload, { timeoutMs: 90_000 });
}

export function wpGetPost(site: WpSite, remoteId: number) {
  return wpRequest<any>(site, "GET", `/wp/v2/posts/${remoteId}?context=edit&_fields=id,status,link,date`);
}
