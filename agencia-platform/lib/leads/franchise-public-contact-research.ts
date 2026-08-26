import { completeJson } from "@/lib/ai/anthropic";
import { loadStoredAdhocCredentials } from "@/lib/ai/nv-ia/adhoc-credentials";
import type { MarketingEmail } from "./enrich-contacts";

export type PublicMarketingContact = MarketingEmail & { evidenceUrl?: string | null };

const relevantLink = /equipo|team|nosotros|about|quienes|empresa|corporate|contact|prensa|press|comunicacion|marketing|directorio|organigrama|franqui|expansi|aviso|legal|privacidad/i;
const emailPattern = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const exactEmailPattern = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
const usefulFunctionalMailbox = /^(franquicias|infofranquicias|franchise|expansion|exporestalia|marketing|comunicacion|brand|prensa|press)@/i;
const corporateMailbox = /^(franquicias|infofranquicias|franchise|expansion|exporestalia|marketing|comunicacion|brand|prensa|press|info|contacto|contact|hola|hello|central)@/i;
const excludedMailbox = /^(privacy|privacidad|legal|soporte|support|rrhh|empleo|jobs|facturacion|billing|compras|proveedores)@/i;

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "metadata.google.internal"].includes(host)) return null;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|\.internal$|\.local$/.test(host)) return null;
    return url;
  } catch { return null; }
}

async function readHtml(url: string): Promise<string> {
  try {
    let current = safeUrl(url);
    if (!current) return "";
    let response: Response | null = null;
    for (let redirects = 0; redirects < 4; redirects += 1) {
      response = await fetch(current, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NegocioVivoBot/1.0)", Accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000)
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      current = location ? safeUrl(new URL(location, current).toString()) : null;
      if (!current) return "";
    }
    if (!response) return "";
    if (!response.ok || !/html|text/.test(response.headers.get("content-type") ?? "")) return "";
    return (await response.text()).slice(0, 500_000);
  } catch { return ""; }
}

function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function internalResearchLinks(html: string, base: URL): string[] {
  const links = new Set<string>([base.origin]);
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!relevantLink.test(`${match[1]} ${visibleText(match[2])}`)) continue;
    try {
      const url = new URL(match[1], base);
      if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      links.add(url.toString().split("#")[0]);
      if (links.size >= 8) break;
    } catch { /* enlace inválido */ }
  }
  return [...links];
}

export function extractCorporateMailboxes(pages: Array<{ url: string; html: string }>, corporateDomain: string): PublicMarketingContact[] {
  const normalizedDomain = corporateDomain.replace(/^www\./, "").toLowerCase();
  const found = new Map<string, PublicMarketingContact>();
  for (const page of pages) {
    const emails = page.html.match(emailPattern) ?? [];
    emailPattern.lastIndex = 0;
    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase();
      const emailDomain = email.split("@")[1]?.replace(/^www\./, "");
      const isSpecificDepartment = usefulFunctionalMailbox.test(email);
      if ((emailDomain !== normalizedDomain && !isSpecificDepartment) || excludedMailbox.test(email) || !corporateMailbox.test(email)) continue;
      found.set(email, {
        email,
        name: "Contacto corporativo",
        role: isSpecificDepartment ? "Departamento de marketing, comunicación o expansión" : "Contacto general de la central",
        source: "corporate_website_literal",
        providerConfidence: isSpecificDepartment ? 90 : 80,
        evidenceUrl: page.url
      });
    }
  }
  return [...found.values()];
}

const resultSchema = {
  type: "object",
  properties: {
    contacts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          role: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          linkedin: { type: ["string", "null"] },
          evidenceUrl: { type: ["string", "null"] }
        },
        required: ["name", "role", "email", "linkedin", "evidenceUrl"],
        additionalProperties: false
      }
    }
  },
  required: ["contacts"],
  additionalProperties: false
};

function cleanContacts(items: any[], source: string): PublicMarketingContact[] {
  return items.flatMap((item): PublicMarketingContact[] => {
    const email = typeof item?.email === "string" ? item.email.trim().toLowerCase() : "";
    const role = typeof item?.role === "string" ? item.role.trim() : "";
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const evidenceUrl = typeof item?.evidenceUrl === "string" ? item.evidenceUrl.trim() : "";
    const functional = usefulFunctionalMailbox.test(email);
    const namedRelevantContact = !!name && !!role && /marketing|marca|brand|comunicaci|growth|expansi|franqui/i.test(role);
    if (!exactEmailPattern.test(email) || !evidenceUrl || (!namedRelevantContact && !functional)) return [];
    return [{ email, name: name || "Departamento corporativo", role: role || "Contacto funcional de marketing o expansión", linkedin: item.linkedin || null, source, providerConfidence: functional ? 80 : 70, evidenceUrl }];
  });
}

export async function researchCorporateWebsite(workspaceId: string, brand: string, website: string): Promise<PublicMarketingContact[]> {
  const base = safeUrl(website);
  if (!base) return [];
  const home = await readHtml(base.origin);
  if (!home) return [];
  const urls = internalResearchLinks(home, base);
  const pages = await Promise.all(urls.map(async (url) => ({ url, html: url === base.origin ? home : await readHtml(url) })));
  const directMailboxes = extractCorporateMailboxes(pages, base.hostname);
  const evidence = pages
    .filter((page) => page.html)
    .map((page) => `FUENTE: ${page.url}\n${visibleText(page.html).slice(0, 12_000)}`)
    .join("\n\n")
    .slice(0, 55_000);
  if (!evidence || !(evidence.match(emailPattern) ?? []).length) return directMailboxes;
  emailPattern.lastIndex = 0;
  try {
    const result = await completeJson<any>({
      workspaceId,
      feature: "franchise_public_contact_research",
      system: "Extrae responsables de marketing, marca, comunicación, growth o expansión. Prohibido inventar nombres, cargos o emails. Incluye solo contactos cuyo nombre, cargo y email aparezcan explícitamente en las fuentes proporcionadas.",
      user: `Marca: ${brand}\n\n${evidence}`,
      schema: resultSchema,
      maxTokens: 1400
    });
    const aiContacts = cleanContacts(Array.isArray(result?.contacts) ? result.contacts : [], "corporate_website");
    return [...directMailboxes, ...aiContacts].filter((candidate, index, list) => list.findIndex((item) => item.email === candidate.email) === index);
  } catch { return directMailboxes; }
}

function parseJsonObject(text: string): any {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

export async function researchPublicWeb(workspaceId: string, brand: string, domain: string): Promise<PublicMarketingContact[]> {
  const stored: Record<string, string> = await loadStoredAdhocCredentials(workspaceId).catch(() => ({}));
  const apiKey = process.env.PERPLEXITY_API_KEY || stored.PERPLEXITY_API_KEY || stored.perplexityApiKey;
  if (!apiKey) return [];
  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        temperature: 0,
        max_tokens: 1400,
        messages: [{ role: "user", content: `Investiga fuentes públicas actuales para localizar responsables o contactos funcionales de marketing, marca, comunicación, growth, expansión o franquicias de "${brand}" (${domain}). Primero resuelve su grupo matriz, operador y razón social. Busca en webs oficiales, asociaciones de franquicias, fichas AEF, ferias y congresos, notas de prensa, medios sectoriales, entrevistas, ponentes, PDFs y catálogos profesionales. Devuelve SOLO JSON {"contacts":[{"name":string|null,"role":string|null,"email":string|null,"linkedin":string|null,"evidenceUrl":string|null}]}. Acepta buzones funcionales publicados de esos departamentos aunque no tengan nombre personal. Cada resultado debe incluir la URL exacta que publica el email. No deduzcas patrones ni inventes emails.` }]
      }),
      signal: AbortSignal.timeout(25_000)
    });
    if (!response.ok) return [];
    const json: any = await response.json().catch(() => null);
    const parsed = parseJsonObject(json?.choices?.[0]?.message?.content ?? "");
    return cleanContacts(Array.isArray(parsed?.contacts) ? parsed.contacts : [], "perplexity_public_web");
  } catch { return []; }
}
