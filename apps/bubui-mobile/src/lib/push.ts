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

let lastRegisteredToken: { customerId: string; token: string } | null = null;

export async function registerExpoPushForCustomer(customerId: string): Promise<void> {
  try {
    // Evita reintentos innecesarios dentro de la misma sesión.
    if (lastRegisteredToken && lastRegisteredToken.customerId === customerId) {
      return;
    }

    // Android necesita un canal por defecto para mostrar notificaciones.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Bubui",
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: "#EC4899"
      });
    }

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
