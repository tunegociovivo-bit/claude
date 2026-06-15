import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking, Platform } from "react-native";

/**
 * Captura del código de referido para la app nativa.
 *
 * Dos fuentes:
 *  1) Deep link: el amigo abre el enlace de invitación con la app instalada
 *     (bubui://r/<code> o https://bubui.app/bubui/r/<code> / ...?ref=<code>).
 *  2) Play Install Referrer (Android): instalación diferida — el amigo NO tenía
 *     la app, la instala desde Play (con &referrer=ref_<code>) y al primer
 *     arranque recuperamos el código. Es a prueba de fallos: si el módulo nativo
 *     no está disponible, simplemente no hace nada.
 *
 * El código capturado se guarda como "pendiente" y se envía en el alta
 * (verify-otp) para vincular al amigo con quien lo invitó.
 */

const KEY = "bubui.pendingRef";
const IR_DONE = "bubui.installReferrerChecked";

/** Extrae un código de referido (4-10 alfanum.) de una URL o cadena referrer. */
export function parseRefFromString(s: string | null | undefined): string | null {
  if (!s) return null;
  const patterns = [/[?&]ref=([A-Za-z0-9]{4,10})/, /\/r\/([A-Za-z0-9]{4,10})/, /ref_([A-Za-z0-9]{4,10})/];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export async function storePendingRef(code: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY, code); } catch {}
}
export async function getPendingRef(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}
export async function clearPendingRef(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}

async function storeIfEmpty(code: string): Promise<void> {
  if (!(await getPendingRef())) await storePendingRef(code);
}

async function captureFromUrl(url: string | null): Promise<void> {
  const code = parseRefFromString(url);
  if (code) await storePendingRef(code); // deep link = intención directa, prevalece
}

/** Android: lee el Install Referrer una sola vez (instalación diferida). */
async function captureInstallReferrerOnce(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(IR_DONE)) return;
    await AsyncStorage.setItem(IR_DONE, "1");
    let mod: any = null;
    try {
      // Carga perezosa: si el módulo nativo no está, no rompe nada.
      mod = require("react-native-play-install-referrer");
    } catch {
      return;
    }
    const PIR = mod?.PlayInstallReferrer ?? mod?.default ?? mod;
    if (!PIR?.getInstallReferrerInfo) return;
    PIR.getInstallReferrerInfo((info: any, err: any) => {
      if (err) return;
      const code = parseRefFromString(info?.installReferrer);
      if (code) void storeIfEmpty(code);
    });
  } catch {}
}

let inited = false;
/** Arranca la captura de referidos (deep links + install referrer). Idempotente. */
export function initReferralCapture(): void {
  if (inited) return;
  inited = true;
  Linking.getInitialURL().then(captureFromUrl).catch(() => {});
  Linking.addEventListener("url", (e) => { void captureFromUrl(e.url); });
  if (Platform.OS === "android") void captureInstallReferrerOnce();
}
