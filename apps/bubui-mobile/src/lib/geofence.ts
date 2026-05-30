/** Geofencing en segundo plano: avisa al cliente cuando pasa cerca de un
 *  negocio donde tiene un cupón activo.
 *
 *  Usa expo-location (region monitoring) + expo-task-manager. La task se
 *  define a nivel de módulo (requisito de TaskManager) — por eso este
 *  archivo debe importarse pronto (lo hace App.tsx).
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const GEOFENCE_TASK = "bubui-geofence";
const META_KEY = "bubui.geofence.meta";
// iOS permite ~20 regiones simultáneas; nos ceñimos a eso también en Android.
const MAX_REGIONS = 20;
const RADIUS_M = 150;

export type GeoBusiness = {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  discountPct?: number;
};

type GeoMeta = Record<string, { name: string; discountPct?: number }>;

// La task corre en background y solo recibe el identifier de la región;
// recuperamos el nombre/descuento del mapa persistido en AsyncStorage.
TaskManager.defineTask(GEOFENCE_TASK, async (event: any) => {
  if (event?.error) return;
  const { eventType, region } = event?.data ?? {};
  if (eventType !== Location.GeofencingEventType.Enter || !region?.identifier) return;
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    const meta: GeoMeta = raw ? JSON.parse(raw) : {};
    const b = meta[region.identifier];
    if (!b) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Estás cerca de ${b.name} 🎟️`,
        body: b.discountPct
          ? `Tu cupón de -${b.discountPct}% te espera aquí. ¡Entra y escanea el QR!`
          : "Tienes un cupón Bubui esperándote. ¡Entra y escanea el QR!"
      },
      trigger: null
    });
  } catch {}
});

/** Registra geocercas alrededor de los negocios con cupón activo. Pide el
 *  permiso de ubicación en background (requiere el de primer plano antes).
 *  Silencioso: cualquier fallo o permiso denegado simplemente no activa
 *  los avisos, sin romper el resto de la app. */
export async function startBubuiGeofencing(businesses: GeoBusiness[]): Promise<void> {
  try {
    const withCoords = businesses
      .filter((b) => b.latitude != null && b.longitude != null)
      .slice(0, MAX_REGIONS);
    if (withCoords.length === 0) return;

    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return; // sin ubicación en uso no pedimos background
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== "granted") return;

    const meta: GeoMeta = {};
    const regions = withCoords.map((b) => {
      meta[b.id] = { name: b.name, discountPct: b.discountPct };
      return {
        identifier: b.id,
        latitude: b.latitude as number,
        longitude: b.longitude as number,
        radius: RADIUS_M,
        notifyOnEnter: true,
        notifyOnExit: false
      };
    });

    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
    const running = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK).catch(() => false);
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  } catch {}
}

/** Detiene el monitoreo de geocercas (p. ej. al cerrar sesión). */
export async function stopBubuiGeofencing(): Promise<void> {
  try {
    const running = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK).catch(() => false);
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
  } catch {}
}
