import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { attributionMetrics } from "@/lib/meta/attribution";

export const dynamic = "force-dynamic";
export const GET = withApi({}, async (_req, { api }) => {
  const profiles = await prisma.metaClientProfile.findMany({ where: { workspaceId: api.workspaceId }, orderBy: { displayName: "asc" } });
  const accountIds = profiles.map((item) => item.adAccountId);
  const leads = accountIds.length ? await prisma.metaLeadAttribution.findMany({ where: { workspaceId: api.workspaceId, adAccountId: { in: accountIds } }, select: { adAccountId: true, status: true, revenueCents: true, occurredAt: true } }) : [];
  const today = new Date(); const elapsed = today.getUTCDate(); const days = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const items = profiles.map((profile) => {
    const accountLeads = leads.filter((lead) => lead.adAccountId === profile.adAccountId); const metrics = attributionMetrics(accountLeads);
    const alerts: string[] = [];
    if (!accountLeads.length) alerts.push("Sin leads comerciales registrados");
    if (metrics.total >= 5 && metrics.qualificationRate < 20) alerts.push("Calidad de lead inferior al 20%");
    if (metrics.qualified >= 5 && metrics.won === 0) alerts.push("Leads cualificados sin ventas");
    const expectedBudgetCents = Math.round(profile.monthlyBudgetCents * elapsed / days);
    return { profile, metrics, alerts, pacing: { elapsedDays: elapsed, monthDays: days, expectedBudgetCents, monthlyBudgetCents: profile.monthlyBudgetCents }, health: alerts.length >= 2 ? "risk" : alerts.length === 1 ? "attention" : "healthy" };
  });
  return NextResponse.json({ items, generatedAt: new Date().toISOString() });
});
