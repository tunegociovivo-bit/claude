/**
 * GET /api/v1/leads/[id]/geo-check
 * Comprueba si las coordenadas del lead concuerdan con su provincia. Útil para
 * avisar de que el ranking por cercanía puede estar mal (geo errónea del scrape).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { reverseProvince, provinceMismatch } from "@/lib/leads/geo-check";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const lead = await prisma.lead.findFirst({
    where: { id: (params as any).id, workspaceId: api.workspaceId },
    select: { id: true, province: true, latitude: true, longitude: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");
  if (lead.latitude == null || lead.longitude == null) {
    return NextResponse.json({ ok: true, hasCoords: false, mismatch: false });
  }
  const det = await reverseProvince(lead.latitude, lead.longitude);
  const mismatch = !!det && provinceMismatch(lead.province, det.province);
  return NextResponse.json({
    ok: true,
    hasCoords: true,
    mismatch,
    leadProvince: lead.province ?? null,
    detectedProvince: det?.province ?? null,
    detectedCity: det?.city ?? null
  });
});
