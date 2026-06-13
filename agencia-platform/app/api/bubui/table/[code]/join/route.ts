/**
 * POST /api/bubui/table/[code]/join   { customerId, ticketAmount? }
 *
 * Un comensal se une a la mesa escaneando el QR de mesa del anfitrión.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { isNewCustomer, loadTableState, veteranShareFor } from "@/lib/bubui/table";

export const dynamic = "force-dynamic";

const schema = z.object({ customerId: z.string().min(1), ticketAmount: z.number().positive().max(10000).optional() });

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const { customerId, ticketAmount } = parsed.data;
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const session = await prisma.bubuiTableSession.findFirst({
    where: { code: params.code.toUpperCase(), status: "open" },
    include: { participants: true, business: true }
  });
  if (!session) return NextResponse.json({ error: { code: "not_found", message: "Mesa no encontrada o cerrada." } }, { status: 404 });
  if (session.expiresAt < new Date()) return NextResponse.json({ error: { code: "expired", message: "La ventana para unirse ha terminado." } }, { status: 409 });

  // Ya unido → idempotente.
  if (!session.participants.some((p) => p.customerId === customerId)) {
    const customer = await prisma.bubuiCustomer.findUnique({ where: { id: customerId } });
    if (!customer) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
    await prisma.bubuiTableParticipant.create({
      data: { sessionId: session.id, customerId, isNewUser: isNewCustomer(customer) }
    });
    // Auto-ajuste: recalcula el umbral de amigos del veterano según cuántos
    // veteranos hay ya en la mesa (zona saturada → más exigencia).
    const all = [...session.participants.map((p) => p.isNewUser), isNewCustomer(customer)];
    const veteranRatio = all.filter((n) => !n).length / all.length;
    const newShare = veteranShareFor(session.business, veteranRatio);
    if (newShare !== session.shareFriends) {
      await prisma.bubuiTableSession.update({ where: { id: session.id }, data: { shareFriends: newShare } });
    }
  }

  const loaded = await loadTableState(session.id, ticketAmount);
  return NextResponse.json({ ok: true, sessionId: session.id, state: loaded?.state ?? null });
}
