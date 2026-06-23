/**
 * POST /api/bubui/business/[id]/table/[sessionId]/cancel
 *
 * Elimina (cancela) una mesa ACTIVA del negocio: la marca como "expired" para
 * que salga de "Mesas activas". Útil cuando una mesa se queda colgada por un
 * error y nunca se llega a verificar/canjear. No toca mesas ya canjeadas.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  // Solo mesas activas (open/verified) de ESTE negocio. Las redeemed no se tocan.
  const result = await prisma.bubuiTableSession.updateMany({
    where: { id: params.sessionId, businessId: params.id, status: { in: ["open", "verified"] } },
    data: { status: "expired" }
  });
  if (result.count === 0) {
    return NextResponse.json({ error: { code: "not_found", message: "Mesa no encontrada o ya cerrada." } }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
