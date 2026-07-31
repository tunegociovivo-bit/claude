/**
 * POST /api/bubui/business/[id]/challenges/remind   { customerId }
 *
 * Manda un RECORDATORIO al cliente para que complete su reto: push automático
 * (Bubui web + móvil) y devuelve un enlace wa.me listo para que el dueño se lo
 * mande también por WhatsApp de un toque.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { notifyBubuiCustomer } from "@/lib/bubui/notify";
import { countVerifiedReferrals, countQualifiedReferrals } from "@/lib/bubui/referral";
import { sharesLeft } from "@/lib/bubui/share-offer";
import { bubuiUrl } from "@/lib/bubui/url";

export const dynamic = "force-dynamic";

const schema = z.object({ customerId: z.string().min(1) });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: "Falta customerId" } }, { status: 400 });
  }
  const { customerId } = parsed.data;

  const offer = await prisma.bubuiOffer.findFirst({
    where: {
      businessId: params.id,
      customerId,
      source: "share_challenge",
      active: false,
      redeemed: false,
      expiresAt: { gt: new Date() }
    }
  });
  if (!offer) {
    return NextResponse.json({ error: { code: "no_challenge", message: "Este cliente no tiene un reto activo." } }, { status: 404 });
  }

  const [business, customer] = await Promise.all([
    prisma.bubuiBusiness.findUnique({ where: { id: params.id }, select: { name: true } }),
    prisma.bubuiCustomer.findUnique({ where: { id: customerId }, select: { name: true, phone: true, referralCode: true } })
  ]);

  const verified = offer.unlockRequiresPurchase
    ? await countQualifiedReferrals(customerId, params.id)
    : await countVerifiedReferrals(customerId);
  const left = sharesLeft({ unlockBaseline: offer.unlockBaseline, unlockShares: offer.unlockShares }, verified);
  const bizName = business?.name ?? "tu comercio";

  const body =
    left > 0
      ? `Te ${left === 1 ? "falta 1 amigo" : `faltan ${left} amigos`} para conseguir tu ${offer.discountPct}% en ${bizName}. ¡Comparte tu enlace y consíguelo!`
      : `¡Ya tienes los amigos necesarios! Pásate a por tu ${offer.discountPct}% en ${bizName}.`;

  // Push automático (web + móvil).
  const push = await notifyBubuiCustomer(customerId, {
    title: "Tu reto en Bubui 🎯",
    body,
    link: "/bubui/app/afiliados"
  }).catch(() => ({ sent: 0 }) as any);

  // Enlace wa.me para que el dueño lo mande también por WhatsApp.
  const shareUrl = customer?.referralCode ? bubuiUrl(`/r/${customer.referralCode}`) : bubuiUrl("/app");
  const waText = `¡Hola${customer?.name ? ` ${customer.name}` : ""}! ${body}\n\nTu enlace para invitar: ${shareUrl}`;
  const digits = (customer?.phone ?? "").replace(/[^0-9]/g, "");
  const whatsappUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(waText)}` : null;

  return NextResponse.json({ ok: true, pushSent: (push as any)?.sent ?? 0, whatsappUrl });
}
