/**
 * Registro de Expo Push Token y suscripción al backend.
 *
 * Se llama una vez por sesión cuando ya tenemos `customerId`. Si algo
 * falla (típicamente: dispositivo sin Google Mobile Services o sin
 * FCM configurado en el build), no propagamos el error — la app sigue
 * funcionando, solo no llegan los push.
 *
 * Para que los pushes lleguen en Android producción hace falta:
 *   - google-services.json bundleado en android/app/ y configurado en EAS.
 *   - O configurar las credenciales FCM v1 en la consola de Expo.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { api } from "./api";
import { openLink } from "./links";
import {
  displayRichNotification,
  setupRichTapHandler,
  registerRichNotifications
} from "./rich-notifications";

let lastRegisteredToken: { customerId: string; token: string } | null = null;

/**
 * Extrae la URL de imagen del payload de la notificación, si la trae.
 * Solo en Android: en iOS mostrar la imagen requiere una Notification Service
 * Extension en el build, así que ahí dejamos el comportamiento por defecto.
 */
function imageOf(notification: Notifications.Notification): string | undefined {
  if (Platform.OS !== "android") return undefined;
  const data = notification.request?.content?.data as { image?: unknown } | undefined;
  const img = data?.image;
  return typeof img === "string" && img.trim() ? img.trim() : undefined;
}

// Presentación de notificaciones recibidas con la app en primer plano.
// Sin imagen: que Expo muestre el banner de texto (comportamiento de siempre).
// Con imagen: la suprimimos para mostrar en su lugar la versión "rich" con
// foto grande vía Notifee (ver `addNotificationReceivedListener` abajo).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const hasImage = !!imageOf(notification);
    return {
      shouldShowAlert: !hasImage,
      shouldPlaySound: true,
      shouldSetBadge: false
    };
  }
});

function openNotificationLink(response: Notifications.NotificationResponse | null) {
  const data = response?.notification?.request?.content?.data as
    | { link?: unknown }
    | undefined;
  openLink(data?.link);
}

let tapHandlerReady = false;

/**
 * Engancha la apertura de la oferta al tocar la notificación (incluida su
 * imagen) y el pintado de las notificaciones con imagen en primer plano.
 * Cubre estos casos:
 *   - Toque con la app en segundo/primer plano → addNotificationResponseReceived
 *     (notifs de Expo) + setupRichTapHandler (notifs de Notifee).
 *   - App arrancada en frío desde la notificación → getLastNotificationResponse
 *     y getInitialNotification (dentro de setupRichTapHandler).
 *   - Push con imagen recibido en primer plano → addNotificationReceived, que
 *     lo muestra con foto grande vía Notifee.
 *
 * Devuelve una función de limpieza para los listeners.
 */
export function setupNotificationTapHandler(): () => void {
  // El listener puede registrarse varias veces sin efectos adversos, pero la
  // apertura en frío solo debe dispararse una vez.
  const tapSub = Notifications.addNotificationResponseReceivedListener(openNotificationLink);

  // Con la app en primer plano, los push con imagen se muestran con Notifee
  // (foto grande). Los de solo texto los sigue mostrando Expo (handler arriba).
  const recvSub = Notifications.addNotificationReceivedListener((notification) => {
    const image = imageOf(notification);
    if (!image) return;
    const content = notification.request?.content;
    const data = content?.data as { link?: unknown } | undefined;
    displayRichNotification({
      title: content?.title ?? null,
      body: content?.body ?? null,
      image,
      link: typeof data?.link === "string" ? data.link : null
    }).catch(() => {});
  });

  const cleanupRichTap = setupRichTapHandler();

  if (!tapHandlerReady) {
    tapHandlerReady = true;
    Notifications.getLastNotificationResponseAsync()
      .then(openNotificationLink)
      .catch(() => {});
  }
  return () => {
    tapSub.remove();
    recvSub.remove();
    cleanupRichTap();
  };
}

export async function registerExpoPushForCustomer(customerId: string): Promise<void> {
  try {
    // Evita reintentos innecesarios dentro de la misma sesión.
    if (lastRegisteredToken && lastRegisteredToken.customerId === customerId) {
      return;
    }

    // Android necesita un canal por defecto para mostrar notificaciones.
    // Importancia HIGH (igual que el canal de Notifee): con DEFAULT algunos
    // fabricantes degradan la notificación (sin heads-up).
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Bubui",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: "#EC4899"
      });
    }

    // Registra la task de fondo y el canal de Notifee para las notificaciones
    // con imagen (no-op en Expo Go o si Notifee no está disponible).
    await registerRichNotifications();

    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      const ask = await Notifications.requestPermissionsAsync();
      status = ask.status;
    }
    if (status !== "granted") return;

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    if (!projectId) return;

    const t = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = t.data;
    if (!token) return;

    await api.registerPushToken({
      customerId,
      token,
      platform: Platform.OS === "ios" ? "ios" : "android"
    });
    lastRegisteredToken = { customerId, token };
  } catch {
    // Silencioso: en muchos teléfonos sin GMS o sin Firebase configurado,
    // getExpoPushTokenAsync rechaza con error. No queremos romper la UI.
  }
}
