import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { attributionMetrics, META_LEAD_STAGES, stageDates } from "@/lib/meta/attribution";
import type { Prisma } from "@prisma/client";
import { deleteUrlLeadSource, resetCampaignLeadSources, saveUrlLeadSource, syncUrlLeadSource } from "@/lib/meta/url-lead-sync";

export const dynamic = "force-dynamic";

const account = z.string().regex(/^act_\d+$/);
const profileSchema = z.object({ action: z.literal("profile"), adAccountId: account, displayName: z.string().trim().min(1).max(200), clientId: z.string().max(100).nullish(), metaConnectionId: z.string().max(100).nullish(), monthlyBudgetCents: z.number().int().min(0).max(100_000_000).default(0), targetLeads: z.number().int().min(0).max(1_000_000).nullish(), targetCplCents: z.number().int().min(0).max(100_000_000).nullish(), targetQualifiedCplCents: z.number().int().min(0).max(100_000_000).nullish(), salesValueCents: z.number().int().min(0).max(1_000_000_000).nullish(), businessBrief: z.string().max(20_000).nullish(), creativeMemory: z.record(z.string(), z.unknown()).optional(), audienceMemory: z.record(z.string(), z.unknown()).optional() });
const leadSchema = z.object({ action: z.literal("lead"), adAccountId: account, externalLeadId: z.string().trim().min(1).max(200), campaignId: z.string().max(100).nullish(), campaignName: z.string().max(300).nullish(), adsetId: z.string().max(100).nullish(), adsetName: z.string().max(300).nullish(), adId: z.string().max(100).nullish(), adName: z.string().max(300).nullish(), formId: z.string().max(100).nullish(), contactName: z.string().max(300).nullish(), email: z.string().email().max(320).nullish(), phone: z.string().max(50).nullish(), status: z.enum(META_LEAD_STAGES).default("new"), revenueCents: z.number().int().min(0).max(1_000_000_000).default(0), qualityScore: z.number().int().min(0).max(100).nullish(), occurredAt: z.coerce.date().optional(), metadata: z.record(z.string(), z.unknown()).optional() });
const campaignNotesSchema = z.object({ action: z.literal("campaign_notes"), adAccountId: account, accountName: z.string().trim().min(1).max(200), campaignId: z.string().trim().min(1).max(100), campaignName: z.string().trim().min(1).max(300), qualificationNotes: z.string().max(20_000) });
const leadSourceSchema = z.object({ action: z.literal("lead_source"), adAccountId: account, accountName: z.string().trim().min(1).max(200), campaignId: z.string().trim().min(1).max(100), campaignName: z.string().trim().min(1).max(300), sourceId: z.string().uuid().optional(), url: z.string().url().max(2000), label: z.string().trim().max(120).optional(), intervalMinutes: z.union([z.literal(60), z.literal(360), z.literal(720), z.literal(1440)]), enabled: z.boolean().default(true) });
const syncLeadSourceSchema = z.object({ action: z.literal("sync_lead_source"), adAccountId: account, sourceId: z.string().uuid() });
const deleteLeadSourceSchema = z.object({ action: z.literal("delete_lead_source"), adAccountId: account, sourceId: z.string().uuid() });

export const GET = withApi({}, async (req, { api }) => {
  const url = new URL(req.url); const adAccountId = url.searchParams.get("accountId");
  if (!adAccountId || !account.safeParse(adAccountId).success) throw new ApiError(400, "invalid_account", "Cuenta publicitaria no válida");
  const [profile, items, workspace] = await Promise.all([
    prisma.metaClientProfile.findUnique({ where: { workspaceId_adAccountId: { workspaceId: api.workspaceId, adAccountId } } }),
    prisma.metaLeadAttribution.findMany({ where: { workspaceId: api.workspaceId, adAccountId }, orderBy: { occurredAt: "desc" }, take: 500 }),
    prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } })
  ]);
  const safeProfile = profile ? (({ webhookToken: _secret, ...rest }) => rest)(profile) : null;
  const leadDrive = (workspace?.settings as any)?.integrations?.googleLeadDocuments;
  return NextResponse.json({ profile: safeProfile, items, metrics: attributionMetrics(items), leadDocumentConnection: leadDrive?.accountEmail ? { connected: true, accountEmail: leadDrive.accountEmail } : { connected: false, accountEmail: null } });
});

export const POST = withApi({}, async (req, { api }) => {
  const body = await req.json().catch(() => null); const parsed = z.discriminatedUnion("action", [profileSchema, leadSchema, campaignNotesSchema, leadSourceSchema, syncLeadSourceSchema, deleteLeadSourceSchema]).safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (parsed.data.action === "profile") {
    const { action: _action, creativeMemory, audienceMemory, ...rest } = parsed.data;
    const data = { ...rest, ...(creativeMemory ? { creativeMemory: creativeMemory as Prisma.InputJsonValue } : {}), ...(audienceMemory ? { audienceMemory: audienceMemory as Prisma.InputJsonValue } : {}) };
    const profile = await prisma.metaClientProfile.upsert({ where: { workspaceId_adAccountId: { workspaceId: api.workspaceId, adAccountId: data.adAccountId } }, create: { workspaceId: api.workspaceId, ...data }, update: data });
    const safeProfile = (({ webhookToken: _secret, ...rest }) => rest)(profile);
    return NextResponse.json({ profile: safeProfile });
  }
  if (parsed.data.action === "campaign_notes") {
    const campaignId = parsed.data.campaignId;
    const existing = await prisma.metaClientProfile.findUnique({ where: { workspaceId_adAccountId: { workspaceId: api.workspaceId, adAccountId: parsed.data.adAccountId } } });
    const commercialStages = existing?.commercialStages && typeof existing.commercialStages === "object" && !Array.isArray(existing.commercialStages)
      ? existing.commercialStages as Record<string, unknown>
      : {};
    const campaignNotes = commercialStages.campaignNotes && typeof commercialStages.campaignNotes === "object" && !Array.isArray(commercialStages.campaignNotes)
      ? commercialStages.campaignNotes as Record<string, unknown>
      : {};
    const resetSources = resetCampaignLeadSources(commercialStages.urlLeadSources, campaignId);
    const nextStages = {
      ...commercialStages,
      ...(resetSources ? { urlLeadSources: resetSources } : {}),
      campaignNotes: {
        ...campaignNotes,
        [parsed.data.campaignId]: {
          campaignName: parsed.data.campaignName,
          qualificationNotes: parsed.data.qualificationNotes,
          updatedAt: new Date().toISOString(),
          updatedBy: api.userId
        }
      }
    } as Prisma.InputJsonValue;
    const profile = await prisma.metaClientProfile.upsert({
      where: { workspaceId_adAccountId: { workspaceId: api.workspaceId, adAccountId: parsed.data.adAccountId } },
      create: { workspaceId: api.workspaceId, adAccountId: parsed.data.adAccountId, displayName: parsed.data.accountName, commercialStages: nextStages },
      update: { commercialStages: nextStages }
    });
    const safeProfile = (({ webhookToken: _secret, ...rest }) => rest)(profile);
    return NextResponse.json({ profile: safeProfile });
  }
  if (parsed.data.action === "lead_source") {
    const source = await saveUrlLeadSource({ workspaceId: api.workspaceId, ...parsed.data });
    return NextResponse.json({ source });
  }
  if (parsed.data.action === "sync_lead_source") {
    return NextResponse.json(await syncUrlLeadSource({ workspaceId: api.workspaceId, adAccountId: parsed.data.adAccountId, sourceId: parsed.data.sourceId, force: true }));
  }
  if (parsed.data.action === "delete_lead_source") {
    await deleteUrlLeadSource(api.workspaceId, parsed.data.adAccountId, parsed.data.sourceId);
    return NextResponse.json({ ok: true });
  }
  const { action: _action, occurredAt, status, metadata, ...data } = parsed.data;
  const leadData = { ...data, ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}) };
  const timestamp = new Date();
  const item = await prisma.metaLeadAttribution.upsert({ where: { workspaceId_adAccountId_externalLeadId: { workspaceId: api.workspaceId, adAccountId: data.adAccountId, externalLeadId: data.externalLeadId } }, create: { workspaceId: api.workspaceId, ...leadData, status, occurredAt: occurredAt ?? timestamp, ...stageDates(status, timestamp) }, update: { ...leadData, status, ...(occurredAt ? { occurredAt } : {}), ...stageDates(status, timestamp) } });
  return NextResponse.json({ item });
});
