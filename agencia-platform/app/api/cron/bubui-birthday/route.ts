/**
 * Cron diario — cupón automático de cumpleaños.
 *
 * Para cada negocio con birthdayEnabled, busca los clientes cuyo birthDate
 * (MM-DD) coincide con hoy Y que tengan firstBusinessId apuntando a ese
 * negocio (clientes "de la casa"). Crea una BubuiOffer con
 * birthdayDiscountPct, válida 7 días. Envía push y email.
 *
 * Dedupe: triggerBusinessId="bday:YYYY:<businessId>" — un cupón por año.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToBubuiCustomer, isBubuiPushEnabled } from "@/lib/bubui/push";
import { isEmailEnabled } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Hoy en España (MM-DD).
  const today = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  // formato dd/MM → lo invertimos a MM-DD
  const [dd, mm] = today.split("/");
  const mmdd = `${mm}-${dd}`;
  const year = new Date().getUTCFullYear();

  // Negocios con cumpleaños activo.
  const businesses = await prisma.bubuiBusiness.findMany({
    where: { birthdayEnabled: true, active: true },
    select: {
      id: true,
      name: true,
      birthdayDiscountPct: true,
      birthdayMessage: true,
      plan: true
    }
  });
  const paidBiz = businesses.filter((b) => b.plan === "pro" || b.plan === "premium");

  let created = 0;
  let pushSent = 0;
  let emailSent = 0;
  const pushOn = isBubuiPushEnabled();
  const emailOn = isEmailEnabled();

  for (const b of paidBiz) {
    // Clientes cuyo birthDate (YYYY-MM-DD) termina en MM-DD y cuya casa
    // (firstBusinessId) es este negocio.
    const customers = await prisma.bubuiCustomer.findMany({
      where: {
        firstBusinessId: b.id,
        birthDate: { endsWith: `-${mmdd}` }
      },
      select: { id: true, email: true, name: true }
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const pct = Math.max(3, Math.min(90, b.birthdayDiscountPct || 15));

    for (const c of customers) {
      const trigger = `bday:${year}:${b.id}`;
      try {
        await prisma.bubuiOffer.create({
          data: {
            customerId: c.id,
            businessId: b.id,
            discountPct: pct,
            triggerBusinessId: trigger,
            source: "birthday",
            expiresAt
          }
        });
        created++;
      } catch {
        continue; // ya tenía el cupón de este año
      }

      const greet = c.name ? `¡Feliz cumpleaños, ${c.name}!` : "¡Feliz cumpleaños!";
      const msg = b.birthdayMessage?.trim()
        || `Te invitamos a celebrarlo con un ${pct}% en ${b.name}. Tienes 7 días para canjearlo.`;
      if (pushOn) {
        await sendPushToBubuiCustomer(c.id, {
          title: `🎂 ${greet}`,
          body: `Tu cupón de ${pct}% en ${b.name} ya está activo.`,
          link: "/bubui/app",
          tag: `birthday-${b.id}`
        });
        pushSent++;
      }
      if (emailOn && c.email) {
        try {
          const { sendEmail } = await import("@/lib/integrations/email");
          await sendEmail({
            to: c.email,
            subject: `🎂 ${greet} ${b.name} te regala ${pct}%`,
            html: `<p>${greet}</p><p>${msg}</p><p><a href="https://bubui.app/app">Ábrelo en Bubui</a></p>`,
            text: `${greet} ${msg}`
          });
          emailSent++;
        } catch {}
      }
    }
  }

  return NextResponse.json({ ok: true, today: mmdd, businessesChecked: paidBiz.length, created, pushSent, emailSent });
}
