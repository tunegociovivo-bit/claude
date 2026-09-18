export type FacebookReviewItem = { url: string; label: string; kind: "link" | "search"; reviewed: boolean };
export const MAX_FACEBOOK_REVIEW_ITEMS = 100;

export function normalizeFacebookReviewUrl(value: string): string {
  if (value.length > 4096) throw new Error("El enlace es demasiado largo.");
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    !["facebook.com", "www.facebook.com", "m.facebook.com", "mbasic.facebook.com", "web.facebook.com"].includes(url.hostname)) {
    throw new Error("Usa enlaces HTTPS de facebook.com, sin acortadores externos.");
  }
  url.hostname = "www.facebook.com";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || ["fbclid", "mibextid", "ref", "refsrc"].includes(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

export function addFacebookReviewLinks(current: FacebookReviewItem[], input: string) {
  const items = [...current];
  const rejected: number[] = [];
  let added = 0;
  let duplicates = 0;
  input.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const url = normalizeFacebookReviewUrl(line);
      if (items.some(item => item.url === url)) { duplicates++; return; }
      if (items.length >= MAX_FACEBOOK_REVIEW_ITEMS) throw new Error("Límite de cola");
      items.push({ url, label: url, kind: "link", reviewed: false });
      added++;
    } catch { rejected.push(index + 1); }
  });
  return { items, added, duplicates, rejected };
}

export function facebookKeywordReviewItem(keyword: string): FacebookReviewItem {
  const query = keyword.trim();
  if (!query || query.length > 200) throw new Error("Introduce una palabra clave de hasta 200 caracteres.");
  return { url: normalizeFacebookReviewUrl(`https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}`), label: query, kind: "search", reviewed: false };
}

export function parseFacebookReviewQueue(input: string): FacebookReviewItem[] {
  const value: unknown = JSON.parse(input);
  if (!Array.isArray(value) || value.length > MAX_FACEBOOK_REVIEW_ITEMS) throw new Error("Cola guardada no válida.");
  return value.map(item => {
    if (!item || typeof item.url !== "string" || typeof item.label !== "string" || item.label.length > 4096 ||
      !["search", "link"].includes(item.kind) || typeof item.reviewed !== "boolean") throw new Error("Cola guardada no válida.");
    return { url: normalizeFacebookReviewUrl(item.url), label: item.label, kind: item.kind, reviewed: item.reviewed };
  });
}
