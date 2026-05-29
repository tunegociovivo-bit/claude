/**
 * POST /api/bipi/push/subscribe
 *
 * Registra (upsert) una suscripción Web Push para un cliente Bipi.
 * Body:
 *   { customerId, subscription: { endpoint, keys: { p256dh, auth } }, userAgent? }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  customerId: z.string().min(1),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(10),
      auth: z.string().min(5)
    })
  }),
  userAgent: z.string().optional()
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const d = parsed.data;
  const customer = await prisma.bubuiCustomer.findUnique({ where: { id: d.customerId } });
  if (!customer) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  await prisma.bubuiPushSubscription.upsert({
    where: { endpoint: d.subscription.endpoint },
    create: {
      customerId: d.customerId,
      endpoint: d.subscription.endpoint,
      p256dh: d.subscription.keys.p256dh,
      authKey: d.subscription.keys.auth,
      userAgent: d.userAgent
    },
    update: {
      customerId: d.customerId,
      p256dh: d.subscription.keys.p256dh,
      authKey: d.subscription.keys.auth,
      userAgent: d.userAgent
    }
  });
  return NextResponse.json({ ok: true });
}
