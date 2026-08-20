import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { completeJson } from "@/lib/ai/anthropic";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
const account = z.string().regex(/^act_\d+$/);
const generateSchema = z.object({ adAccountId: account, monitoring: z.object({ activeCampaigns: z.number(), leads: z.number(), spend: z.number(), cpl: z.number().nullable(), leadChangePct: z.number().nullable() }), commercial: z.object({ total: z.number(), qualified: z.number(), won: z.number(), revenue: z.number(), qualificationRate: z.number(), closeRate: z.number() }), campaigns: z.array(z.object({ id: z.string(), name: z.string(), leads: z.number(), spend: z.number(), cpl: z.number().nullable(), ctr: z.number() })).max(30), profile: z.record(z.string(), z.unknown()).nullable().optional() });

export const GET = withApi({}, async (req, { api }) => {
  const adAccountId = new URL(req.url).searchParams.get("accountId"); if (!adAccountId || !account.safeParse(adAccountId).success) throw new ApiError(400, "invalid_account", "Cuenta no válida");
  const items = await prisma.metaOptimizationProposal.findMany({ where: { workspaceId: api.workspaceId, adAccountId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100 });
  return NextResponse.json({ items });
});

export const POST = withApi({ rate: "ai" }, async (req, { api }) => {
  const parsed = generateSchema.safeParse(await req.json().catch(() => null)); if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const input = parsed.data;
  const result = await completeJson<{ proposals: Array<{ campaignId?: string; kind: string; priority: string; title: string; rationale: string; action: string; expectedImpact: string; confidence: number }> }>({
    workspaceId: api.workspaceId,
    feature: "meta_director",
    system: "Eres el Director de Performance de una agencia. Prioriza ventas, leads cualificados y rentabilidad sobre el CPL bruto. No inventes causas. Si faltan datos comerciales, recomienda mejorar medición antes de escalar. Toda acción es una propuesta para aprobación humana: nunca afirmes que ya se ejecutó. Devuelve entre 1 y 6 propuestas concretas.",
    user: JSON.stringify(input),
    schema: { type: "object", properties: { proposals: { type: "array", maxItems: 6, items: { type: "object", properties: { campaignId: { type: "string" }, kind: { type: "string", enum: ["tracking", "budget", "creative", "audience", "funnel", "experiment"] }, priority: { type: "string", enum: ["high", "medium", "low"] }, title: { type: "string" }, rationale: { type: "string" }, action: { type: "string" }, expectedImpact: { type: "string" }, confidence: { type: "number" } }, required: ["kind", "priority", "title", "rationale", "action", "expectedImpact", "confidence"], additionalProperties: false } } }, required: ["proposals"], additionalProperties: false },
    maxTokens: 1800
  });
  await prisma.metaOptimizationProposal.updateMany({ where: { workspaceId: api.workspaceId, adAccountId: input.adAccountId, status: "pending" }, data: { status: "expired" } });
  const created = await prisma.$transaction(result.proposals.map((proposal) => prisma.metaOptimizationProposal.create({ data: { workspaceId: api.workspaceId, adAccountId: input.adAccountId, campaignId: proposal.campaignId || null, kind: proposal.kind, priority: proposal.priority, title: proposal.title.slice(0, 300), rationale: proposal.rationale, proposedAction: { description: proposal.action } as Prisma.InputJsonValue, expectedImpact: { description: proposal.expectedImpact } as Prisma.InputJsonValue, evidence: { monitoring: input.monitoring, commercial: input.commercial } as Prisma.InputJsonValue, confidence: Math.max(0, Math.min(1, proposal.confidence > 1 ? proposal.confidence / 100 : proposal.confidence)) } })));
  return NextResponse.json({ items: created });
});
