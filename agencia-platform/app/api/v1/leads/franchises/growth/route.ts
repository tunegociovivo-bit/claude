import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { buildFranchiseCadence, buildFranchisePilot, checkFranchiseExclusivity, scoreFranchiseOpportunity, summarizeFranchiseLearning, type FranchiseSignal } from "@/lib/leads/franchise-growth-engine";
import { fetchFranchiseSignals } from "@/lib/leads/franchise-signal-radar";
import { analyzeFranchiseNetwork } from "@/lib/leads/sources/franchises";

export const dynamic = "force-dynamic";
const schema = z.object({ id: z.string().min(1), category: z.string().max(120).optional(), refreshAudit: z.boolean().optional() });

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const lead = await prisma.lead.findFirst({ where: { id: parsed.data.id, workspaceId: api.workspaceId }, select: { id: true, name: true, province: true, rawData: true } });
  if (!lead) throw new ApiError(404, "not_found", "Franquicia no encontrada");
  let raw: any = lead.rawData ?? {};
  let audit = raw.franchiseAudit;
  if (!audit?.metrics) throw new ApiError(400, "missing_audit", "Genera primero la auditoría de la red");
  if (parsed.data.refreshAudit) {
    const refreshed = await analyzeFranchiseNetwork(api.workspaceId, raw.brand ?? lead.name, lead.province ?? undefined).catch(() => null);
    const refreshedRaw: any = refreshed?.central?.rawData ?? null;
    if (refreshedRaw?.franchiseAudit) {
      audit = refreshedRaw.franchiseAudit;
      raw = { ...raw, franchiseAudit: audit, metrics: refreshedRaw.metrics, reportText: refreshedRaw.reportText };
    }
  }

  const externalSignals = await fetchFranchiseSignals(raw.brand ?? lead.name);
  const observedSignals: FranchiseSignal[] = [
    ...(audit.metrics.lowRatingPct >= 15 ? [{ type: "reviews" as const, strength: Math.min(90, 50 + audit.metrics.lowRatingPct), observedAt: new Date().toISOString(), evidence: `${audit.metrics.lowRatingPct}% de la muestra tiene valoración baja` }] : []),
    ...((audit.metrics.noWebsitePct >= 10 || audit.metrics.noPhonePct >= 10) ? [{ type: "listing_errors" as const, strength: 65, observedAt: new Date().toISOString(), evidence: `${audit.metrics.noWebsitePct}% sin web y ${audit.metrics.noPhonePct}% sin teléfono` }] : [])
  ];
  const signals = [...externalSignals, ...observedSignals];
  const opportunity = scoreFranchiseOpportunity({ signals, auditScore: audit.score ?? 0, verifiedDecisionMaker: !!raw.decisionMakerResearch?.selected?.sendAllowed, networkSize: audit.metrics.sampled ?? 0 });
  const pilot = buildFranchisePilot({ brand: raw.brand ?? lead.name, sampled: audit.metrics.sampled ?? 0, auditScore: audit.score ?? 0 });
  const token = raw.franchiseGrowth?.publicAudit?.token ?? randomBytes(24).toString("base64url");
  const category = parsed.data.category?.trim() || raw.franchiseGrowth?.category || null;
  const wonLeads = category ? await prisma.lead.findMany({ where: { workspaceId: api.workspaceId, id: { not: lead.id }, rawData: { path: ["franchisePipeline", "stage"], equals: "won" } }, select: { name: true, province: true, rawData: true } }) : [];
  const exclusivity = category ? checkFranchiseExclusivity(
    { category, provinces: [lead.province ?? raw.location ?? "España"] },
    wonLeads.map((item: any) => ({ client: item.name, category: item.rawData?.franchiseGrowth?.category ?? "", provinces: [item.province ?? item.rawData?.location ?? "España"] }))
  ) : { allowed: true, conflicts: [], note: "Define una categoría para comprobar exclusividad real." };
  const previousSnapshot = raw.franchiseGrowth?.liveAudit?.current ?? null;
  const currentSnapshot = { capturedAt: new Date().toISOString(), score: audit.score, metrics: audit.metrics };
  const liveAudit = { previous: previousSnapshot, current: currentSnapshot, changed: previousSnapshot ? previousSnapshot.score !== currentSnapshot.score || JSON.stringify(previousSnapshot.metrics) !== JSON.stringify(currentSnapshot.metrics) : false };
  const growth = {
    ...raw.franchiseGrowth,
    category,
    signals,
    opportunity,
    pilot,
    exclusivity,
    cadence: raw.franchiseGrowth?.cadence ?? buildFranchiseCadence(new Date().toISOString()),
    publicAudit: { ...(raw.franchiseGrowth?.publicAudit ?? {}), token, createdAt: raw.franchiseGrowth?.publicAudit?.createdAt ?? new Date().toISOString(), views: raw.franchiseGrowth?.publicAudit?.views ?? 0 },
    liveAudit,
    refreshedAt: new Date().toISOString()
  };
  await prisma.lead.update({ where: { id: lead.id }, data: { score: opportunity.score, rawData: { ...raw, franchiseGrowth: growth } } });
  return NextResponse.json({ ok: true, growth, publicUrl: `/auditoria/franquicia/${token}` });
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const leads = await prisma.lead.findMany({ where: { workspaceId: api.workspaceId, rawData: { path: ["source"], equals: "franchises" } }, select: { rawData: true } });
  const records = leads.map((lead: any) => ({ outcome: lead.rawData?.franchisePipeline?.stage ?? "discovered", role: lead.rawData?.directorRole ?? null, signalTypes: (lead.rawData?.franchiseGrowth?.signals ?? []).map((signal: any) => signal.type) }));
  return NextResponse.json({ learning: summarizeFranchiseLearning(records) });
});
