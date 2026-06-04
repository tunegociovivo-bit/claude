/**
 * GET /api/bubui/business/[id]/cohorts
 *
 * Análisis de cohortes y retención del negocio. Para cada mes de los
 * últimos 6 meses, agrupa los clientes cuya PRIMERA compra confirmada en
 * el negocio fue en ese mes (= "cohorte M"), y para cada mes posterior
 * mide cuántos volvieron a confirmar una compra (= retención).
 *
 * Auth: Bearer token del negocio. Gated: plan != "free".
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { isPaidPlan } from "@/lib/bubui/plan";

export const dynamic = "force-dynamic";

const MONTHS_BACK = 6;

function ymKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthAdd(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return ymKey(d);
}

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
    return NextResponse.json({ error: { code: "plan_required", message: "Cohortes disponibles con Pro o Premium." } }, { status: 402 });
  }

  // Trae compras confirmadas del último (MONTHS_BACK + 1) meses para cubrir
  // la cohorte más antigua y todos sus seguimientos posteriores.
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - MONTHS_BACK);
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const purchases = await prisma.bubuiPurchase.findMany({
    where: { businessId: params.id, status: "confirmed", scannedAt: { gte: since } },
    select: { customerId: true, scannedAt: true },
    orderBy: { scannedAt: "asc" }
  });

  // Para cada cliente: el ym de su PRIMERA compra (en la ventana) y luego
  // todos los meses en los que también ha vuelto.
  const firstByCustomer = new Map<string, string>();
  const monthsByCustomer = new Map<string, Set<string>>();
  for (const p of purchases) {
    const ym = ymKey(p.scannedAt);
    if (!firstByCustomer.has(p.customerId)) firstByCustomer.set(p.customerId, ym);
    if (!monthsByCustomer.has(p.customerId)) monthsByCustomer.set(p.customerId, new Set());
    monthsByCustomer.get(p.customerId)!.add(ym);
  }

  // Lista de meses cohort (los últimos MONTHS_BACK + 1 incluyendo el actual).
  const cohortMonths: string[] = [];
  for (let i = MONTHS_BACK; i >= 0; i--) {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - i);
    d.setUTCDate(1);
    cohortMonths.push(ymKey(d));
  }

  // Construye matriz cohorte → mes-relativo (m0, m1, m2, ...).
  const cohorts = cohortMonths.map((cohort) => {
    const customers = Array.from(firstByCustomer.entries())
      .filter(([, ym]) => ym === cohort)
      .map(([id]) => id);
    const size = customers.length;
    const buckets: Array<{ month: string; offset: number; returned: number; pct: number }> = [];
    const monthsAhead = MONTHS_BACK - cohortMonths.indexOf(cohort);
    for (let offset = 0; offset <= monthsAhead; offset++) {
      const target = monthAdd(cohort, offset);
      const returned = customers.reduce(
        (acc, cid) => acc + (monthsByCustomer.get(cid)?.has(target) ? 1 : 0),
        0
      );
      buckets.push({
        month: target,
        offset,
        returned,
        pct: size > 0 ? Math.round((returned / size) * 1000) / 10 : 0
      });
    }
    return { cohort, size, buckets };
  });

  return NextResponse.json({ cohorts });
}
