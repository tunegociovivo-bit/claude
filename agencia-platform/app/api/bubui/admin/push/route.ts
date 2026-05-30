/**
 * POST /api/bubui/admin/push  (cabecera x-admin-token)
 * Envía una notificación push promocional a clientes Bubui.
 *
 * Body:
 *   { title, body, link?, onlyWithLocation? }
 *
 * Por ahora hace un envío masivo (a todos los clientes con suscripción
 * push). Devuelve cuántos envíos se hicieron.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";
import { isBubuiPushEnabled, sendPushToBubuiCustomer } from "@/lib/bubui/push";

export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(300),
  link: z.string().max(2000).optional().default("")
});

export async function POST(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  if (!isBubuiPushEnabled()) {
    return NextResponse.json(
      { error: { code: "push_not_configured", message: "Faltan las claves VAPID en el servidor." } },
      { status: 503 }
    );
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  const { title, body, link } = parsed.data;

  // Destinatarios: clientes con al menos una suscripción push.
  const subs = await prisma.bubuiPushSubscription.findMany({ select: { customerId: true } });
  const customerIds = Array.from(new Set(subs.map((s) => s.customerId)));

  let sent = 0;
  let removed = 0;
  let recipients = 0;
  for (const id of customerIds) {
    const r = await sendPushToBubuiCustomer(id, {
      title,
      body,
      link: link || undefined,
      tag: "ad-" + Date.now()
    });
    if (r.sent > 0) recipients++;
    sent += r.sent;
    removed += r.removed;
  }

  return NextResponse.json({ recipients, sent, removed, targeted: customerIds.length });
}
