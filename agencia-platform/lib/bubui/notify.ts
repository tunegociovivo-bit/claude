/**
 * Notificación unificada a un cliente Bubui por TODOS sus canales:
 *   - Web Push (PWA)  → lib/bubui/push (requiere VAPID configurado)
 *   - Push móvil nativo (Expo/FCM) → lib/bubui/expo-push (requiere token)
 *
 * Cada canal se auto-gatea: si el cliente no tiene suscripción web o no tiene
 * token móvil, ese canal simplemente no envía (no error). Así los triggers
 * (crons de ofertas/cumpleaños, Stripe, etc.) llaman a UNA sola función y
 * llegan a ambos sitios — antes el push móvil se quedaba sin disparar porque
 * solo se llamaba al canal web.
 */

import { sendPushToBubuiCustomer } from "./push";
import { sendMobilePushToCustomer } from "./expo-push";

export type BubuiNotifyPayload = {
  title: string;
  body: string;
  link?: string;
  tag?: string;
  icon?: string;
  /** URL de imagen grande mostrada en la notificación (rich push). */
  image?: string;
  data?: Record<string, any>;
};

export async function notifyBubuiCustomer(
  customerId: string,
  payload: BubuiNotifyPayload
): Promise<{ web: number; mobile: number; sent: number }> {
  const [web, mobile] = await Promise.allSettled([
    sendPushToBubuiCustomer(customerId, payload),
    sendMobilePushToCustomer(customerId, {
      title: payload.title,
      body: payload.body,
      link: payload.link,
      image: payload.image,
      data: payload.data
    })
  ]);
  const webSent = web.status === "fulfilled" ? web.value.sent : 0;
  const mobileSent = mobile.status === "fulfilled" ? mobile.value.sent : 0;
  if (web.status === "rejected") console.warn("[bubui notify] web push:", web.reason);
  if (mobile.status === "rejected") console.warn("[bubui notify] mobile push:", mobile.reason);
  return { web: webSent, mobile: mobileSent, sent: webSent + mobileSent };
}
