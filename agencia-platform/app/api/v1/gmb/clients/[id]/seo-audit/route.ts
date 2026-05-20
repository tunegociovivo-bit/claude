/** GET /api/v1/gmb/clients/[id]/seo-audit → auditoría SEO local de la ficha */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { computeSeoAudit } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const c = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const audit = computeSeoAudit(c);
  return NextResponse.json({ audit });
});
