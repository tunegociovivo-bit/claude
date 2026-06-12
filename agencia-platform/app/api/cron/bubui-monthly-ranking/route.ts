/**
 * Cron mensual — premio del ranking de negocios.
 *
 * El día 1 de cada mes calcula el ranking del MES ANTERIOR (clientes distintos
 * con compra confirmada) y premia al ganador con "destacado" en Descubre
 * durante el mes nuevo (featuredUntil = fin de mes). Avisa al ganador (panel +
 * email). Idempotente: si el ganador ya tiene el destacado de este mes, no
 * repite.
 *
 * Pensado para correr 1x/día; solo actúa el día 1 (o si nadie tiene aún el
 * premio del mes en curso, como red de seguridad).
 *
 * Auth: Bearer INTERNAL_CRON_TOKEN / CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { getMonthlyRanking, startOfMonth, endOfMonth } from "@/lib/bubui/ranking";
import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const thisMonthEnd = endOfMonth(now);

  // ¿Ya hay un ganador con el destacado de ESTE mes? (idempotencia)
  const alreadyAwarded = await prisma.bubuiBusiness.findFirst({
    where: { featuredUntil: { gte: thisMonthEnd } },
    select: { id: true }
  });
  if (alreadyAwarded) {
    return NextResponse.json({ ok: true, skipped: "already_awarded" });
  }

  // Ranking del MES ANTERIOR.
  const prevStart = new Date(Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 1, 1));
  const ranking = await getMonthlyRanking(prevStart, thisMonthStart);
  const winner = ranking.find((r) => r.customers > 0);
  if (!winner) {
    return NextResponse.json({ ok: true, skipped: "no_activity" });
  }

  // Premio: destacado hasta fin del mes en curso.
  await prisma.bubuiBusiness.update({
    where: { id: winner.businessId },
    data: { featuredUntil: thisMonthEnd }
  });

  const monthName = prevStart.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  const msg = `🏆 ¡Fuiste el negocio que más clientes trajo en ${monthName} (${winner.customers})! Premio: apareces DESTACADO en Descubre todo este mes.`;
  await prisma.bubuiBusinessNotification
    .create({ data: { businessId: winner.businessId, type: "ranking_winner", message: msg } })
    .catch(() => {});

  const biz = await prisma.bubuiBusiness.findUnique({
    where: { id: winner.businessId },
    select: { ownerEmail: true, name: true }
  });
  if (biz?.ownerEmail && isEmailEnabled()) {
    sendEmail({
      to: biz.ownerEmail,
      subject: `🏆 ${biz.name} ganó el ranking Bubui de ${monthName}`,
      html: `<p>${msg}</p><p>Sigue así: el ranking se reinicia cada mes.</p>`,
      text: msg
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, winner: { businessId: winner.businessId, customers: winner.customers } });
}
