import { prisma } from "@/lib/db/prisma";
import { metaAdsDownloadLeads, metaAdsListAdsets, metaAdsListCampaigns } from "@/lib/integrations/meta-ads";
import { readMetaTokenByConnection } from "@/lib/meta/connection";
import type { Prisma } from "@prisma/client";

function first(row: Record<string, string>, keys: string[]) {
  for (const key of keys) if (row[key]?.trim()) return row[key].trim();
  return null;
}

export async function syncMetaLeadsForAccount(opts: { workspaceId: string; adAccountId: string; connectionId: string }) {
  const token = await readMetaTokenByConnection(opts.workspaceId, opts.connectionId);
  if (!token) throw new Error("La conexión Meta no está disponible");
  const adhoc = { META_ADS_TOKEN: token, META_ADS_AD_ACCOUNT_ID: opts.adAccountId };
  const latest = await prisma.metaLeadAttribution.findFirst({ where: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
  // Releer una ventana de 7 días absorbe leads que Meta entregue con retraso;
  // el upsert por externalLeadId evita duplicados.
  const sinceDate = latest ? new Date(latest.occurredAt.getTime() - 7 * 86_400_000) : new Date(Date.now() - 90 * 86_400_000);
  const since = sinceDate.toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  const listed = await metaAdsListCampaigns({ workspaceId: opts.workspaceId, status: "ACTIVE", statusField: "effective_status", refreshStatuses: true, limit: 100, adhoc });
  const campaigns = listed.filter((campaign: any) => String(campaign.configured_status ?? "").toUpperCase() === "ACTIVE");
  let imported = 0; let updated = 0;
  for (const campaign of campaigns) {
    const adsets = await metaAdsListAdsets({ workspaceId: opts.workspaceId, campaignId: String(campaign.id), adhoc, limit: 100 });
    const adsetById = new Map(adsets.map((item: any) => [String(item.id), item]));
    const result = await metaAdsDownloadLeads({ workspaceId: opts.workspaceId, campaignId: String(campaign.id), since, until, adhoc });
    for (const row of result.leads) {
      const externalLeadId = row.lead_id;
      if (!externalLeadId) continue;
      const existing = await prisma.metaLeadAttribution.findUnique({ where: { workspaceId_adAccountId_externalLeadId: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId, externalLeadId } }, select: { id: true } });
      const adset = adsetById.get(String(row.adset_id ?? "")) as any;
      const metadata = { ...row, pixelId: adset?.promoted_object?.pixel_id ?? null, metaConnectionId: opts.connectionId } as Prisma.InputJsonValue;
      const data = {
        campaignId: String(campaign.id), campaignName: String(campaign.name), adsetId: row.adset_id || null,
        adsetName: adset?.name ? String(adset.name) : null, adId: row.ad_id || null, formId: row.form_id || null,
        contactName: first(row, ["full_name", "nombre_completo", "name", "nombre"]),
        email: first(row, ["email", "correo_electronico", "correo"]),
        phone: first(row, ["phone_number", "phone", "telefono", "teléfono"]),
        occurredAt: row.created_time ? new Date(row.created_time) : new Date(), metadata
      };
      await prisma.metaLeadAttribution.upsert({
        where: { workspaceId_adAccountId_externalLeadId: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId, externalLeadId } },
        create: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId, externalLeadId, ...data }, update: data
      });
      if (existing) updated++; else imported++;
    }
  }
  return { imported, updated, campaigns: campaigns.length, since, until };
}
