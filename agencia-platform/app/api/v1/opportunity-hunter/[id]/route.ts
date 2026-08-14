import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { convertSignalToLead, startOpportunityResearch } from "@/lib/opportunity-hunter/service";

const schema = z.object({ action: z.enum(["review", "qualify", "dismiss", "convert", "research"]) });
export const PATCH = withApi({ scope: "*" }, async (req, { api, params }) => {
  const db = prisma as any;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (parsed.data.action === "convert") {
    const out = await convertSignalToLead(db, api.workspaceId, params.id);
    if (!out) throw new ApiError(404, "not_found", "Oportunidad no encontrada");
    return NextResponse.json({ ok: true, ...out });
  }
  if (parsed.data.action === "research") {
    const out = await startOpportunityResearch(db, api.workspaceId, params.id);
    if (!out) throw new ApiError(404, "not_found", "Convierte primero la oportunidad en lead");
    return NextResponse.json({ ok: true, ...out });
  }
  const status = parsed.data.action === "review" ? "reviewing" : parsed.data.action === "qualify" ? "qualified" : "dismissed";
  const changed = await db.opportunitySignal.updateMany({ where: { id: params.id, workspaceId: api.workspaceId }, data: { status } });
  if (!changed.count) throw new ApiError(404, "not_found", "Oportunidad no encontrada");
  return NextResponse.json({ ok: true, status });
});
