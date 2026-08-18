/**
 * GET /api/v1/gmb/google/locations?accountId=XXX — ubicaciones REALES de una cuenta GBP
 * (nombre, dirección, teléfono, web, categoría, placeId). Marca cuáles ya están vinculadas
 * como ficha en este workspace (para el selector). Nada inventado. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { gmbListLocations } from "@/lib/integrations/gmb";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const accountId = new URL(req.url).searchParams.get("accountId")?.trim();
  if (!accountId) throw new ApiError(400, "bad_request", "Falta accountId");
  try {
    const locations = await gmbListLocations({ workspaceId: api.workspaceId, accountId });
    const linked = new Set(
      (await prisma.gmbClient.findMany({ where: { workspaceId: api.workspaceId, locationId: { not: "" } }, select: { locationId: true } })).map((c) => c.locationId)
    );
    return NextResponse.json({ ok: true, locations: locations.map((l: any) => ({ ...l, linked: linked.has(l.locationId) })) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "gmb_unavailable", message: String(e?.message ?? "error").slice(0, 240) }, { status: 200 });
  }
});
