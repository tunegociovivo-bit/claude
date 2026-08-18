import { decryptSecret } from "@/lib/ai/crypto";
import { prisma } from "@/lib/db/prisma";
import { discoverEventUrls, extractFairFromPage, filterUpcomingFairs, type DiscoveredFair } from "./trade-fair-discovery";

const ORGANIZERS = [
  { name: "IFEMA Madrid", calendar: "https://www.ifema.es/calendario", paths: [/^\/[a-z0-9-]+\/?$/i, /^\/evento\/[a-z0-9-]+\/?$/i] },
  { name: "Fira Barcelona", calendar: "https://www.firabarcelona.com/es/calendario/", paths: [/\/evento\//i, /\/events?\//i] },
  { name: "Feria Valencia", calendar: "https://www.feriavalencia.com/calendario/", paths: [/\/evento\//i, /\/certamen\//i] },
  { name: "Bilbao Exhibition Centre", calendar: "https://www.bilbaoexhibitioncentre.com/agenda/", paths: [/\/evento\//i, /\/event\//i] }
] as const;

async function scrapflyKey(workspaceId: string): Promise<string | null> {
  if (process.env.SCRAPFLY_API_KEY) return process.env.SCRAPFLY_API_KEY;
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const encrypted = (workspace?.settings as any)?.leads?.scrapflyApiKeyEnc;
  return encrypted ? decryptSecret(encrypted) : null;
}

async function fetchHtml(url: string, key: string | null): Promise<string> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NegocioVivoFairFinder/1.0)", Accept: "text/html" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    const html = response.ok ? await response.text() : ""; if (html.length > 500) return html.slice(0, 1_500_000);
  } catch {}
  if (!key) return "";
  try {
    const endpoint = `https://api.scrapfly.io/scrape?key=${encodeURIComponent(key)}&asp=true&render_js=true&country=es&url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(45_000) }); const data: any = await response.json().catch(() => null);
    return typeof data?.result?.content === "string" ? data.result.content.slice(0, 1_500_000) : "";
  } catch { return ""; }
}

export async function searchUpcomingTradeFairs(workspaceId: string, opts?: { keyword?: string; organizer?: string; max?: number }) {
  const key = await scrapflyKey(workspaceId); const found: DiscoveredFair[] = []; const diagnostics: { organizer: string; events: number; error?: string }[] = [];
  for (const source of ORGANIZERS) {
    if (opts?.organizer && source.name !== opts.organizer) continue;
    const calendar = await fetchHtml(source.calendar, key);
    if (!calendar) { diagnostics.push({ organizer: source.name, events: 0, error: "Calendario no accesible" }); continue; }
    const urls = discoverEventUrls(calendar, source.calendar, [...source.paths]).slice(0, 40);
    let count = 0;
    for (let i = 0; i < urls.length; i += 6) {
      const pages = await Promise.all(urls.slice(i, i + 6).map(async (url) => ({ url, html: await fetchHtml(url, key) })));
      for (const page of pages) { const fair = page.html ? extractFairFromPage(page.html, page.url, source.name) : null; if (fair) { found.push(fair); count++; } }
    }
    diagnostics.push({ organizer: source.name, events: count });
  }
  return { fairs: filterUpcomingFairs(found, new Date(), opts?.keyword).slice(0, Math.min(opts?.max ?? 100, 200)), diagnostics };
}
