/**
 * POST /api/bubui/activity
 *
 * La app y la PWA registran aquí las acciones que no dejan rastro en ninguna
 * otra tabla (compartir una oferta, el enlace de invitación, la ficha de un
 * comercio o un reto). Alimenta el historial de actividad del panel admin.
 *
 * Exige el token de sesión del cliente (Authorization: Bearer <id>:<token>):
 * sin él cualquiera podría ensuciar el historial de otro usuario. Responde 204
 * también cuando descarta un duplicado; nunca debe bloquear el compartir.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk, customerIdFromAuth } from "@/lib/bubui/customer-auth";
import { CLIENT_SHARE_TYPES, SHARE_CHANNELS, logBubuiActivity } from "@/lib/bubui/activity";

export const dynamic = "force-dynamic";

const schema = z.object({
  customerId: z.string().min(1).max(64),
  type: z.enum(CLIENT_SHARE_TYPES),
  offerId: z.string().min(1).max(64).optional(),
  businessId: z.string().min(1).max(64).optional(),
  channel: z.enum(SHARE_CHANNELS).optional(),
  platform: z.enum(["web", "android", "ios"]).optional(),
  appBuild: z.string().max(20).optional()
});

// Doble toque en el botón de compartir: no lo contamos dos veces.
const DEDUPE_MS = 5_000;

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const d = parsed.data;
  if (customerIdFromAuth(req) !== d.customerId || !(await customerAuthOk(req, d.customerId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  // La oferta tiene que ser del propio cliente; de ella sale el comercio.
  let businessId: string | null = null;
  let offerId: string | null = null;
  if (d.offerId) {
    const offer = await prisma.bubuiOffer.findFirst({
      where: { id: d.offerId, customerId: d.customerId },
      select: { id: true, businessId: true }
    });
    if (offer) {
      offerId = offer.id;
      businessId = offer.businessId;
    }
  }
  if (!businessId && d.businessId) {
    const business = await prisma.bubuiBusiness.findUnique({ where: { id: d.businessId }, select: { id: true } });
    businessId = business?.id ?? null;
  }

  const recent = await prisma.bubuiActivityEvent.findFirst({
    where: {
      customerId: d.customerId,
      type: d.type,
      offerId,
      businessId,
      createdAt: { gt: new Date(Date.now() - DEDUPE_MS) }
    },
    select: { id: true }
  });
  if (!recent) {
    await logBubuiActivity({
      customerId: d.customerId,
      type: d.type,
      offerId,
      businessId,
      channel: d.channel ?? null,
      platform: d.platform ?? null,
      appBuild: d.appBuild ?? null
    });
  }
  return new NextResponse(null, { status: 204 });
}
