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
import { alertBusiness } from "@/lib/bubui/business-push";

import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { createHash } from "crypto";

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
  if (d.customerId && !(await customerAuthOk(req, d.customerId))) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!rateLimit("bubui-booking:" + d.customerPhone.replace(/\D/g, ""), 5).ok) return NextResponse.json({ error: { code: "rate_limit" } }, { status: 429 });

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

  const bookingKey = createHash("sha256").update(JSON.stringify([d.businessId, d.serviceId ?? null, d.customerId ?? null, d.customerPhone.replace(/\D/g, ""), when.toISOString()])).digest("hex");
  const booking = await prisma.bubuiBooking.upsert({
    where: { id: "booking_" + bookingKey }, update: {},
    create: {
      id: "booking_" + bookingKey,
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

  // Avisa al comercio (panel + push si lo activó en su dispositivo).
  let notificationPending = false;
  try { await alertBusiness(d.businessId, {
    type: "booking",
    message: `📅 Nueva solicitud de cita de ${booking.customerName} para el ${when.toLocaleString("es-ES")}`,
    pushTitle: "📅 Nueva cita",
    link: "/bubui/negocio"
  }); } catch { notificationPending = true; console.error("[bubui booking] notification pending", booking.id); }

  return NextResponse.json({ ok: true, bookingId: booking.id, status: booking.status, notificationPending }, { status: 201 });
}
