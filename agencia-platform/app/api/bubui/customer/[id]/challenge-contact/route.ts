import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk, customerIdFromAuth } from "@/lib/bubui/customer-auth";

const schema = z.object({ offerId: z.string().min(1), channel: z.enum(["qr", "whatsapp"]) });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (customerIdFromAuth(req) !== params.id || !(await customerAuthOk(req, params.id))) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: "Contacto inválido" } }, { status: 400 });
  const customer = await prisma.bubuiCustomer.findUnique({ where: { id: params.id }, select: { referralOfferId: true } });
  if (!customer?.referralOfferId) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const result = await prisma.bubuiChallengeParticipant.updateMany({
    where: { friendCustomerId: params.id, offerId: customer.referralOfferId, contactedAt: null },
    data: { contactedAt: new Date(), contactChannel: parsed.data.channel }
  });
  if (!result.count) {
    const exists = await prisma.bubuiChallengeParticipant.count({ where: { friendCustomerId: params.id, offerId: customer.referralOfferId } });
    if (!exists) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
