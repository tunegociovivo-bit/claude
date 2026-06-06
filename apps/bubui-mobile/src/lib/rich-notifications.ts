/**
 * Notificaciones "rich" (con imagen grande) usando Notifee.
 *
 * Por qué Notifee y no expo-notifications a secas:
 *   En Android, expo-notifications (SDK 51) NO pinta la imagen de un push
 *   remoto: solo lee `notification.imageUrl` de FCM —campo que Expo no
 *   rellena cuando entrega el push como mensaje "data"— y, aun así, la
 *   colocaría como icono pequeño (`setLargeIcon`), nunca como foto grande.
 *   Notifee permite construir la notificación con estilo BigPicture (foto
 *   grande expandible en Android) y adjuntar la imagen en iOS.
 *
 * Estrategia (retrocompatible con instalaciones que no tengan este código):
 *   - Primer plano: `push.ts` suprime la notificación por defecto de Expo
 *     cuando el push trae imagen y llama a `displayRichNotification`.
 *   - Segundo plano / app cerrada: Expo muestra una notificación de solo
 *     texto y, además, dispara la background task definida aquí. La task
 *     descarta esa notificación de texto y la sustituye por la versión con
 *     imagen. Si la task no llega a ejecutarse (throttling del SO), el
 *     usuario se queda con el texto → degradación elegante.
 *
 * En Expo Go no hay módulos nativos: si detectamos ese entorno no hacemos
 * nada y dejamos el comportamiento por defecto (solo texto), evitando que el
 * `require` de Notifee rompa la app.
 */

import Constants from "expo-constants";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { openLink } from "./links";

/** Expo Go no incluye módulos nativos de terceros como Notifee. */
export const isExpoGo = Constants.executionEnvironment === "storeClient";

const CHANNEL_ID = "default";
const BACKGROUND_TASK = "BUBUI_RICH_NOTIFICATION";

// Carga perezosa de Notifee: en Expo Go el require lanzaría al no existir el
// módulo nativo. Guardamos también los enums que necesitamos.
let _notifee: any = null;
let _AndroidStyle: any = null;
let _AndroidImportance: any = null;
let _EventType: any = null;
let _loaded = false;

function getNotifee(): any | null {
  if (isExpoGo) return null;
  if (_loaded) return _notifee;
  _loaded = true;
  try {
    const mod = require("@notifee/react-native");
    _notifee = mod.default;
    _AndroidStyle = mod.AndroidStyle;
    _AndroidImportance = mod.AndroidImportance;
    _EventType = mod.EventType;
  } catch {
    _notifee = null;
  }
  return _notifee;
}

export type RichPayload = {
  title?: string | null;
  body?: string | null;
  image?: string | null;
  link?: string | null;
  /** id de la notificación de Expo a descartar (para no duplicar). */
  dismissId?: string | null;
};

async function ensureChannel(notifee: any): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: "Bubui",
    importance: _AndroidImportance?.HIGH ?? 4,
    lightColor: "#EC4899"
  });
}

/**
 * Muestra (o reemplaza) una notificación con imagen grande. Devuelve `true`
 * si se mostró con Notifee; `false` si no había imagen o no está disponible
 * (en cuyo caso el llamador debe dejar el comportamiento por defecto).
 */
export async function displayRichNotification(payload: RichPayload): Promise<boolean> {
  const notifee = getNotifee();
  if (!notifee) return false;
  const image = payload.image?.trim();
  if (!image) return false;
  try {
    await ensureChannel(notifee);
    if (payload.dismissId) {
      // Quita la notificación de solo-texto que Expo pudo haber mostrado.
      await Notifications.dismissNotificationAsync(payload.dismissId).catch(() => {});
    }
    await notifee.displayNotification({
      title: payload.title ?? undefined,
      body: payload.body ?? undefined,
      data: { link: payload.link ?? "" },
      android: {
        channelId: CHANNEL_ID,
        largeIcon: image,
        style: { type: _AndroidStyle.BIGPICTURE, picture: image },
        pressAction: { id: "default" }
      },
      ios: {
        attachments: [{ url: image }]
      }
    });
    return true;
  } catch {
    return false;
  }
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * Extrae el payload de la oferta del mensaje remoto que recibe la background
 * task. expo-notifications envuelve el RemoteMessage serializado bajo la clave
 * `notification`, y el mapa de datos de FCM queda en `notification.data`:
 *   { notification: { data: { title, message, body: "<json>" }, messageId } }
 * donde `title` es el título, `message` el cuerpo de texto y `body` el JSON
 * con nuestros campos personalizados (link, image).
 */
function parsePayloadFromRemote(data: any): RichPayload | null {
  try {
    const root = data?.notification ?? data ?? {};
    const fcm = root?.data ?? {};
    const custom = typeof fcm.body === "string" ? safeJson(fcm.body) : fcm.body ?? {};
    const image = custom?.image ?? fcm.image ?? null;
    if (!image) return null;
    return {
      title: fcm.title ?? null,
      body: fcm.message ?? null,
      image,
      link: custom?.link ?? null,
      dismissId: fcm.tag ?? root?.messageId ?? null
    };
  } catch {
    return null;
  }
}

// ── Registro en ámbito global (obligatorio para tasks/handlers de fondo) ──
if (!isExpoGo) {
  // Task que expo invoca al recibir un push con la app en segundo plano o
  // cerrada. Debe definirse en el ámbito global del módulo.
  TaskManager.defineTask(BACKGROUND_TASK, async ({ data, error }: any) => {
    if (error) return;
    const payload = parsePayloadFromRemote(data);
    if (payload) await displayRichNotification(payload);
  });

  // Manejo del toque cuando la app está en segundo plano/cerrada. Notifee
  // exige tener registrado un handler de fondo. El toque abre la app
  // (pressAction "default") y `consumeInitialRichNotification` abre el enlace.
  const notifee = getNotifee();
  notifee?.onBackgroundEvent(async ({ type, detail }: any) => {
    if (type === _EventType?.PRESS) {
      openLink(detail?.notification?.data?.link);
    }
  });
}

/**
 * Engancha el toque de las notificaciones de Notifee mientras la app está
 * abierta y abre el enlace si la app se arrancó tocando una. Devuelve una
 * función de limpieza. No-op en Expo Go.
 */
export function setupRichTapHandler(): () => void {
  const notifee = getNotifee();
  if (!notifee) return () => {};
  const unsub = notifee.onForegroundEvent(({ type, detail }: any) => {
    if (type === _EventType?.PRESS) {
      openLink(detail?.notification?.data?.link);
    }
  });
  notifee
    .getInitialNotification()
    .then((initial: any) => {
      if (initial?.notification?.data?.link) openLink(initial.notification.data.link);
    })
    .catch(() => {});
  return () => {
    try {
      unsub?.();
    } catch {}
  };
}

/** Registra la background task y crea el canal. Llamar una vez al iniciar. */
export async function registerRichNotifications(): Promise<void> {
  const notifee = getNotifee();
  if (!notifee) return;
  try {
    await ensureChannel(notifee);
    await Notifications.registerTaskAsync(BACKGROUND_TASK);
  } catch {
    // En desarrollo o sin permisos puede fallar; no rompemos la app.
  }
}
