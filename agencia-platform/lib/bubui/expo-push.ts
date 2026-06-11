/**
 * Envío de Web Push a apps móviles nativas Bubui vía Expo Push Service.
 *
 * Por qué Expo Push y no FCM directo:
 *   - Expo abstrae APNs (iOS) + FCM (Android) bajo una sola API.
 *   - El SDK gestiona chunks (límite de 100 por request) y errores de
 *     credentials/DeviceNotRegistered → limpiamos tokens muertos.
 *
 * Requisitos en producción:
 *   - Android: FCM credentials configuradas en EAS (o en `google-services.json`
 *     bundleado en la app) para que los tokens entreguen al dispositivo.
 *   - iOS: APNs configurado en EAS / Apple Developer.
 *   - El cliente debe registrar su token llamando a
 *     `Notifications.getExpoPushTokenAsync({ projectId })` y enviándolo a
 *     `POST /api/bubui/customer/push-token/register`.
 *
 * Sin FCM/APNs configurados el envío JS funciona pero los tokens no
 * resuelven a un dispositivo real (Expo responde DeviceNotRegistered).
 */

import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { prisma } from "@/lib/db/prisma";

let _expo: Expo | null = null;
function getExpo(): Expo {
  if (_expo) return _expo;
  // Si tienes un access token de Expo, configúralo aquí; sin él, las
  // peticiones son anónimas y suficientes para Bubui.
  _expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  return _expo;
}

export type MobilePushPayload = {
  title: string;
  body: string;
  link?: string;
  /** URL pública de una imagen a mostrar en la notificación (rich push). */
  image?: string;
  /** Cualquier extra que la app móvil quiera leer al abrir la notif. */
  data?: Record<string, any>;
};

/**
 * Devuelve una URL de imagen apta para la notificación del sistema (FCM/APNs).
 * FCM no muestra imágenes grandes; si la imagen la sirve nuestro endpoint
 * (/api/bubui/banner-image/<id>), añadimos `?w=1024` para obtener una versión
 * JPEG ligera. Para URLs externas (bucket R2, etc.) la dejamos tal cual.
 */
function pushSafeImageUrl(url: string): string {
  if (!/\/api\/bubui\/banner-image\//.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "w=1024";
}

/**
 * Envía un push a todos los tokens dados. Limpia automáticamente los
 * tokens que Expo marca como inválidos (DeviceNotRegistered).
 */
export async function sendMobilePush(
  tokens: string[],
  payload: MobilePushPayload
): Promise<{ sent: number; removed: number; errors: number }> {
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) return { sent: 0, removed: 0, errors: 0 };

  const image = payload.image?.trim() || undefined;
  // FCM descarta en silencio las imágenes grandes (>~1MB) de las
  // notificaciones, dejando solo el texto. Si la imagen la servimos nosotros
  // (/api/bubui/banner-image/<id>), pedimos una variante ligera (?w=1024) para
  // `richContent.image` (lo que pinta el sistema). En `data.image` dejamos la
  // ORIGINAL: la usa Notifee en primer plano y no tiene ese límite de tamaño.
  const pushImage = image ? pushSafeImageUrl(image) : undefined;
  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    // `image` (original) viaja en data para el render en primer plano (Notifee);
    // `richContent.image` (ligera) la muestra el propio sistema (BigPicture en
    // Android, attachment en iOS).
    data: { link: payload.link ?? null, image: image ?? null, ...(payload.data ?? {}) },
    channelId: "default",
    // Con imagen pedimos prioridad alta para que la app pueda despertar su
    // background task (Notifee) y pintar la foto grande aunque esté cerrada.
    ...(pushImage
      ? { richContent: { image: pushImage }, mutableContent: true, priority: "high" as const }
      : {})
  }));

  const expo = getExpo();
  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];
  let errors = 0;

  for (const chunk of chunks) {
    try {
      const t = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...t);
    } catch (e) {
      errors++;
      console.warn("[bubui mobile push] chunk error:", e);
    }
  }

  // Recoge los tokens que el servicio devolvió como muertos para borrarlos
  // de la DB. Solo limpiamos por DeviceNotRegistered — el resto de errores
  // pueden ser transitorios.
  const deadTokens: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (t.status === "error" && (t as any).details?.error === "DeviceNotRegistered") {
      const original = valid[i];
      if (original) deadTokens.push(original);
    }
  }

  let removed = 0;
  if (deadTokens.length > 0) {
    try {
      const r = await prisma.bubuiMobilePushToken.deleteMany({
        where: { token: { in: deadTokens } }
      });
      removed = r.count;
    } catch (e) {
      console.warn("[bubui mobile push] cleanup error:", e);
    }
  }

  const sent = tickets.filter((t) => t.status === "ok").length;
  return { sent, removed, errors };
}

/** Envía push a TODOS los tokens registrados para un cliente. */
export async function sendMobilePushToCustomer(
  customerId: string,
  payload: MobilePushPayload
): Promise<{ sent: number; removed: number; errors: number }> {
  const rows = await prisma.bubuiMobilePushToken.findMany({
    where: { customerId },
    select: { token: true }
  });
  return sendMobilePush(rows.map((r) => r.token), payload);
}
