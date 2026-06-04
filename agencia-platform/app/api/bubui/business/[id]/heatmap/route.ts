/**
 * GET /api/bubui/business/[id]/heatmap
 *
 * Devuelve un mapa de calor 7 días × 24 horas con el nº de compras
 * confirmadas en los últimos 60 días. Útil para detectar horas pico/valle
 * y disparar campañas en las horas vacías.
 *
 * Auth: Bearer del negocio. Gated: plan != "free".
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { isPaidPlan } from "@/lib/bubui/plan";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { plan: true }
  });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (!isPaidPlan(business.plan)) {
    return NextResponse.json({ error: { code: "plan_required", message: "Heatmap disponible con Pro o Premium." } }, { status: 402 });
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 60);

  const purchases = await prisma.bubuiPurchase.findMany({
    where: { businessId: params.id, status: "confirmed", confirmedAt: { gte: since } },
    select: { confirmedAt: true }
  });

  // Matriz 7×24 (filas: dow 0=Dom; columnas: hora 0..23 hora local Madrid).
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let total = 0;
  let max = 0;
  // Hora Madrid: TZ +1 en invierno, +2 en verano. Para simplicidad usamos
  // Intl con zona Europe/Madrid sin librerías externas.
  const fmt = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    weekday: "short",
    hour12: false
  });
  // Mapa abreviatura → índice (dom=0, lun=1, ... sáb=6)
  const dowMap: Record<string, number> = { dom: 0, lun: 1, mar: 2, mié: 3, jue: 4, vie: 5, sáb: 6 };
  for (const p of purchases) {
    if (!p.confirmedAt) continue;
    const parts = fmt.formatToParts(p.confirmedAt);
    const wk = (parts.find((x) => x.type === "weekday")?.value ?? "").toLowerCase().replace(".", "");
    const hh = Number(parts.find((x) => x.type === "hour")?.value ?? -1);
    const d = dowMap[wk];
    if (d == null || !Number.isFinite(hh) || hh < 0 || hh > 23) continue;
    grid[d][hh]++;
    total++;
    if (grid[d][hh] > max) max = grid[d][hh];
  }

  return NextResponse.json({
    grid,
    total,
    max,
    sinceDays: 60
  });
}
