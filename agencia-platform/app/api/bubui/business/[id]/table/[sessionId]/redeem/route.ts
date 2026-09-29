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
import { loadTableState, finalizeMesaBill } from "@/lib/bubui/table";

export const dynamic = "force-dynamic";

const schema = z.object({ ticketAmount: z.number().positive().max(10000) });

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; sessionId: string }> }
) {
  const params = await props.params;
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });

  const loaded = await loadTableState(params.sessionId, parsed.data.ticketAmount);
  if (!loaded || loaded.session.businessId !== params.id) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  try {
    const result = await finalizeMesaBill(params.sessionId, parsed.data.ticketAmount, null);
    if (!result) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
    return NextResponse.json({ ok: true, alreadyRedeemed: result.alreadyDone, appliedPct: result.appliedPct, payNow: result.state.euros?.payNow, savedNow: result.state.euros?.savedNow, nextVisitPct: result.state.pctNextVisit, perk: result.perkEarned });
  } catch { return NextResponse.json({ error: { code: "mesa_not_ready", message: "Mesa cerrada, caducada o con pruebas pendientes de revisar." } }, { status: 409 }); }
}
