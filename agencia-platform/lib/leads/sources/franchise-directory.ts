/**
 * Directorios de franquicias (la vía "a lo seguro").
 *
 * Los portales de franquicias publican la ficha de cada enseña con su PERSONA DE
 * CONTACTO de expansión/marketing, teléfono y web corporativa. Aquí:
 *   1) leemos el LISTADO de un directorio → enlaces a fichas,
 *   2) leemos cada ficha y EXTRAEMOS con IA {marca, contacto, cargo, tel, email, web},
 *   3) si no hay email, lo deducimos con Hunter (nombre + dominio corporativo).
 *
 * Fetch normal cuando el portal lo permite (gratis); Scrapfly solo si bloquea.
 * La extracción por IA es robusta a cualquier maquetación (no parser por portal).
 */

import { completeJson } from "@/lib/ai/anthropic";
import { scrapflyKey } from "./index";
import { resolveContactKeys, hunterFindEmail } from "../enrich-contacts";

export type DirectoryContact = {
  brand: string;
  contactName: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  /** Todos los emails corporativos hallados en la ficha (para copia oculta). */
  emails: string[];
  corporateWeb: string | null;
  sector: string | null;
  sourceUrl: string;
  directory: string;
};

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
// Emails que NO son de la franquicia: los del propio directorio/portal y ruido.
const DIRECTORY_DOMAINS = ["feriafranquiciasonline.es", "aefranquicia.es", "tormo.com", "mundofranquicia.com", "quefranquicia.com", "franquiciadores.com"];
const EMAIL_JUNK = /(sentry|wixpress|example\.com|\.png|\.jpg|\.jpeg|\.gif|\.webp|godaddy|cloudflare|domain\.com|email\.com|wordpress|@2x|@3x|tu-?dominio)/i;
// Buzones de contacto de franquicia que priorizamos como destinatario principal.
const ROLE_PREFIX = /^(expansion|expansión|franquicias|desarrollo|marketing|comunicacion|comunicación|info|hola|contacto|contact)@/i;

/** Extrae emails corporativos de la ficha (mailto + texto), sin los del portal. */
export function extractFichaEmails(rawHtml: string): string[] {
  const set = new Set<string>();
  const add = (raw: string) => {
    const e = raw.trim().toLowerCase().replace(/^mailto:/, "").replace(/[).,;:]+$/, "");
    if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return;
    if (EMAIL_JUNK.test(e)) return;
    const dom = e.split("@")[1] ?? "";
    if (DIRECTORY_DOMAINS.some((d) => dom === d || dom.endsWith("." + d))) return; // email del portal → fuera
    set.add(e);
  };
  for (const m of rawHtml.matchAll(/mailto:([^"'?>\s]+)/gi)) add(m[1]);
  for (const m of rawHtml.matchAll(EMAIL_RE)) add(m[0]);
  return [...set];
}

/** Elige el mejor email (dominio corporativo + buzón de expansión/marketing). */
export function pickBestEmail(emails: string[], corporateWeb: string | null): string | null {
  if (emails.length === 0) return null;
  const domain = corporateWeb ? corporateWeb.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : null;
  if (domain) {
    const ownRole = emails.find((e) => e.endsWith("@" + domain) && ROLE_PREFIX.test(e));
    if (ownRole) return ownRole;
    const own = emails.find((e) => e.endsWith("@" + domain));
    if (own) return own;
  }
  const role = emails.find((e) => ROLE_PREFIX.test(e));
  return role ?? emails[0];
}

type DirectoryConfig = { name: string; listUrl: string; detailPattern: RegExp; scrapfly?: boolean };

// Directorios soportados. Se pueden añadir más con solo su listado + patrón de ficha.
const DIRECTORIES: DirectoryConfig[] = [
  {
    name: "Feria Franquicias Online",
    listUrl: "https://feriafranquiciasonline.es/firmas-expositoras/",
    detailPattern: /https?:\/\/feriafranquiciasonline\.es\/firmas-expositoras\/[a-z0-9-]+\/?/gi
  },
  {
    name: "AEF",
    listUrl: "https://www.aefranquicia.es/ensenas/",
    detailPattern: /https?:\/\/(?:www\.)?aefranquicia\.es\/ensenas\/[a-z0-9-]+\/?/gi,
    scrapfly: true
  }
];

async function plainFetch(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", Accept: "text/html" },
      signal: AbortSignal.timeout(15000),
      redirect: "follow"
    });
    if (!resp.ok) return "";
    return (await resp.text()).slice(0, 800_000);
  } catch {
    return "";
  }
}

async function scrapflyFetchHtml(url: string, workspaceId: string): Promise<string> {
  const key = await scrapflyKey(workspaceId);
  if (!key) return "";
  try {
    const api = `https://api.scrapfly.io/scrape?key=${encodeURIComponent(key)}&asp=true&render_js=true&country=es&url=${encodeURIComponent(url)}`;
    const resp = await fetch(api, { signal: AbortSignal.timeout(45000) });
    const data: any = await resp.json().catch(() => null);
    const html = data?.result?.content;
    return typeof html === "string" ? html.slice(0, 800_000) : "";
  } catch {
    return "";
  }
}

/** Descarga HTML probando ambas vías. Si el portal bloquea (503/anti-bot), Scrapfly
 *  con render_js lo resuelve. `preferScrapfly` invierte el orden para portales JS. */
async function fetchHtml(url: string, workspaceId: string, preferScrapfly?: boolean): Promise<string> {
  const order: ("plain" | "scrapfly")[] = preferScrapfly ? ["scrapfly", "plain"] : ["plain", "scrapfly"];
  for (const mode of order) {
    const html = mode === "plain" ? await plainFetch(url) : await scrapflyFetchHtml(url, workspaceId);
    if (html && html.length > 300) return html;
  }
  return "";
}

/** Enlaces a fichas de franquicia dentro del listado (deduplicados). */
export function discoverDetailUrls(html: string, pattern: RegExp, listUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(pattern)) {
    const u = m[0].replace(/\/$/, "");
    if (u === listUrl.replace(/\/$/, "")) continue; // no el propio listado
    out.add(u);
  }
  return [...out];
}

const CONTACT_SCHEMA = {
  type: "object",
  properties: {
    brand: { type: "string" },
    contactName: { type: "string" },
    role: { type: "string" },
    phone: { type: "string" },
    email: { type: "string" },
    corporateWeb: { type: "string" },
    sector: { type: "string" }
  },
  required: ["brand"]
};

const CONTACT_SYSTEM = `Extrae de esta ficha de un directorio de franquicias los datos de la ENSEÑA y su
contacto de EXPANSIÓN/MARKETING. Devuelve: brand (nombre de la marca), contactName (persona de contacto),
role (su cargo si aparece), phone (teléfono), email (si aparece uno real), corporateWeb (web corporativa de
la central), sector. No inventes: deja vacío lo que no aparezca. Devuelve SOLO el JSON.`;

/** Extrae el contacto de una ficha con IA. */
async function extractContact(workspaceId: string, html: string, url: string, directory: string): Promise<DirectoryContact | null> {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
  if (text.length < 40) return null;
  let r: any;
  try {
    r = await completeJson<any>({
      workspaceId,
      model: "claude-haiku-4-5-20251001",
      system: CONTACT_SYSTEM,
      user: `Ficha (${url}):\n${text}\n\nExtrae los datos:`,
      schema: CONTACT_SCHEMA,
      maxTokens: 400
    });
  } catch {
    return null;
  }
  if (!r?.brand || !String(r.brand).trim()) return null;
  const str = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const corporateWeb = str(r.corporateWeb);
  // Emails REALES de la ficha por regex (mailto + texto), sin los del portal.
  const fichaEmails = extractFichaEmails(html);
  // Añade el email que sacó la IA si es válido y no es del portal.
  const aiEmail = str(r.email);
  if (aiEmail && /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(aiEmail)) {
    const dom = aiEmail.toLowerCase().split("@")[1] ?? "";
    if (!DIRECTORY_DOMAINS.some((d) => dom === d || dom.endsWith("." + d)) && !fichaEmails.includes(aiEmail.toLowerCase())) {
      fichaEmails.push(aiEmail.toLowerCase());
    }
  }
  const best = pickBestEmail(fichaEmails, corporateWeb);
  return {
    brand: String(r.brand).trim(),
    contactName: str(r.contactName),
    role: str(r.role),
    phone: str(r.phone),
    email: best,
    emails: fichaEmails,
    corporateWeb,
    sector: str(r.sector),
    sourceUrl: url,
    directory
  };
}

/** Deduce el email por Hunter (nombre + dominio corporativo) si la ficha no lo trae. */
async function enrichContactEmail(workspaceId: string, c: DirectoryContact): Promise<void> {
  if (c.email || !c.contactName || !c.corporateWeb) return;
  const { hunterKey } = await resolveContactKeys(workspaceId);
  if (!hunterKey) return;
  const domain = c.corporateWeb.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
  if (!domain) return;
  const tokens = c.contactName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s-]+/).filter(Boolean);
  if (tokens.length < 2) return;
  try {
    const v = await hunterFindEmail({ domain, firstName: tokens[0], lastName: tokens[tokens.length - 1], apiKey: hunterKey });
    if (v?.email) c.email = v.email;
  } catch {}
}

/**
 * Recorre los directorios de franquicias y devuelve los contactos encontrados
 * (con email deducido cuando falta). Acotado por `max` fichas por directorio.
 */
export async function crawlFranchiseDirectories(
  workspaceId: string,
  opts?: { max?: number; only?: string }
): Promise<{ contacts: DirectoryContact[]; scanned: number; errors: number }> {
  const max = Math.min(opts?.max ?? 40, 80);
  const contacts: DirectoryContact[] = [];
  let scanned = 0;
  let errors = 0;

  for (const dir of DIRECTORIES) {
    if (opts?.only && dir.name !== opts.only) continue;
    const listHtml = await fetchHtml(dir.listUrl, workspaceId, dir.scrapfly);
    if (!listHtml) { errors++; continue; }
    const urls = discoverDetailUrls(listHtml, dir.detailPattern, dir.listUrl).slice(0, max);
    const CHUNK = 3;
    for (let i = 0; i < urls.length; i += CHUNK) {
      const slice = urls.slice(i, i + CHUNK);
      const found = await Promise.all(
        slice.map(async (u) => {
          scanned++;
          const html = await fetchHtml(u, workspaceId, dir.scrapfly);
          if (!html) return null;
          const c = await extractContact(workspaceId, html, u, dir.name);
          if (c) await enrichContactEmail(workspaceId, c);
          return c;
        })
      );
      for (const c of found) if (c) contacts.push(c);
    }
  }
  return { contacts, scanned, errors };
}
