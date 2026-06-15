/**
 * POST /api/bubui/table   { businessId, customerId, tableLabel?, ticketAmount? }
 *
 * El anfitrión crea una Mesa Colectiva tras escanear el QR del local. Devuelve
 * el `code` que su app convierte en QR de mesa para que se unan los demás.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { genTableCode } from "@/lib/bubui/table-deal";
import { isNewCustomer, loadTableState } from "@/lib/bubui/table";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  customerId: z.string().min(1),
  tableLabel: z.string().max(20).optional(),
  ticketAmount: z.number().positive().max(10000).optional()
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const d = parsed.data;
  if (!(await customerAuthOk(req, d.customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const [business, customer] = await Promise.all([
    prisma.bubuiBusiness.findUnique({ where: { id: d.businessId } }),
    prisma.bubuiCustomer.findUnique({ where: { id: d.customerId } })
  ]);
  if (!business || !customer) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (!business.mesaEnabled) return NextResponse.json({ error: { code: "mesa_off", message: "Este negocio no tiene Mesa Colectiva activa." } }, { status: 409 });

  // Código único entre sesiones abiertas (reintenta si choca).
  let code = genTableCode();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.bubuiTableSession.findFirst({ where: { code, status: "open" }, select: { id: true } });
    if (!clash) break;
    code = genTableCode();
  }

  const expiresAt = new Date(Date.now() + (business.mesaJoinWindowMin ?? 60) * 60_000);
  const session = await prisma.bubuiTableSession.create({
    data: {
      businessId: business.id,
      code,
      tableLabel: d.tableLabel ?? null,
      captainId: customer.id,
      status: "open",
      basePct: business.mesaBasePct ?? 5,
      shareBonusPct: business.mesaShareBonusPct ?? 5,
      reviewBonusPct: business.mesaReviewBonusPct ?? 3,
      maxPct: business.mesaMaxPct ?? 20,
      minDiners: business.mesaMinDiners ?? 4,
      shareFriends: business.mesaVeteranShareFriends ?? 1,
      expiresAt,
      participants: {
        create: { customerId: customer.id, isNewUser: isNewCustomer(customer) }
      }
    }
  });

  const loaded = await loadTableState(session.id, d.ticketAmount);
  return NextResponse.json({
    ok: true,
    code,
    sessionId: session.id,
    expiresAt: expiresAt.toISOString(),
    state: loaded?.state ?? null
  });
}
