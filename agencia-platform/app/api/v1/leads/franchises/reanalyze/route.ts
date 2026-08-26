import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { analyzeFranchiseNetwork } from "@/lib/leads/sources/franchises";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().min(1) });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const lead = await prisma.lead.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId, contactStatus: { not: "excluded" } },
    select: { id: true, name: true, province: true, rawData: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Franquicia no encontrada");

  const raw: any = lead.rawData ?? {};
  const result = await analyzeFranchiseNetwork(api.workspaceId, raw.brand ?? lead.name, lead.province ?? undefined);
  const analyzed: any = result?.central?.rawData;
  if (!analyzed?.franchiseAudit) {
    throw new ApiError(422, "network_not_found", "No se han encontrado al menos 3 ubicaciones verificables para generar la auditoría.");
  }
  const now = new Date().toISOString();
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      rawData: {
        ...raw,
        metrics: analyzed.metrics,
        reportText: analyzed.reportText,
        franchiseAudit: analyzed.franchiseAudit,
        franchiseDraft: analyzed.franchiseDraft ?? raw.franchiseDraft,
        franchisePipeline: { ...raw.franchisePipeline, stage: "audited", updatedAt: now }
      }
    }
  });
  return NextResponse.json({ ok: true, audit: analyzed.franchiseAudit, updatedAt: now });
});
