import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking, Platform } from "react-native";
import { api } from "./api";

/**
 * Captura y reclamo de RETOS (custom-deal) para la app nativa. Espejo de
 * referral-pending.ts pero para el token del reto que el comercio envía por
 * WhatsApp.
 *
 * Dos fuentes de captura:
 *  1) Deep link: el cliente abre el reto con la app instalada
 *     (bubui://reto/<token>, https://bubui.app/reto/<token> o ...?deal=<token>).
 *  2) Play Install Referrer (Android): instalación diferida — no tenía la app,
 *     la instala desde Play (con &referrer=reto_<token>) y al primer arranque
 *     recuperamos el token. (iOS no tiene Install Referrer → el cliente vuelve a
 *     pulsar el enlace tras instalar y el deep link lo captura.)
 *
 * El token se guarda como "pendiente" y se RECLAMA en cuanto hay sesión
 * (tras el alta/login o al arrancar con sesión), llamando al endpoint claim.
 */

const KEY = "bubui.pendingDeal";
const IR_DONE = "bubui.installReferrerDealChecked";

/** Extrae un token de reto (16 hex, con margen 12-40) de una URL o referrer. */
export function parseDealFromString(s: string | null | undefined): string | null {
  if (!s) return null;
  const patterns = [/[?&]deal=([a-f0-9]{12,40})/i, /\/reto\/([a-f0-9]{12,40})/i, /reto_([a-f0-9]{12,40})/i];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export async function storePendingDeal(token: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY, token); } catch {}
}
export async function getPendingDeal(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}
export async function clearPendingDeal(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}

async function captureFromUrl(url: string | null): Promise<void> {
  const token = parseDealFromString(url);
  if (token) await storePendingDeal(token); // deep link = intención directa, prevalece
}

/** Android: lee el Install Referrer una sola vez (instalación diferida). */
async function captureInstallReferrerOnce(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(IR_DONE)) return;
    await AsyncStorage.setItem(IR_DONE, "1");
    let mod: any = null;
    try {
      mod = require("react-native-play-install-referrer");
    } catch {
      return;
    }
    const PIR = mod?.PlayInstallReferrer ?? mod?.default ?? mod;
    if (!PIR?.getInstallReferrerInfo) return;
    PIR.getInstallReferrerInfo((info: any, err: any) => {
      if (err) return;
      const token = parseDealFromString(info?.installReferrer);
      if (token) void getPendingDeal().then((cur) => { if (!cur) void storePendingDeal(token); });
    });
  } catch {}
}

let inited = false;
/** Arranca la captura de retos (deep links + install referrer). Idempotente. */
export function initDealCapture(): void {
  if (inited) return;
  inited = true;
  Linking.getInitialURL().then(captureFromUrl).catch(() => {});
  Linking.addEventListener("url", (e) => { void captureFromUrl(e.url); });
  if (Platform.OS === "android") void captureInstallReferrerOnce();
}

/**
 * Reclama el reto pendiente (si lo hay) para el cliente con sesión. Requiere que
 * el auth ya esté fijado (saveSession/CheckSession lo hacen). Si falla, deja el
 * pendiente para reintentar en el próximo arranque.
 */
export async function claimPendingDeal(customerId: string): Promise<void> {
  const token = await getPendingDeal();
  if (!token) return;
  try {
    await api.claimDeal(token, customerId);
    await clearPendingDeal();
  } catch {
    // se reintentará al próximo arranque con sesión
  }
}
