/**
 * Cron Bubui — avisos de cupones a punto de caducar.
 *
 * Se ejecuta cada hora. Para cada cliente:
 *   - Si tiene cupones que caducan en las próximas 24h → push "tus cupones
 *     caducan mañana".
 *   - Si tiene cupones que caducan HOY mismo (las próximas 4h) → push
 *     urgente.
 *
 * Dedupe vía BubuiPushLog: no enviamos dos avisos del mismo tipo a la misma
 * persona en menos de 12h.
 *
 * Seguridad: header Authorization: Bearer ${CRON_SECRET}.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { notifyBubuiCustomer } from "@/lib/bubui/notify";
import { isEmailEnabled } from "@/lib/integrations/email";
import { sendOfferExpiringEmail } from "@/lib/bubui/email";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // El push se intenta SIEMPRE: notifyBubuiCustomer envía a web (no-op si no
  // hay VAPID) y a móvil (no-op si no hay token). Antes esto se gateaba con
  // isBubuiPushEnabled() (solo web), dejando el push móvil sin disparar.
  const pushOn = true;
  const emailOn = isEmailEnabled();
  if (!pushOn && !emailOn) {
    return NextResponse.json({ ok: false, reason: "no_channel_configured" });
  }

  const now = new Date();
  const in4h = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dedupCutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  // 1) URGENTE: cupones que caducan en <4h
  const urgent = await prisma.bubuiOffer.findMany({
    where: {
      redeemed: false,
      expiresAt: { gt: now, lte: in4h }
    },
    include: { business: { select: { name: true } } }
  });

  // Agrupa por customer.
  const urgentByCustomer = groupBy(urgent, (o) => o.customerId);
  let urgentSent = 0;
  let urgentEmailed = 0;
  for (const [customerId, offers] of urgentByCustomer) {
    const first = offers[0];
    if (pushOn) {
      const dedup = await prisma.bubuiPushLog.findFirst({
        where: { customerId, kind: "expiring_4h", sentAt: { gte: dedupCutoff } }
      });
      if (!dedup) {
        const body =
          offers.length === 1
            ? `Tu cupón en ${first.business.name} (${first.discountPct}%) caduca hoy. ¡Úsalo antes!`
            : `Tienes ${offers.length} cupones que caducan hoy. Échales un ojo.`;
        await notifyBubuiCustomer(customerId, {
          title: "⏰ Caducan hoy",
          body,
          link: "/bubui/app",
          tag: "expiring_4h"
        });
        urgentSent++;
      }
    }
    if (emailOn && (await sendExpiringEmail(customerId, offers, "expiring_4h", true, dedupCutoff))) {
      urgentEmailed++;
    }
  }

  // 2) MEDIO: cupones que caducan entre 4h y 24h (recordatorio "mañana")
  const tomorrow = await prisma.bubuiOffer.findMany({
    where: {
      redeemed: false,
      expiresAt: { gt: in4h, lte: in24h }
    },
    include: { business: { select: { name: true } } }
  });
  const tomorrowByCustomer = groupBy(tomorrow, (o) => o.customerId);
  let tomorrowSent = 0;
  let tomorrowEmailed = 0;
  for (const [customerId, offers] of tomorrowByCustomer) {
    if (pushOn) {
      const dedup = await prisma.bubuiPushLog.findFirst({
        where: { customerId, kind: "expiring_24h", sentAt: { gte: dedupCutoff } }
      });
      if (!dedup) {
        const body =
          offers.length === 1
            ? `Tu cupón en ${offers[0].business.name} caduca mañana. No te olvides.`
            : `Tienes ${offers.length} cupones que caducan mañana.`;
        await notifyBubuiCustomer(customerId, {
          title: "🔔 Mañana caducan",
          body,
          link: "/bubui/app",
          tag: "expiring_24h"
        });
        tomorrowSent++;
      }
    }
    if (emailOn && (await sendExpiringEmail(customerId, offers, "expiring_24h", false, dedupCutoff))) {
      tomorrowEmailed++;
    }
  }

  return NextResponse.json({
    ok: true,
    urgent: urgentByCustomer.size,
    urgentSent,
    urgentEmailed,
    tomorrow: tomorrowByCustomer.size,
    tomorrowSent,
    tomorrowEmailed
  });
}

/** Envía el email de caducidad a un cliente con dedup propio (kind
 *  `email_*`). Devuelve true si lo envió. */
async function sendExpiringEmail(
  customerId: string,
  offers: Array<{ business: { name: string } }>,
  baseKind: "expiring_4h" | "expiring_24h",
  urgent: boolean,
  dedupCutoff: Date
): Promise<boolean> {
  const emailKind = `email_${baseKind}`;
  const dedup = await prisma.bubuiPushLog.findFirst({
    where: { customerId, kind: emailKind, sentAt: { gte: dedupCutoff } }
  });
  if (dedup) return false;
  const customer = await prisma.bubuiCustomer.findUnique({
    where: { id: customerId },
    select: { email: true, name: true }
  });
  if (!customer?.email) return false;
  await sendOfferExpiringEmail({
    to: customer.email,
    customerName: customer.name,
    count: offers.length,
    firstBusinessName: offers[0].business.name,
    urgent
  });
  await prisma.bubuiPushLog.create({
    data: { customerId, kind: emailKind, payload: { count: offers.length } }
  });
  return true;
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
