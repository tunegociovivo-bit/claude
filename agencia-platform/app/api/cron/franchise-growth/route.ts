import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { buildFranchiseCadence, buildFranchisePilot, scoreFranchiseOpportunity, type FranchiseSignal } from "@/lib/leads/franchise-growth-engine";
import { fetchFranchiseSignals } from "@/lib/leads/franchise-signal-radar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cutoff = Date.now() - 20 * 60 * 60 * 1000;
  const leads = await prisma.lead.findMany({
    where: { rawData: { path: ["source"], equals: "franchises" } },
    orderBy: { updatedAt: "asc" },
    take: 150,
    select: { id: true, name: true, rawData: true }
  });
  const due = leads.filter((lead: any) => lead.rawData?.franchiseAudit?.metrics && (!lead.rawData?.franchiseGrowth?.refreshedAt || new Date(lead.rawData.franchiseGrowth.refreshedAt).getTime() < cutoff)).slice(0, 10);
  const results: Array<{ id: string; brand: string; score?: number; signals?: number; error?: string }> = [];
  for (const lead of due) {
    try {
      const raw: any = lead.rawData ?? {};
      const audit = raw.franchiseAudit;
      const external = await fetchFranchiseSignals(raw.brand ?? lead.name);
      const observed: FranchiseSignal[] = audit.metrics.lowRatingPct >= 15 ? [{ type: "reviews", strength: Math.min(90, 50 + audit.metrics.lowRatingPct), observedAt: new Date().toISOString(), evidence: `${audit.metrics.lowRatingPct}% de la muestra tiene valoración baja` }] : [];
      const signals = [...external, ...observed];
      const opportunity = scoreFranchiseOpportunity({ signals, auditScore: audit.score ?? 0, verifiedDecisionMaker: !!raw.decisionMakerResearch?.selected?.sendAllowed, networkSize: audit.metrics.sampled ?? 0 });
      const growth = {
        ...raw.franchiseGrowth,
        signals,
        opportunity,
        pilot: raw.franchiseGrowth?.pilot ?? buildFranchisePilot({ brand: raw.brand ?? lead.name, sampled: audit.metrics.sampled ?? 0, auditScore: audit.score ?? 0 }),
        cadence: raw.franchiseGrowth?.cadence ?? buildFranchiseCadence(new Date().toISOString()),
        publicAudit: raw.franchiseGrowth?.publicAudit ?? { token: randomBytes(24).toString("base64url"), createdAt: new Date().toISOString(), views: 0 },
        refreshedAt: new Date().toISOString()
      };
      await prisma.lead.update({ where: { id: lead.id }, data: { score: opportunity.score, rawData: { ...raw, franchiseGrowth: growth } } });
      results.push({ id: lead.id, brand: lead.name, score: opportunity.score, signals: signals.length });
    } catch (error: any) {
      results.push({ id: lead.id, brand: lead.name, error: String(error?.message ?? error).slice(0, 250) });
    }
  }
  return NextResponse.json({ ok: true, checked: due.length, results });
}
