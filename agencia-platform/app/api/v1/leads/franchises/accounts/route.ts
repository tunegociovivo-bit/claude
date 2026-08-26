import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { summarizeFranchisePipeline } from "@/lib/leads/franchise-audit";

export const dynamic = "force-dynamic";

const stages = ["discovered", "audited", "draft_ready", "audit_sent", "replied", "meeting", "pilot", "proposal", "won", "lost"] as const;

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const leads = await prisma.lead.findMany({
    where: { workspaceId: api.workspaceId, contactStatus: { not: "excluded" }, rawData: { path: ["source"], equals: "franchises" } },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
    select: { id: true, name: true, email: true, website: true, phone: true, contactStatus: true, rawData: true, updatedAt: true }
  });
  const items = leads.map((lead) => {
    const raw: any = lead.rawData ?? {};
    return {
      id: lead.id,
      brand: raw.brand ?? lead.name,
      email: lead.email,
      website: lead.website,
      phone: lead.phone,
      contactStatus: lead.contactStatus,
      directorName: raw.directorName ?? null,
      directorRole: raw.directorRole ?? null,
      linkedin: raw.linkedin ?? null,
      decisionMakerResearch: raw.decisionMakerResearch ?? null,
      growth: raw.franchiseGrowth ?? null,
      audit: raw.franchiseAudit ?? null,
      draft: raw.franchiseDraft ?? null,
      reportText: raw.reportText ?? null,
      stage: raw.franchisePipeline?.stage ?? (raw.franchiseAudit ? "audited" : "discovered"),
      lastActivityAt: raw.franchisePipeline?.updatedAt ?? lead.updatedAt.toISOString(),
      lastEmailId: raw.franchisePipeline?.lastEmailId ?? null
    };
  });
  return NextResponse.json({ items, summary: summarizeFranchisePipeline(items) });
});

const patchSchema = z.object({ id: z.string().min(1), stage: z.enum(stages), note: z.string().max(1200).optional() });

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const lead = await prisma.lead.findFirst({ where: { id: parsed.data.id, workspaceId: api.workspaceId }, select: { rawData: true } });
  if (!lead) throw new ApiError(404, "not_found", "Cuenta de franquicia no encontrada");
  const raw: any = lead.rawData ?? {};
  const now = new Date().toISOString();
  const history = Array.isArray(raw.franchisePipeline?.history) ? raw.franchisePipeline.history : [];
  const stopCadence = ["replied", "meeting", "pilot", "proposal", "won", "lost"].includes(parsed.data.stage);
  const cadence = stopCadence && Array.isArray(raw.franchiseGrowth?.cadence)
    ? raw.franchiseGrowth.cadence.map((step: any) => step.status === "pending" ? { ...step, status: "stopped", stoppedAt: now, stopReason: parsed.data.stage } : step)
    : raw.franchiseGrowth?.cadence;
  await prisma.lead.update({
    where: { id: parsed.data.id },
    data: { rawData: { ...raw, franchiseGrowth: raw.franchiseGrowth ? { ...raw.franchiseGrowth, cadence } : undefined, franchisePipeline: { ...raw.franchisePipeline, stage: parsed.data.stage, updatedAt: now, history: [...history, { stage: parsed.data.stage, note: parsed.data.note ?? null, at: now }].slice(-100) } } }
  });
  return NextResponse.json({ ok: true, stage: parsed.data.stage, updatedAt: now });
});

const deleteSchema = z.object({ id: z.string().min(1), reason: z.string().max(500).optional() });

export const DELETE = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = deleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const lead = await prisma.lead.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId, rawData: { path: ["source"], equals: "franchises" } },
    select: { id: true, rawData: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Cuenta de franquicia no encontrada");

  const raw: any = lead.rawData ?? {};
  const now = new Date().toISOString();
  const reason = parsed.data.reason?.trim() || "Excluida manualmente desde Franchise Intelligence";
  const history = Array.isArray(raw.franchisePipeline?.history) ? raw.franchisePipeline.history : [];
  const cadence = Array.isArray(raw.franchiseGrowth?.cadence)
    ? raw.franchiseGrowth.cadence.map((step: any) => ["pending", "draft_ready"].includes(step.status)
      ? { ...step, status: "stopped", stoppedAt: now, stopReason: "excluded" }
      : step)
    : raw.franchiseGrowth?.cadence;

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      contactStatus: "excluded",
      rawData: {
        ...raw,
        franchiseExcluded: { at: now, reason },
        franchiseGrowth: raw.franchiseGrowth ? { ...raw.franchiseGrowth, cadence } : undefined,
        franchisePipeline: {
          ...raw.franchisePipeline,
          stage: "excluded",
          updatedAt: now,
          history: [...history, { stage: "excluded", note: reason, at: now }].slice(-100)
        }
      }
    }
  });
  return NextResponse.json({ ok: true, excludedAt: now });
});
