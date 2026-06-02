/**
 * Cliente WooCommerce REST API (v3) minimal para Sonia.
 *
 * Auth: Consumer Key + Consumer Secret (ck_.../cs_...) como HTTP Basic
 * sobre HTTPS — el estándar de WooCommerce.
 *
 * Resolución de credenciales (en este orden de prioridad):
 *   1) override explícito que pase la tool en el input (storeUrl / consumerKey
 *      / consumerSecret) — el user las dio SOLO para esta tarea.
 *   2) adhocCredentials del run: WOOCOMMERCE_STORE_URL / WOOCOMMERCE_CONSUMER_KEY
 *      / WOOCOMMERCE_CONSUMER_SECRET (el user las pegó en la tarea; el sistema
 *      las persiste cifradas y las reutiliza — ver lib/ai/nv-ia/adhoc-credentials.ts).
 *   3) Workspace.settings.integrations.woocommerce.{ storeUrl, consumerKeyEnc,
 *      consumerSecretEnc } (cifradas) — o lo mismo en Client.settings.woocommerce.
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

export type WooConfig = {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

/** Asegura https:// y se queda con el origin (la REST API de WooCommerce vive
 *  en la raíz del WordPress, no en la página /tienda ni /shop). */
function normalizeStoreUrl(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) throw new Error("storeUrl vacío");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`storeUrl inválido: ${raw}`);
  }
  return u.origin;
}

export async function resolveWooConfig(opts: {
  workspaceId: string;
  clientId?: string | null;
  adhoc?: Record<string, string>;
  override?: { storeUrl?: string; consumerKey?: string; consumerSecret?: string };
}): Promise<WooConfig> {
  const ov = opts.override ?? {};
  const ad = opts.adhoc ?? {};
  let storeUrl = (ov.storeUrl || ad.WOOCOMMERCE_STORE_URL || "").trim();
  let consumerKey = (ov.consumerKey || ad.WOOCOMMERCE_CONSUMER_KEY || "").trim();
  let consumerSecret = (ov.consumerSecret || ad.WOOCOMMERCE_CONSUMER_SECRET || "").trim();

  if (!storeUrl || !consumerKey || !consumerSecret) {
    // Fallback a config cifrada por cliente → workspace.
    let cfg: any = null;
    if (opts.clientId) {
      const c = await prisma.client.findFirst({
        where: { id: opts.clientId, workspaceId: opts.workspaceId }
      });
      cfg = (c as any)?.settings?.woocommerce ?? null;
    }
    if (!cfg) {
      const ws = await prisma.workspace.findUnique({
        where: { id: opts.workspaceId },
        select: { settings: true }
      });
      cfg = (ws?.settings as any)?.integrations?.woocommerce ?? null;
    }
    if (cfg) {
      storeUrl = storeUrl || String(cfg.storeUrl || "").trim();
      consumerKey =
        consumerKey ||
        (cfg.consumerKeyEnc ? decryptSecret(cfg.consumerKeyEnc) || "" : String(cfg.consumerKey || "")).trim();
      consumerSecret =
        consumerSecret ||
        (cfg.consumerSecretEnc
          ? decryptSecret(cfg.consumerSecretEnc) || ""
          : String(cfg.consumerSecret || "")).trim();
    }
  }

  if (!storeUrl || !consumerKey || !consumerSecret) {
    throw new Error(
      "WooCommerce sin credenciales. Necesito la URL de la tienda + consumer key (ck_...) + consumer secret (cs_...). " +
        "Pásalas en la tarea (ej: 'WOOCOMMERCE_STORE_URL=https://2m2.es', 'clave cliente: ck_...', 'clave secreta: cs_...') " +
        "o pásalas en storeUrl/consumerKey/consumerSecret. Una vez pegadas se guardan cifradas y se reutilizan."
    );
  }
  return {
    storeUrl: normalizeStoreUrl(storeUrl),
    consumerKey,
    consumerSecret
  };
}

async function wcFetch<T = any>(
  cfg: WooConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30000
): Promise<T> {
  const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString("base64");
  const base = cfg.storeUrl.replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${base}/wp-json/wc/v3${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {})
      }
    });
    const txt = await resp.text();
    if (!resp.ok) {
      // 404 suele significar URL de tienda mal (WordPress en subdirectorio,
      // o la REST API desactivada). 401 = ck/cs incorrectos o sin permisos.
      throw new Error(`WooCommerce ${resp.status} en ${path}: ${txt.slice(0, 400)}`);
    }
    return (txt ? JSON.parse(txt) : {}) as T;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`WooCommerce timeout tras ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

type CategoryInput = number | string | { id?: number; name?: string };
type ImageInput = string | { src?: string; alt?: string; name?: string };
type AttributeInput = { name: string; options: string[]; visible?: boolean };

export async function wcCreateProduct(opts: {
  workspaceId: string;
  clientId?: string | null;
  adhoc?: Record<string, string>;
  override?: { storeUrl?: string; consumerKey?: string; consumerSecret?: string };
  name: string;
  type?: string;
  status?: "draft" | "publish" | "pending" | "private";
  sku?: string;
  regularPrice?: string;
  description?: string;
  shortDescription?: string;
  categories?: CategoryInput[];
  images?: ImageInput[];
  attributes?: AttributeInput[];
  /** Atajo: crea un atributo "Proveedor" con este valor (ej "MARCA"). */
  brand?: string;
}): Promise<{ id: number; permalink: string; status: string; sku: string; name: string; price: string }> {
  if (!opts.name || !opts.name.trim()) throw new Error("name (nombre del producto) es obligatorio");
  const cfg = await resolveWooConfig(opts);

  const payload: any = {
    name: opts.name.trim(),
    type: opts.type || "simple",
    status: opts.status || "draft"
  };
  if (opts.sku) payload.sku = String(opts.sku).trim();
  if (opts.regularPrice != null && String(opts.regularPrice).trim() !== "") {
    // WooCommerce espera string con PUNTO decimal ("34.95", no "34,95").
    payload.regular_price = String(opts.regularPrice).trim().replace(",", ".");
  }
  if (opts.description) payload.description = opts.description;
  if (opts.shortDescription) payload.short_description = opts.shortDescription;

  if (opts.categories?.length) {
    payload.categories = opts.categories.map((c) => {
      if (typeof c === "number") return { id: c };
      if (typeof c === "string") return /^\d+$/.test(c.trim()) ? { id: Number(c.trim()) } : { name: c };
      return c;
    });
  }
  if (opts.images?.length) {
    payload.images = opts.images
      .map((im) => (typeof im === "string" ? { src: im } : im))
      .filter((im): im is { src: string } => !!im && typeof (im as any).src === "string" && !!(im as any).src);
  }
  const attrs: AttributeInput[] = [...(opts.attributes ?? [])];
  if (opts.brand && opts.brand.trim()) {
    attrs.push({ name: "Proveedor", options: [opts.brand.trim()], visible: true });
  }
  if (attrs.length) {
    payload.attributes = attrs.map((a) => ({
      name: a.name,
      options: a.options,
      visible: a.visible !== false
    }));
  }

  const data: any = await wcFetch(cfg, "/products", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return {
    id: data.id,
    permalink: data.permalink ?? "",
    status: data.status ?? payload.status,
    sku: data.sku ?? "",
    name: data.name ?? payload.name,
    price: data.price ?? payload.regular_price ?? ""
  };
}

export async function wcListCategories(opts: {
  workspaceId: string;
  clientId?: string | null;
  adhoc?: Record<string, string>;
  override?: { storeUrl?: string; consumerKey?: string; consumerSecret?: string };
  search?: string;
}): Promise<Array<{ id: number; name: string; slug: string; parent: number; count: number }>> {
  const cfg = await resolveWooConfig(opts);
  const params = new URLSearchParams({ per_page: "100", _fields: "id,name,slug,parent,count" });
  if (opts.search) params.set("search", opts.search);
  const data: any[] = await wcFetch(cfg, `/products/categories?${params.toString()}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    parent: c.parent,
    count: c.count
  }));
}
