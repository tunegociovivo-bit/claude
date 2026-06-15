/**
 * POST /api/bubui/table/[code]/bill   { customerId, ticketScanId?, ticketAmount? }
 *
 * Cierre de la Mesa Colectiva por el COMENSAL que paga: escanea el ticket (la IA
 * leyó el total) y la app calcula el total con el descuento del grupo aplicado.
 * Marca la mesa como cerrada, crea los cupones de próxima visita y avisa al
 * negocio (queda registrada como "cuenta aportada por Bubui" en su panel).
 * El descuento lo aplica el camarero al ver la pantalla del comensal.
 *
 * Importe de confianza: si se pasa ticketScanId, el total se toma del OCR
 * guardado (BubuiTicketScan), no del cliente.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { finalizeMesaBill } from "@/lib/bubui/table";
import { alertBusiness } from "@/lib/bubui/business-push";

export const dynamic = "force-dynamic";

const schema = z.object({
  customerId: z.string().min(1),
  ticketScanId: z.string().optional(),
  ticketAmount: z.number().positive().max(10000).optional()
});

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const { customerId, ticketScanId } = parsed.data;
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const session = await prisma.bubuiTableSession.findFirst({
    where: { code: params.code.toUpperCase() },
    orderBy: { createdAt: "desc" },
    include: { participants: { where: { customerId }, select: { id: true } } }
  });
  if (!session) return NextResponse.json({ error: { code: "not_found", message: "Mesa no encontrada." } }, { status: 404 });
  if (session.participants.length === 0) {
    return NextResponse.json({ error: { code: "not_joined", message: "Únete a la mesa primero." } }, { status: 409 });
  }

  // Importe de confianza desde el OCR del ticket (si se aportó). Un ticket = una
  // cuenta (no reutilizable).
  let amount = parsed.data.ticketAmount ?? null;
  let ticketScan: { id: string; amount: number | null } | null = null;
  if (ticketScanId) {
    const ts = await prisma.bubuiTicketScan.findUnique({ where: { id: ticketScanId } });
    const fresh = ts && ts.createdAt > new Date(Date.now() - 30 * 60 * 1000);
    const mine = ts && (ts.customerId === customerId || ts.customerId === "anon");
    if (ts && fresh && mine && ts.usedByPurchaseId == null) {
      ticketScan = { id: ts.id, amount: ts.amount };
      if (ts.amount != null) amount = ts.amount;
    }
  }
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: { code: "no_amount", message: "Falta el importe del ticket." } }, { status: 400 });
  }

  const result = await finalizeMesaBill(session.id, amount, customerId);
  if (!result) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  // Marca el ticket como usado (evita reutilizarlo).
  if (ticketScan) {
    await prisma.bubuiTicketScan
      .update({ where: { id: ticketScan.id }, data: { usedByPurchaseId: `mesa:${session.id}`, businessId: session.businessId } })
      .catch(() => {});
  }

  const st = result.state;
  const ticket = st.euros?.ticket ?? amount;
  const payNow = st.euros?.payNow ?? Math.round((amount - (amount * result.appliedPct) / 100) * 100) / 100;
  const savedNow = st.euros?.savedNow ?? Math.round(((amount * result.appliedPct) / 100) * 100) / 100;

  // Aviso al negocio: cuenta cerrada vía Bubui (queda registrada en su panel).
  if (!result.alreadyDone) {
    void alertBusiness(session.businessId, {
      type: "mesa_bill",
      message: `🧾 Mesa Colectiva: cuenta de ${ticket.toFixed(2)}€ con ${result.appliedPct}% (${st.diners} comensales). Pagan ${payNow.toFixed(2)}€.`,
      pushTitle: "🧾 Cuenta Bubui en tu mesa",
      link: "/bubui/negocio"
    });
  }

  return NextResponse.json({
    ok: true,
    alreadyDone: result.alreadyDone,
    appliedPct: result.appliedPct,
    ticket,
    payNow,
    savedNow,
    nextVisitPct: st.pctNextVisit,
    perk: result.perkEarned,
    diners: st.diners
  });
}
