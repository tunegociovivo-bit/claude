/**
 * POST /api/bubui/admin/push
 * Envía una notificación push promocional a clientes Bubui en TODOS
 * los canales en los que estén suscritos:
 *   - Web Push (PWA) — vía VAPID / web-push
 *   - Mobile Push (app nativa) — vía Expo Push Service
 *
 * Auth: sesión NextAuth con rol ADMIN.
 *
 * Body:
 *   { title, body, link?, image? }
 *
 * Devuelve un resumen agregado y por canal.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";
import { isBubuiPushEnabled, sendPushToBubuiCustomer } from "@/lib/bubui/push";
import { sendMobilePush } from "@/lib/bubui/expo-push";
import { getMaxPushPerDay, filterAllowedForPush, recordPushBatch } from "@/lib/bubui/push-cap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(300),
  link: z.string().max(2000).optional().default(""),
  image: z.string().max(2000).optional().default(""),
  // Audiencia: si llega una lista de customerIds, solo se envía a esos
  // (el panel ya la filtra por CP/edad/sexo/gustos/selección). Si no llega o
  // va vacía, se envía a TODOS los suscritos (comportamiento anterior).
  customerIds: z.array(z.string()).optional()
});

export async function POST(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  const { title, body, link } = parsed.data;
  const image = parsed.data.image?.trim() || undefined;
  // Audiencia objetivo (si se especifica). Set vacío/undefined = todos.
  const targetIds =
    parsed.data.customerIds && parsed.data.customerIds.length > 0
      ? new Set(parsed.data.customerIds)
      : null;
  const whereCustomer = targetIds ? { customerId: { in: Array.from(targetIds) } } : undefined;

  // Anti-fatiga: límite de push/día por cliente (configurable; 0 = ilimitado).
  // Filtramos los destinatarios que ya alcanzaron su tope hoy.
  const cap = await getMaxPushPerDay();
  const [webSubRows, mobileTokenRows] = await Promise.all([
    isBubuiPushEnabled()
      ? prisma.bubuiPushSubscription.findMany({ where: whereCustomer, select: { customerId: true } })
      : Promise.resolve([] as { customerId: string }[]),
    prisma.bubuiMobilePushToken.findMany({ where: whereCustomer, select: { customerId: true, token: true } })
  ]);
  const candidateIds = Array.from(
    new Set([...webSubRows.map((s) => s.customerId), ...mobileTokenRows.map((r) => r.customerId)])
  );
  const { allowed, usedToday } = await filterAllowedForPush(candidateIds, cap);
  const cappedOut = candidateIds.length - allowed.size;
  // Para no contar doble a quien recibe por web Y móvil en el mismo envío.
  const deliveredOnce = new Set<string>();

  // ── Canal 1: Web Push (PWA) ────────────────────────────────────────
  let webRecipients = 0;
  let webSent = 0;
  let webRemoved = 0;
  if (isBubuiPushEnabled()) {
    const customerIds = Array.from(new Set(webSubRows.map((s) => s.customerId))).filter((id) => allowed.has(id));
    for (const id of customerIds) {
      const r = await sendPushToBubuiCustomer(id, {
        title,
        body,
        link: link || undefined,
        image,
        tag: "ad-" + Date.now()
      });
      if (r.sent > 0) {
        webRecipients++;
        deliveredOnce.add(id);
      }
      webSent += r.sent;
      webRemoved += r.removed;
    }
  }

  // ── Canal 2: Mobile Push (Expo) ────────────────────────────────────
  const mobileRows = mobileTokenRows.filter((r) => allowed.has(r.customerId));
  const mobileRecipients = new Set(mobileRows.map((r) => r.customerId)).size;
  const mobileResult = await sendMobilePush(
    mobileRows.map((r) => r.token),
    { title, body, link: link || undefined, image }
  );
  for (const r of mobileRows) deliveredOnce.add(r.customerId);

  // Registramos 1 push/día por cliente al que se le entregó (web o móvil).
  await recordPushBatch(Array.from(deliveredOnce), usedToday);

  const totalRecipients = webRecipients + mobileRecipients;
  const totalSent = webSent + mobileResult.sent;
  const totalRemoved = webRemoved + mobileResult.removed;

  return NextResponse.json({
    // Campos top-level mantenidos por compatibilidad con el panel admin.
    recipients: totalRecipients,
    sent: totalSent,
    removed: totalRemoved,
    targeted: webRecipients + mobileRecipients,
    // Cuántos no recibieron por haber llegado a su tope diario de push.
    cappedOut,
    maxPerDay: cap,
    channels: {
      web: { recipients: webRecipients, sent: webSent, removed: webRemoved },
      mobile: {
        recipients: mobileRecipients,
        sent: mobileResult.sent,
        removed: mobileResult.removed,
        errors: mobileResult.errors
      }
    }
  });
}
