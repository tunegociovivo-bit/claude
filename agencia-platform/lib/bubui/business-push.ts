/**
 * Web Push al PANEL del negocio (PWA). Misma mecánica que
 * lib/bubui/push.ts (clientes) pero sobre BubuiBusinessPushSubscription.
 * Permite avisar al dueño en su dispositivo de eventos de valor — el primero,
 * "Bubui te ha traído un cliente nuevo".
 */
import webPush from "web-push";
import { prisma } from "@/lib/db/prisma";
import { getVapidConfig } from "@/lib/push/vapid";
import { isBubuiPushEnabled } from "./push";

let initialized = false;
function init() {
  if (initialized) return;
  if (!isBubuiPushEnabled()) return;
  const v = getVapidConfig();
  webPush.setVapidDetails(`mailto:${v.contactEmail}`, v.publicKey, v.privateKey);
  initialized = true;
}

export async function sendPushToBubuiBusiness(
  businessId: string,
  payload: { title: string; body: string; link?: string; tag?: string }
): Promise<{ sent: number; removed: number }> {
  if (!isBubuiPushEnabled()) return { sent: 0, removed: 0 };
  init();

  const subs = await prisma.bubuiBusinessPushSubscription.findMany({ where: { businessId } });
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
      } catch (e: any) {
        const status = e?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          await prisma.bubuiBusinessPushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          removed++;
        } else {
          console.warn("[bubui business push] error:", status, e?.body ?? e?.message ?? e);
        }
      }
    })
  );
  return { sent, removed };
}
