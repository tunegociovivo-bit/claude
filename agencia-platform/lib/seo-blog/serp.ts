/**
 * Investigación SERP real (Serper.dev): top 10, People Also Ask, búsquedas
 * relacionadas y extracción de encabezados/longitud de los mejores resultados.
 * Sin API key devuelve null y la IA trabaja sin datos SERP.
 */
import { hostOf, plainText, wordCount } from "./util";

export type Serp = {
  organic: { position: number; title: string; link: string; snippet: string }[];
  paa: string[];
  related: string[];
};

const cache = new Map<string, { at: number; data: any }>();
const TTL = 6 * 60 * 60 * 1000;

function cached<T>(key: string): T | undefined {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.data as T;
  return undefined;
}

export async function serperSearch(apiKey: string | null, q: string, gl = "es", hl = "es"): Promise<Serp | null> {
  if (!apiKey) return null;
  const key = `serp:${gl}:${hl}:${q}`;
  const hit = cached<Serp>(key);
  if (hit) return hit;
  try {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q, gl, hl, num: 10 }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!r.ok) return null;
    const d: any = await r.json();
    const out: Serp = {
      organic: (d.organic ?? []).slice(0, 10).map((o: any, i: number) => ({
        position: o.position ?? i + 1,
        title: String(o.title ?? ""),
        link: String(o.link ?? ""),
        snippet: String(o.snippet ?? "")
      })),
      paa: (d.peopleAlsoAsk ?? []).map((x: any) => String(x.question ?? "")).filter(Boolean),
      related: (d.relatedSearches ?? []).map((x: any) => String(x.query ?? "")).filter(Boolean)
    };
    cache.set(key, { at: Date.now(), data: out });
    return out;
  } catch {
    return null;
  }
}

/** Encabezados H2/H3 y nº de palabras de las mejores URLs (máx 3) → análisis de gaps. */
export async function competitorOutlines(organic: Serp["organic"], excludeHost: string, max = 3) {
  const out: { url: string; words: number; headings: string[] }[] = [];
  for (const o of organic) {
    if (out.length >= max) break;
    const h = hostOf(o.link);
    if (!h || (excludeHost && h === excludeHost)) continue;
    if (/(youtube|facebook|instagram|tiktok|pinterest|amazon)\./i.test(h)) continue;
    const key = `outl:${o.link}`;
    const hit = cached<{ url: string; words: number; headings: string[] }>(key);
    if (hit) {
      out.push(hit);
      continue;
    }
    try {
      const r = await fetch(o.link, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NVPublicador/1.0)" },
        redirect: "follow",
        signal: AbortSignal.timeout(12_000)
      });
      if (!r.ok) continue;
      let html = (await r.text()).slice(0, 1_500_000);
      html = html.replace(/<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, "");
      const headings: string[] = [];
      for (const m of html.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
        const t = plainText(m[2]);
        if (t && t.length < 160) headings.push(`H${m[1]}: ${t}`);
        if (headings.length >= 30) break;
      }
      const item = { url: o.link, words: wordCount(html), headings };
      cache.set(key, { at: Date.now(), data: item });
      out.push(item);
    } catch {
      /* resultado inaccesible: se ignora */
    }
  }
  return out;
}

const AUTH_RE =
  /(\.gob\.es|\.gov|\.edu|\.org|wikipedia\.org|europa\.eu|boe\.es|who\.int|ine\.es|\.ac\.|\.int$|juntadeandalucia\.es|\.csic\.es|nih\.gov|agenciatributaria|seg-social|sanidad\.gob|aemps)/i;

export function isAuthority(link: string, siteHost: string, competitors: string[]): boolean {
  const h = hostOf(link);
  if (!h || (siteHost && h === siteHost)) return false;
  for (const c of competitors) {
    const ch = c.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/.*$/, "").toLowerCase();
    if (ch && h.includes(ch)) return false;
  }
  return AUTH_RE.test(h);
}
