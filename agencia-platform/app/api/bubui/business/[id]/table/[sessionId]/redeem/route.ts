/**
 * POST /api/bubui/business/[id]/table/[sessionId]/redeem   { ticketAmount }
 *
 * El dueño verifica la mesa (es real) y la canjea: aplica el descuento de ESTA
 * visita sobre el importe del ticket y, si hay bonus diferido, crea a cada
 * comensal un cupón de PRÓXIMA visita (BubuiOffer) con la caducidad configurada
 * — el motor de recurrencia. Idempotente: una sesión solo se canjea una vez.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { loadTableState } from "@/lib/bubui/table";

export const dynamic = "force-dynamic";

const schema = z.object({ ticketAmount: z.number().positive().max(10000) });

export async function POST(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });

  const loaded = await loadTableState(params.sessionId, parsed.data.ticketAmount);
  if (!loaded || loaded.session.businessId !== params.id) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  const { session, state } = loaded;
  if (session.status === "redeemed") {
    return NextResponse.json({ ok: true, alreadyRedeemed: true, appliedPct: session.finalPct ?? 0 });
  }

  const appliedPct = state.pctNow; // descuento de esta visita
  const nextVisitPct = state.pctNextVisit; // cupón próxima visita
  const days = session.business.mesaNextVisitDays ?? 15;
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  // Cupón de próxima visita para cada comensal (recurrencia).
  let coupons = 0;
  if (nextVisitPct > 0) {
    const parts = await prisma.bubuiTableParticipant.findMany({ where: { sessionId: session.id }, select: { customerId: true } });
    for (const p of parts) {
      await prisma.bubuiOffer
        .upsert({
          where: { customerId_businessId_triggerBusinessId: { customerId: p.customerId, businessId: params.id, triggerBusinessId: `mesa:${session.id}` } },
          create: {
            customerId: p.customerId,
            businessId: params.id,
            triggerBusinessId: `mesa:${session.id}`,
            discountPct: nextVisitPct,
            source: "mesa",
            active: true,
            expiresAt
          },
          update: { discountPct: nextVisitPct, expiresAt, active: true }
        })
        .then(() => { coupons++; })
        .catch(() => {});
    }
  }

  await prisma.bubuiTableSession.update({
    where: { id: session.id },
    data: { status: "redeemed", finalPct: appliedPct, verifiedAt: new Date(), redeemedAt: new Date() }
  });

  return NextResponse.json({
    ok: true,
    appliedPct,
    payNow: state.euros?.payNow ?? null,
    savedNow: state.euros?.savedNow ?? null,
    nextVisitPct,
    couponsCreated: coupons,
    nextVisitExpiresAt: nextVisitPct > 0 ? expiresAt.toISOString() : null
  });
}
