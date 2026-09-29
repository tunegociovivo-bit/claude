import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk, customerIdFromAuth } from "@/lib/bubui/customer-auth";

const schema = z.object({ offerId: z.string().min(1), channel: z.enum(["qr", "whatsapp"]) });

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (customerIdFromAuth(req) !== params.id || !(await customerAuthOk(req, params.id))) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: "Contacto inválido" } }, { status: 400 });
  const customer = await prisma.bubuiCustomer.findUnique({ where: { id: params.id }, select: { name: true, phone: true, phoneVerified: true } });
  if (!customer?.phone || !customer.phoneVerified) return NextResponse.json({ error: { code: "validation", message: "Verifica tu teléfono antes de aceptar el reto" } }, { status: 400 });
  // The app sends the friend's welcome coupon, not the inviter's challenge.
  const welcome = await prisma.bubuiOffer.findFirst({
    where: { id: parsed.data.offerId, customerId: params.id, source: "referral_welcome", active: true, redeemed: false, expiresAt: { gt: new Date() } },
    select: { triggerBusinessId: true, businessId: true }
  });
  const offerId = welcome?.triggerBusinessId?.startsWith("ref:welcome:") ? welcome.triggerBusinessId.slice("ref:welcome:".length) : null;
  // Generic referral coupons have no challenge participant to advance.
  if (welcome?.triggerBusinessId === "ref:welcome") return NextResponse.json({ ok: true, contact: { name: customer.name, phone: customer.phone } });
  if (!welcome || !offerId) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const where = { friendCustomerId: params.id, offerId, businessId: welcome.businessId };
  const participant = await prisma.bubuiChallengeParticipant.findFirst({ where });
  if (!participant || ["declined", "lost", "confirmed"].includes(participant.status)) return NextResponse.json({ error: { code: "conflict", message: "Este reto ya no está pendiente" } }, { status: 409 });
  await prisma.bubuiChallengeParticipant.updateMany({
    where: { ...where, contactedAt: null },
    data: { contactedAt: new Date(), contactChannel: parsed.data.channel }
  });
  return NextResponse.json({ ok: true, contact: { name: customer.name, phone: customer.phone } });
}
