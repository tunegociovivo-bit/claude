import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { buildFranchiseAuditSvg, type FranchiseAudit } from "@/lib/leads/franchise-audit";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().min(1) });

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse({ id: new URL(req.url).searchParams.get("id") });
  if (!parsed.success) throw new ApiError(400, "validation_error", "Falta la franquicia que quieres previsualizar");
  const lead = await prisma.lead.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId, contactStatus: { not: "excluded" } },
    select: { name: true, rawData: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Franquicia no encontrada");
  const audit = (lead.rawData as any)?.franchiseAudit as FranchiseAudit | undefined;
  if (!audit?.metrics) throw new ApiError(404, "missing_audit", "Esta franquicia todavía no tiene una auditoría ampliada");

  return new NextResponse(buildFranchiseAuditSvg(audit), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `inline; filename="auditoria-${lead.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.svg"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
});
