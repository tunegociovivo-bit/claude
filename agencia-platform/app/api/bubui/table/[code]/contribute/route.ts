/**
 * POST /api/bubui/table/[code]/contribute   { customerId, type }
 *
 * El comensal registra su aporte: type = share | review | photo | follow.
 * Marca al participante como "ha aportado" (desbloquea su parte del descuento).
 * Para "share" cuenta amigos verificados vía el sistema de referidos; para el
 * resto es intención confirmada (igual que el flujo de reseña de Google).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { allowedContributions, loadTableState } from "@/lib/bubui/table";
import { createMesaShareChallenge } from "@/lib/bubui/share-offer";

export const dynamic = "force-dynamic";

const schema = z.object({
  customerId: z.string().min(1),
  type: z.enum(["share", "review", "photo", "follow"]),
  ticketAmount: z.number().positive().max(10000).optional()
});

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const { customerId, type, ticketAmount } = parsed.data;
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const session = await prisma.bubuiTableSession.findFirst({
    where: { code: params.code.toUpperCase(), status: "open" },
    include: { business: true, participants: { where: { customerId } } }
  });
  if (!session) return NextResponse.json({ error: { code: "not_found", message: "Mesa no encontrada o cerrada." } }, { status: 404 });
  const me = session.participants[0];
  if (!me) return NextResponse.json({ error: { code: "not_joined", message: "Únete a la mesa primero." } }, { status: 409 });
  if (!allowedContributions(session.business).includes(type)) {
    return NextResponse.json({ error: { code: "action_off", message: "Ese aporte no está permitido en este negocio." } }, { status: 409 });
  }

  const data: any = { contributed: true, contributionType: type };
  if (type === "share") data.sharedDone = true;
  if (type === "review") data.reviewDone = true;
  // Marca el momento del PRIMER aporte (para el push diferido de la otra acción).
  if (!me.contributedAt) data.contributedAt = new Date();
  await prisma.bubuiTableParticipant.update({ where: { id: me.id }, data });

  // Reto de compartir de la mesa: además del % de grupo inmediato, el bonus
  // "+% si tus amigos se instalan" cuelga del motor de oferta-reto.
  if (type === "share") {
    await createMesaShareChallenge({
      customerId,
      sessionId: session.id,
      business: { id: session.business.id, mesaShareBonusPct: session.business.mesaShareBonusPct ?? 0 },
      friends: session.shareFriends
    }).catch(() => {});
  }

  const loaded = await loadTableState(session.id, ticketAmount);
  return NextResponse.json({ ok: true, state: loaded?.state ?? null });
}
