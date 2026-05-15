/**
 * Wrapper de web-push para enviar notificaciones nativas al navegador/móvil.
 * Requiere las VAPID keys en variables de entorno:
 *   VAPID_PUBLIC_KEY       → clave pública (también se expone al cliente para suscribirse)
 *   VAPID_PRIVATE_KEY      → clave privada (server-only)
 *   VAPID_CONTACT_EMAIL    → email de contacto (requerido por la spec)
 *
 * Genera el par con:
 *   npx web-push generate-vapid-keys
 *
 * Si no están configuradas, isPushEnabled() devuelve false y los endpoints
 * de suscripción responden 503 cleanly.
 */

import webPush from "web-push";
import { prisma } from "@/lib/db/prisma";

let initialized = false;
function init() {
  if (initialized) return;
  if (!isPushEnabled()) return;
  webPush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL}`,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  initialized = true;
}

export function isPushEnabled(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_CONTACT_EMAIL
  );
}

export function getPublicVapidKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

/**
 * Envía un push a todas las suscripciones del usuario. Si una suscripción
 * está caducada (404/410), la limpia automáticamente. Errores no fatales
 * se loguean y siguen.
 */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; link?: string; tag?: string }
) {
  if (!isPushEnabled()) return { sent: 0, removed: 0 };
  init();

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.authKey }
          },
          JSON.stringify(payload)
        );
        sent++;
      } catch (e: any) {
        const status = e?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          // suscripción expirada → borrar
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          removed++;
        } else {
          console.warn("[push] error al enviar:", status, e?.body ?? e?.message ?? e);
        }
      }
    })
  );
  return { sent, removed };
}
