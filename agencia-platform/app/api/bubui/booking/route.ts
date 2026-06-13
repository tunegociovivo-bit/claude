/**
 * POST /api/bubui/booking   { businessId, serviceId?, customerName, customerPhone, startsAt, notes? }
 *
 * Un cliente pide cita en un comercio del nicho "servicios". Queda "pending"
 * hasta que el comercio la confirma desde su panel. No requiere cuenta (basta
 * nombre + teléfono), aunque si hay sesión se vincula el customerId.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  serviceId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  customerName: z.string().min(2).max(80),
  customerPhone: z.string().min(6).max(20),
  startsAt: z.string().datetime(),
  notes: z.string().max(500).optional().nullable()
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const d = parsed.data;

  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: d.businessId },
    select: { id: true, bookingEnabled: true, active: true }
  });
  if (!business || !business.active) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (!business.bookingEnabled) return NextResponse.json({ error: { code: "booking_off", message: "Este negocio no acepta citas online." } }, { status: 409 });

  const when = new Date(d.startsAt);
  if (when.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: { code: "past", message: "La fecha ya ha pasado." } }, { status: 400 });
  }
  // Si serviceId llega, validar que es de este negocio.
  if (d.serviceId) {
    const svc = await prisma.bubuiService.findFirst({ where: { id: d.serviceId, businessId: d.businessId }, select: { id: true } });
    if (!svc) return NextResponse.json({ error: { code: "bad_service" } }, { status: 400 });
  }

  const booking = await prisma.bubuiBooking.create({
    data: {
      businessId: d.businessId,
      serviceId: d.serviceId ?? null,
      customerId: d.customerId ?? null,
      customerName: d.customerName.trim(),
      customerPhone: d.customerPhone.trim(),
      startsAt: when,
      notes: d.notes?.trim() || null,
      status: "pending"
    }
  });

  // Avisa al comercio (notificación interna del panel).
  await prisma.bubuiBusinessNotification
    .create({ data: { businessId: d.businessId, type: "booking", message: `📅 Nueva solicitud de cita de ${booking.customerName} para el ${when.toLocaleString("es-ES")}` } })
    .catch(() => {});

  return NextResponse.json({ ok: true, bookingId: booking.id }, { status: 201 });
}
