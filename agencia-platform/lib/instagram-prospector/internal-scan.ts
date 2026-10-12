export type InstagramProspectorLead = {
  name: string;
  handle: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  source: string;
  tag: string;
  score: number;
  status: string;
  signals: string[];
  missingSignals: string[];
};

export type InstagramProspectorScanInput = {
  sourceType: "followers" | "likers" | "comments" | "hashtag" | "location";
  target: string;
  limit: number;
  country: string;
  requiredSignalCount: number;
  requireIntentSignal: boolean;
  emailKeywords: string;
  intentSignals: string;
  negativeFilters: string;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+34\s?)?(?:[6789]\d[\s.-]?){4}\d/g;
const URL_RE = /https?:\/\/(?:www\.)?([^"' <>)]+)/gi;

export function parseList(value: string) {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeInstagramSource(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!url.hostname.includes("instagram.com")) return null;
      const handle = url.pathname.split("/").filter(Boolean)[0];
      return handle ? { handle, url: `https://www.instagram.com/${handle}/` } : null;
    } catch {
      return null;
    }
  }
  const handle = trimmed.replace(/^@/, "").split(/[/?#]/)[0];
  return handle ? { handle, url: `https://www.instagram.com/${handle}/` } : null;
}

function hasIntentSignal(signals: string[]) {
  return signals.some((signal) => /intencion|franquicia|inversion|negocio|expansion/i.test(signal));
}

function getEmailKeywordMatch(email: string, keywords: string[]) {
  const normalizedEmail = email.toLowerCase();
  return keywords.find((keyword) => normalizedEmail.includes(keyword.toLowerCase())) || "";
}

function extractTitle(html: string, fallback: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = ogTitle || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || fallback;
  return title.replace(/\s*\(@[^)]+\)\s*.*$/i, "").replace(/\s*•\s*Instagram.*$/i, "").trim() || fallback;
}

function extractWebsite(html: string) {
  const matches = [...html.matchAll(URL_RE)]
    .map((match) => `https://${match[1]}`.replace(/\\u0026/g, "&"))
    .filter((url) => !url.includes("instagram.com") && !url.includes("facebook.com") && !url.includes("cdninstagram.com"));
  return matches[0] || "";
}

function buildSignals(params: { html: string; email: string; website: string; phone: string; intentKeywords: string[] }) {
  const haystack = params.html.toLowerCase();
  const signals: string[] = [];
  if (params.email) signals.push("Email publico");
  if (params.phone) signals.push("Telefono publico");
  if (params.website) signals.push("Web enlazada");
  if (params.intentKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) signals.push("Intencion franquicia");
  if (/franquicia|franquiciado|autoempleo|inversion|negocio propio|expansion/i.test(params.html)) signals.push("Interes negocio");
  return [...new Set(signals)];
}

function validateLead(lead: InstagramProspectorLead, requiredSignalCount: number, requireIntentSignal: boolean) {
  const missingSignals: string[] = [];
  if (lead.signals.length < requiredSignalCount) missingSignals.push(`Menos de ${requiredSignalCount} senales`);
  if (requireIntentSignal && !hasIntentSignal(lead.signals)) missingSignals.push("Sin intencion franquicia/inversion");
  return missingSignals;
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (compatible; NegocioVivoProspector/1.0; +https://hub.negociovivo.app)"
      },
      signal: controller.signal
    });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function runInternalInstagramScan(input: InstagramProspectorScanInput) {
  const sources = parseList(input.target)
    .map(normalizeInstagramSource)
    .filter((source): source is { handle: string; url: string } => Boolean(source))
    .slice(0, Math.min(input.limit, 40));
  const emailKeywords = parseList(input.emailKeywords);
  const intentKeywords = parseList(input.intentSignals);
  const leads: InstagramProspectorLead[] = [];
  const skipped: string[] = [];

  for (const source of sources) {
    const html = await fetchText(source.url);
    if (!html) {
      skipped.push(`${source.handle}: Instagram no devolvio HTML publico util`);
      continue;
    }
    const emails = [...new Set(html.match(EMAIL_RE) || [])];
    const email = emails.find((item) => !emailKeywords.length || getEmailKeywordMatch(item, emailKeywords)) || "";
    if (emailKeywords.length && !email) {
      skipped.push(`${source.handle}: sin email que coincida con ${emailKeywords.join(", ")}`);
      continue;
    }
    const phone = (html.match(PHONE_RE) || [])[0] || "";
    const website = extractWebsite(html);
    const signals = buildSignals({ html, email, website, phone, intentKeywords });
    const lead: InstagramProspectorLead = {
      name: extractTitle(html, source.handle),
      handle: `@${source.handle}`,
      email,
      phone,
      website,
      city: input.country,
      source: source.url,
      tag: input.sourceType === "followers" ? "Perfil publico" : input.sourceType,
      score: Math.min(95, 40 + signals.length * 14 + (email ? 12 : 0)),
      status: "Pendiente",
      signals,
      missingSignals: []
    };
    lead.missingSignals = validateLead(lead, input.requiredSignalCount, input.requireIntentSignal);
    lead.status = lead.missingSignals.length ? "Insuficiente" : "Valido";
    leads.push(lead);
  }

  return {
    mode: "internal_public_web",
    leads,
    scannedSources: sources.length,
    skipped,
    notice: "Motor propio: solo analiza datos publicos disponibles en las URLs/perfiles indicados. Instagram no expone seguidores, likes o comentarios completos sin una sesion/agente autorizado."
  };
}
