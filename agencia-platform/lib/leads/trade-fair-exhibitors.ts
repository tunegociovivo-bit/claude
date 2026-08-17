import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { placesTextSearch } from "./google-places";
import { enqueueMessage } from "./send-queue";
import { buildFairOutreach, discoverExhibitorUrls, extractExhibitor, normalizeFairInput, type FairInput } from "./trade-fair-core";

async function fetchPublicHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NegocioVivoFairBot/1.0)", Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`El catálogo respondió ${response.status}`);
  return (await response.text()).slice(0, 1_500_000);
}

function digits(value: string | null | undefined): string { return (value ?? "").replace(/\D/g, "").replace(/^0034/, "34"); }
function domainOf(value: string | null | undefined): string { try { return value ? new URL(value).hostname.replace(/^www\./, "") : ""; } catch { return ""; } }

export async function importTradeFairExhibitors(workspaceId: string, raw: FairInput) {
  const fair = normalizeFairInput(raw);
  const catalog = await fetchPublicHtml(fair.url);
  const urls = discoverExhibitorUrls(catalog, fair.url).slice(0, fair.maxExhibitors);
  if (!urls.length) throw new Error("No se encontraron fichas de expositores en ese catálogo");
  const search = await prisma.leadSearch.create({ data: { workspaceId, keyword: fair.name, location: fair.venue, source: "trade_fair_exhibitors", status: "RUNNING", scope: "custom", startedAt: new Date(), sourceConfig: fair as any, totalProvinces: 1 } });
  const existing = await prisma.lead.findMany({ where: { workspaceId }, select: { phone: true, internationalPhone: true, website: true } });
  const knownPhones = new Set(existing.flatMap((lead) => [digits(lead.phone), digits(lead.internationalPhone)]).filter(Boolean));
  const knownDomains = new Set(existing.map((lead) => domainOf(lead.website)).filter(Boolean));
  let imported = 0, skipped = 0, queued = 0, errors = 0;
  const leadIds: string[] = [];
  try {
    for (let i = 0; i < urls.length; i += 4) {
      const contacts = await Promise.all(urls.slice(i, i + 4).map(async (url) => { try { return extractExhibitor(await fetchPublicHtml(url), url); } catch { errors++; return null; } }));
      for (const contact of contacts) {
        if (!contact) continue;
        if (!contact.phone || !contact.website) {
          try {
            const hit = (await placesTextSearch({ workspaceId, query: `${contact.name} ${fair.venue}`, maxPages: 1, pageSize: 1 }))[0];
            if (hit) { contact.phone ||= hit.internationalPhone ?? hit.phone ?? null; contact.website ||= hit.website ?? null; }
          } catch {}
        }
        const phoneKey = digits(contact.phone); const domain = domainOf(contact.website);
        if ((phoneKey && knownPhones.has(phoneKey)) || (domain && knownDomains.has(domain))) { skipped++; continue; }
        const placeId = `fair:${createHash("sha256").update(`${fair.url}|${contact.url}|${contact.name}`).digest("hex").slice(0, 40)}`;
        const message = buildFairOutreach({ exhibitor: contact.name, fair: fair.name, venue: fair.venue, startsAt: fair.startsAt, endsAt: fair.endsAt, stand: contact.stand });
        const lead = await prisma.lead.create({ data: { workspaceId, searchId: search.id, placeId, name: contact.name, phone: contact.phone, internationalPhone: contact.phone, website: contact.website, email: contact.email, category: "Expositor de feria", score: 90, urgency: "alta", aiOpener: message, rawData: { source: "trade_fair_exhibitors", fair: { ...fair, stand: contact.stand }, sourceUrl: contact.url, outreachMessage: message } } });
        imported++; leadIds.push(lead.id); if (phoneKey) knownPhones.add(phoneKey); if (domain) knownDomains.add(domain);
        if (fair.autoQueue && contact.phone) { try { await enqueueMessage({ workspaceId, leadId: lead.id, body: message, templateId: null, kind: "text" }); queued++; } catch {} }
      }
    }
    await prisma.leadSearch.update({ where: { id: search.id }, data: { status: "COMPLETED", completedAt: new Date(), processedProvinces: 1, totalResults: imported, leadsSkipped: skipped } });
    return { searchId: search.id, discovered: urls.length, imported, skipped, queued, errors, leadIds };
  } catch (error: any) {
    await prisma.leadSearch.update({ where: { id: search.id }, data: { status: "FAILED", completedAt: new Date(), errorMessage: String(error?.message ?? error).slice(0, 1000), totalResults: imported, leadsSkipped: skipped } }).catch(() => {});
    throw error;
  }
}
