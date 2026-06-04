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
 *   { title, body, link? }
 *
 * Devuelve un resumen agregado y por canal.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";
import { isBubuiPushEnabled, sendPushToBubuiCustomer } from "@/lib/bubui/push";
import { sendMobilePush } from "@/lib/bubui/expo-push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(300),
  link: z.string().max(2000).optional().default(""),
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
  // Audiencia objetivo (si se especifica). Set vacío/undefined = todos.
  const targetIds =
    parsed.data.customerIds && parsed.data.customerIds.length > 0
      ? new Set(parsed.data.customerIds)
      : null;
  const whereCustomer = targetIds ? { customerId: { in: Array.from(targetIds) } } : undefined;

  // ── Canal 1: Web Push (PWA) ────────────────────────────────────────
  let webRecipients = 0;
  let webSent = 0;
  let webRemoved = 0;
  if (isBubuiPushEnabled()) {
    const subs = await prisma.bubuiPushSubscription.findMany({ where: whereCustomer, select: { customerId: true } });
    const customerIds = Array.from(new Set(subs.map((s) => s.customerId)));
    for (const id of customerIds) {
      const r = await sendPushToBubuiCustomer(id, {
        title,
        body,
        link: link || undefined,
        tag: "ad-" + Date.now()
      });
      if (r.sent > 0) webRecipients++;
      webSent += r.sent;
      webRemoved += r.removed;
    }
  }

  // ── Canal 2: Mobile Push (Expo) ────────────────────────────────────
  const mobileRows = await prisma.bubuiMobilePushToken.findMany({
    where: whereCustomer,
    select: { customerId: true, token: true }
  });
  const mobileRecipients = new Set(mobileRows.map((r) => r.customerId)).size;
  const mobileResult = await sendMobilePush(
    mobileRows.map((r) => r.token),
    { title, body, link: link || undefined }
  );

  const totalRecipients = webRecipients + mobileRecipients;
  const totalSent = webSent + mobileResult.sent;
  const totalRemoved = webRemoved + mobileResult.removed;

  return NextResponse.json({
    // Campos top-level mantenidos por compatibilidad con el panel admin.
    recipients: totalRecipients,
    sent: totalSent,
    removed: totalRemoved,
    targeted: webRecipients + mobileRecipients,
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
