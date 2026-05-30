/**
 * Helper de envío de Web Push a clientes Bubui (PWA).
 *
 * Misma mecánica que lib/push/web-push.ts (que sirve a usuarios del Hub),
 * pero apuntando a la tabla BubuiPushSubscription. Se separa para que el
 * envío a clientes Bubui sea totalmente independiente.
 */

import webPush from "web-push";
import { prisma } from "@/lib/db/prisma";
import { getVapidConfig, isVapidConfigured } from "@/lib/push/vapid";

let initialized = false;
function init() {
  if (initialized) return;
  if (!isBubuiPushEnabled()) return;
  const v = getVapidConfig();
  webPush.setVapidDetails(`mailto:${v.contactEmail}`, v.publicKey, v.privateKey);
  initialized = true;
}

export function isBubuiPushEnabled(): boolean {
  return isVapidConfigured();
}

export function getBubuiVapidPublicKey(): string | null {
  return getVapidConfig().publicKey;
}

export async function sendPushToBubuiCustomer(
  customerId: string,
  payload: {
    title: string;
    body: string;
    link?: string;
    tag?: string;
    icon?: string;
  }
): Promise<{ sent: number; removed: number }> {
  if (!isBubuiPushEnabled()) return { sent: 0, removed: 0 };
  init();

  const subs = await prisma.bubuiPushSubscription.findMany({ where: { customerId } });
  let sent = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webPush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.authKey } },
          JSON.stringify(payload)
        );
        sent++;
        // Guardamos log para analítica.
        await prisma.bubuiPushLog.create({
          data: {
            customerId,
            kind: payload.tag?.split("-")[0] ?? "generic",
            payload: payload as any
          }
        }).catch(() => {});
      } catch (e: any) {
        const status = e?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          await prisma.bubuiPushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          removed++;
        } else {
          console.warn("[bubui push] error:", status, e?.body ?? e?.message ?? e);
        }
      }
    })
  );
  return { sent, removed };
}
