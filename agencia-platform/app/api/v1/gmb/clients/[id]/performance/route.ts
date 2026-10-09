/**
 * GET /api/v1/gmb/clients/[id]/performance?days=30&fresh=1 — «Rendimiento» de la ficha en Google:
 * visualizaciones, búsquedas e interacciones, con comparación frente al periodo anterior.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { fetchPerformance } from "@/lib/gmb/performance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: (params as any).id, workspaceId: api.workspaceId } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? 30) || 30;
  try {
    const data = await fetchPerformance(api.workspaceId, client, { days, fresh: url.searchParams.get("fresh") === "1" });
    return NextResponse.json({ ok: true, name: client.name, ...data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: String(e?.message ?? e).slice(0, 400) });
  }
});
