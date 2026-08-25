import type { FranchiseSignal } from "./franchise-growth-engine";

const rules: Array<{ type: FranchiseSignal["type"]; strength: number; pattern: RegExp }> = [
  { type: "new_locations", strength: 90, pattern: /abre|apertura|nuevo (?:centro|local|establecimiento|restaurante|tienda)|nuevas ubicaciones/i },
  { type: "franchise_expansion", strength: 88, pattern: /expansi[oó]n|crece|franquiciad|plan de crecimiento|nuevos mercados/i },
  { type: "marketing_hiring", strength: 82, pattern: /director(?:a)? de marketing|responsable de marketing|chief marketing|cmo|head of marketing/i },
  { type: "investment", strength: 85, pattern: /inversi[oó]n|ronda|ampliaci[oó]n de capital|adquisici[oó]n/i },
  { type: "ownership_change", strength: 80, pattern: /nuevo propietario|cambio de administr|nuevo consejero|nuevo director general/i },
  { type: "launch", strength: 72, pattern: /lanzamiento|nueva campa[ñn]a|presenta su nueva|estrena/i }
];

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export function classifyFranchiseNews(items: Array<{ title: string; link?: string | null; publishedAt?: string | null }>): FranchiseSignal[] {
  const seen = new Set<string>();
  const signals: FranchiseSignal[] = [];
  for (const item of items) {
    const rule = rules.find((candidate) => candidate.pattern.test(item.title));
    if (!rule) continue;
    const key = `${rule.type}:${item.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push({ type: rule.type, strength: rule.strength, observedAt: item.publishedAt ?? new Date().toISOString(), evidence: item.title, sourceUrl: item.link ?? null });
  }
  return signals.slice(0, 12);
}

export async function fetchFranchiseSignals(brand: string): Promise<FranchiseSignal[]> {
  const query = encodeURIComponent(`"${brand}" (franquicia OR expansión OR apertura OR marketing OR inversión) when:90d`);
  try {
    const response = await fetch(`https://news.google.com/rss/search?q=${query}&hl=es&gl=ES&ceid=ES:es`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
      const body = match[1];
      const value = (tag: string) => decodeXml(body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]?.trim() ?? "");
      return { title: value("title"), link: value("link"), publishedAt: value("pubDate") ? new Date(value("pubDate")).toISOString() : null };
    });
    return classifyFranchiseNews(items);
  } catch {
    return [];
  }
}
