import { prisma } from "@/lib/db/prisma";
import { metaAdsDownloadLeads, metaAdsListAdsets, metaAdsListCampaigns } from "@/lib/integrations/meta-ads";
import { readMetaTokenByConnection } from "@/lib/meta/connection";
import type { Prisma } from "@prisma/client";

function first(row: Record<string, string>, keys: string[]) {
  for (const key of keys) if (row[key]?.trim()) return row[key].trim();
  return null;
}

type CampaignRef = { id: string; name: string };
type SyncState = { nextAt?: string; lastAt?: string; lastError?: string | null; campaigns?: CampaignRef[] };

function readSyncState(value: unknown): SyncState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state = (value as Record<string, unknown>).metaLeadSync;
  return state && typeof state === "object" && !Array.isArray(state) ? state as SyncState : {};
}

async function saveSyncState(workspaceId: string, adAccountId: string, current: unknown, state: SyncState) {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  await prisma.metaClientProfile.update({
    where: { workspaceId_adAccountId: { workspaceId, adAccountId } },
    data: { alertRules: { ...base, metaLeadSync: state } as Prisma.InputJsonValue }
  });
}

export async function syncMetaLeadsForAccount(opts: { workspaceId: string; adAccountId: string; connectionId: string; campaigns?: CampaignRef[]; force?: boolean }) {
  const profile = await prisma.metaClientProfile.findUnique({
    where: { workspaceId_adAccountId: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId } },
    select: { alertRules: true }
  });
  const previousState = readSyncState(profile?.alertRules);
  const requestedIds = (opts.campaigns ?? []).map((campaign) => campaign.id).sort().join(",");
  const rememberedIds = (previousState.campaigns ?? []).map((campaign) => campaign.id).sort().join(",");
  const campaignsChanged = Boolean(requestedIds && requestedIds !== rememberedIds);
  if (!opts.force && !campaignsChanged && previousState.nextAt && new Date(previousState.nextAt).getTime() > Date.now()) {
    return { imported: 0, updated: 0, campaigns: previousState.campaigns?.length ?? 0, deferred: true, nextAt: previousState.nextAt, reason: previousState.lastError ?? "Sincronización programada" };
  }
  const token = await readMetaTokenByConnection(opts.workspaceId, opts.connectionId);
  if (!token) throw new Error("La conexión Meta no está disponible");
  const adhoc = { META_ADS_TOKEN: token, META_ADS_AD_ACCOUNT_ID: opts.adAccountId };
  const latest = await prisma.metaLeadAttribution.findFirst({ where: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
  // Releer una ventana de 7 días absorbe leads que Meta entregue con retraso;
  // el upsert por externalLeadId evita duplicados.
  const sinceDate = latest ? new Date(latest.occurredAt.getTime() - 7 * 86_400_000) : new Date(Date.now() - 90 * 86_400_000);
  const since = sinceDate.toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  let campaigns: CampaignRef[] = [];
  try {
    const listed = await metaAdsListCampaigns({ workspaceId: opts.workspaceId, status: "ACTIVE", statusField: "effective_status", limit: 100, adhoc });
    campaigns = listed.filter((campaign: any) => String(campaign.configured_status ?? "").toUpperCase() === "ACTIVE").map((campaign: any) => ({ id: String(campaign.id), name: String(campaign.name) }));
    const validIds = new Set(campaigns.map((campaign) => campaign.id));
    const staleIds = (previousState.campaigns ?? []).map((campaign) => campaign.id).filter((id) => !validIds.has(id));
    if (staleIds.length && previousState.lastAt) {
      const bugWindowStart = new Date(new Date(previousState.lastAt).getTime() - 15 * 60_000);
      await prisma.metaLeadAttribution.deleteMany({
        where: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId, source: "meta", status: "new", campaignId: { in: staleIds }, createdAt: { gte: bugWindowStart } }
      });
    }
    // Nunca confiamos en IDs de campaña enviados por el navegador. La lista
    // validada contra la cuenta evita mezclar leads al cambiar de cliente.
    const requested = new Set((opts.campaigns ?? []).map((campaign) => campaign.id));
    if (requested.size) campaigns = campaigns.filter((campaign) => requested.has(campaign.id));
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (/request limit reached|demasiadas llamadas|code.?17|2446079/i.test(message)) {
      const nextAt = new Date(Date.now() + 60 * 60_000).toISOString();
      await saveSyncState(opts.workspaceId, opts.adAccountId, profile?.alertRules, { ...previousState, nextAt, lastError: "Meta ha limitado temporalmente las consultas; reintento automático programado." });
      return { imported: 0, updated: 0, campaigns: 0, since, until, deferred: true, nextAt, reason: "Meta ha limitado temporalmente las consultas; reintento automático programado." };
    }
    throw error;
  }
  let imported = 0; let updated = 0;
  try {
   for (const campaign of campaigns) {
    const result = await metaAdsDownloadLeads({ workspaceId: opts.workspaceId, campaignId: campaign.id, since, until, adhoc });
    let adsetById = new Map<string, any>();
    if (result.leads.length) {
      try {
        const adsets = await metaAdsListAdsets({ workspaceId: opts.workspaceId, campaignId: campaign.id, adhoc, limit: 100 });
        adsetById = new Map(adsets.map((item: any) => [String(item.id), item]));
      } catch (error: any) {
        // La atribución del lead es prioritaria. Si Meta limita esta consulta
        // auxiliar, importamos igualmente y el feedback quedará pendiente.
        if (!/request limit reached|demasiadas llamadas|code.?17|2446079/i.test(String(error?.message ?? error))) throw error;
      }
    }
    for (const row of result.leads) {
      const externalLeadId = row.lead_id;
      if (!externalLeadId) continue;
      const existing = await prisma.metaLeadAttribution.findUnique({ where: { workspaceId_adAccountId_externalLeadId: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId, externalLeadId } }, select: { id: true } });
      const adset = adsetById.get(String(row.adset_id ?? ""));
      const metadata = { ...row, pixelId: adset?.promoted_object?.pixel_id ?? null, metaConnectionId: opts.connectionId } as Prisma.InputJsonValue;
      const data = {
        campaignId: campaign.id, campaignName: campaign.name, adsetId: row.adset_id || null,
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
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (/request limit reached|demasiadas llamadas|code.?17|2446079/i.test(message)) {
      const nextAt = new Date(Date.now() + 60 * 60_000).toISOString();
      await saveSyncState(opts.workspaceId, opts.adAccountId, profile?.alertRules, { ...previousState, campaigns, nextAt, lastError: "Meta ha limitado temporalmente las consultas; reintento automático programado." });
      return { imported, updated, campaigns: campaigns.length, since, until, deferred: true, nextAt, reason: "Meta ha limitado temporalmente las consultas; reintento automático programado." };
    }
    throw error;
  }
  const nextAt = new Date(Date.now() + 15 * 60_000).toISOString();
  await saveSyncState(opts.workspaceId, opts.adAccountId, profile?.alertRules, { ...previousState, campaigns, nextAt, lastAt: new Date().toISOString(), lastError: null });
  return { imported, updated, campaigns: campaigns.length, since, until, deferred: false, nextAt };
}
