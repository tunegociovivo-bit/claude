/**
 * GET /api/bubui/business/[id]/ranking
 *
 * Posición del negocio en el ranking mensual (clientes distintos este mes),
 * el top 5 y el premio en juego. Lo muestra el panel para picar a competir.
 * Requiere el token del propio negocio.
 */
import { NextResponse } from "next/server";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { getBusinessRanking } from "@/lib/bubui/ranking";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const r = await getBusinessRanking(params.id);
  return NextResponse.json({
    position: r.position,
    total: r.total,
    customers: r.customers,
    top: r.top.map((t) => ({
      position: t.position,
      name: t.name,
      city: t.city,
      logoUrl: t.logoUrl,
      customers: t.customers,
      isMe: t.businessId === params.id
    }))
  });
}
