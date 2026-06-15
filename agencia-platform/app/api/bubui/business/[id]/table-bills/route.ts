/**
 * GET /api/bubui/business/[id]/table-bills
 *
 * Cuentas de Mesa Colectiva ya cerradas (con ticket) de este negocio, para que
 * el dueño vea de un vistazo lo que Bubui le ha aportado: importe, % aplicado,
 * lo que pagó la mesa, nº de comensales y fecha.
 *
 * Auth: token del panel (Bearer <businessId>:<secret>).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const sessions = await prisma.bubuiTableSession.findMany({
    where: { businessId: params.id, status: "redeemed", ticketAmount: { not: null } },
    orderBy: { redeemedAt: "desc" },
    take: 100,
    include: { _count: { select: { participants: true } } }
  });

  const items = sessions.map((s) => {
    const ticket = s.ticketAmount ?? 0;
    const pct = s.finalPct ?? 0;
    const saved = Math.round(((ticket * pct) / 100) * 100) / 100;
    return {
      id: s.id,
      tableLabel: s.tableLabel,
      diners: s._count.participants,
      ticket,
      pct,
      saved,
      payNow: Math.round((ticket - saved) * 100) / 100,
      date: s.redeemedAt ?? s.updatedAt
    };
  });

  const totalTicket = Math.round(items.reduce((a, b) => a + b.ticket, 0) * 100) / 100;
  return NextResponse.json({ items, count: items.length, totalTicket });
}
