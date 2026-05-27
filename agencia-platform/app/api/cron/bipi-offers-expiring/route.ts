/**
 * Cron Bipi — avisos de cupones a punto de caducar.
 *
 * Se ejecuta cada hora. Para cada cliente:
 *   - Si tiene cupones que caducan en las próximas 24h → push "tus cupones
 *     caducan mañana".
 *   - Si tiene cupones que caducan HOY mismo (las próximas 4h) → push
 *     urgente.
 *
 * Dedupe vía BipiPushLog: no enviamos dos avisos del mismo tipo a la misma
 * persona en menos de 12h.
 *
 * Seguridad: header Authorization: Bearer ${CRON_SECRET}.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToBipiCustomer, isBipiPushEnabled } from "@/lib/bipi/push";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isBipiPushEnabled()) {
    return NextResponse.json({ ok: false, reason: "push_not_configured" });
  }

  const now = new Date();
  const in4h = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dedupCutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  // 1) URGENTE: cupones que caducan en <4h
  const urgent = await prisma.bipiOffer.findMany({
    where: {
      redeemed: false,
      expiresAt: { gt: now, lte: in4h }
    },
    include: { business: { select: { name: true } } }
  });

  // Agrupa por customer.
  const urgentByCustomer = groupBy(urgent, (o) => o.customerId);
  let urgentSent = 0;
  for (const [customerId, offers] of urgentByCustomer) {
    const dedup = await prisma.bipiPushLog.findFirst({
      where: { customerId, kind: "expiring_4h", sentAt: { gte: dedupCutoff } }
    });
    if (dedup) continue;
    const first = offers[0];
    const body =
      offers.length === 1
        ? `Tu cupón en ${first.business.name} (${first.discountPct}%) caduca hoy. ¡Úsalo antes!`
        : `Tienes ${offers.length} cupones que caducan hoy. Échales un ojo.`;
    await sendPushToBipiCustomer(customerId, {
      title: "⏰ Caducan hoy",
      body,
      link: "/bipi/app",
      tag: "expiring_4h"
    });
    urgentSent++;
  }

  // 2) MEDIO: cupones que caducan entre 4h y 24h (recordatorio "mañana")
  const tomorrow = await prisma.bipiOffer.findMany({
    where: {
      redeemed: false,
      expiresAt: { gt: in4h, lte: in24h }
    },
    include: { business: { select: { name: true } } }
  });
  const tomorrowByCustomer = groupBy(tomorrow, (o) => o.customerId);
  let tomorrowSent = 0;
  for (const [customerId, offers] of tomorrowByCustomer) {
    const dedup = await prisma.bipiPushLog.findFirst({
      where: { customerId, kind: "expiring_24h", sentAt: { gte: dedupCutoff } }
    });
    if (dedup) continue;
    const body =
      offers.length === 1
        ? `Tu cupón en ${offers[0].business.name} caduca mañana. No te olvides.`
        : `Tienes ${offers.length} cupones que caducan mañana.`;
    await sendPushToBipiCustomer(customerId, {
      title: "🔔 Mañana caducan",
      body,
      link: "/bipi/app",
      tag: "expiring_24h"
    });
    tomorrowSent++;
  }

  return NextResponse.json({
    ok: true,
    urgent: urgentByCustomer.size,
    urgentSent,
    tomorrow: tomorrowByCustomer.size,
    tomorrowSent
  });
}

function groupBy<T, K>(arr: T[], keyFn: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of arr) {
    const k = keyFn(x);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(x);
  }
  return out;
}
