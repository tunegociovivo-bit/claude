import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking, Platform } from "react-native";
import { api } from "./api";
import { CheckSession } from "./session";

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

// Readiness del referrer: el alta espera (acotado) a que la captura termine
// antes de concluir que no hay código — evita la carrera captura/registro
// sin bloquear la UX (el fallback IP del servidor sigue de segunda red).
let irSignal: (() => void) | null = null;
const irReady = new Promise<void>((res) => { irSignal = res; });
function signalReferrerDone(): void { try { irSignal?.(); } catch {} irSignal = null; }
export async function waitForReferrerCapture(maxMs = 2500): Promise<void> {
  await Promise.race([irReady, new Promise<void>((res) => setTimeout(res, maxMs))]);
}

// Carga perezosa del módulo nativo, inyectable para poder testear la captura
// (en vitest/ESM no existe require; en la app real Metro sí lo provee).
let pirLoader: () => any = () => require("react-native-play-install-referrer");
export function _setPirLoaderForTests(fn: () => any): void { pirLoader = fn; }

/** Extrae un código de referido (4-10 alfanum.) de una URL o cadena referrer. */
export function parseRefFromString(s: string | null | undefined): string | null {
  if (!s) return null;
  const challenge = /challenge_([A-Za-z0-9]{4,10})_([A-Za-z0-9_-]{8,64})/.exec(s);
  if (challenge) return `${challenge[1].toUpperCase()}|${challenge[2]}`;
  try {
    const url = new URL(s);
    const code = /\/r\/([A-Za-z0-9]{4,10})/.exec(url.pathname)?.[1];
    const offerId = url.searchParams.get("offer");
    if (code && offerId && /^[A-Za-z0-9_-]{8,64}$/.test(offerId)) return `${code.toUpperCase()}|${offerId}`;
  } catch {}
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
  if (!code) return;
  await storePendingRef(code); // deep link = intención directa, prevalece
  signalReferrerDone(); // ya hay código: el alta no necesita esperar más
  // Con sesión ya iniciada, vincula al momento (mismo patrón que los retos).
  try {
    const s = await CheckSession();
    if (s) await applyPendingRef(s.customerId);
  } catch {}
}

/**
 * Reintenta vincular el código pendiente con el cliente ya registrado. El
 * camino normal es enviarlo en verify-otp, pero esa vinculación puede
 * perderse (fallo de red/BD silencioso, o Install Referrer que llega tarde).
 * applyReferral es idempotente en el servidor: llamar de más no duplica.
 * Solo se limpia el pendiente cuando el servidor confirma.
 */
export async function applyPendingRef(customerId: string): Promise<void> {
  const pending = await getPendingRef();
  if (!pending) return;
  const [code, offerId] = pending.split("|", 2);
  try {
    const r = offerId
      ? await api.applyReferral(customerId, code, offerId)
      : await api.applyReferral(customerId, code);
    // Solo limpiamos con un resultado TERMINAL (vinculado y completo, o
    // no-op definitivo: código inválido, autorreferencia, ya referido a
    // otro). Un 2xx transitorio (linked sin cupón aún — no_origin_yet,
    // welcome_offer_failed) CONSERVA el pendiente para que el siguiente
    // reintento repare el cupón.
    if (r?.terminal) await clearPendingRef();
  } catch {
    // se reintentará en la próxima carga del Feed
  }
}

/** Android: lee el Install Referrer (instalación diferida). IR_DONE se marca
 *  SOLO tras una respuesta terminal válida del API de Play — un error
 *  transitorio o el módulo ausente dejan el flag sin poner y se reintenta en
 *  el siguiente arranque (antes se marcaba antes del callback y un fallo
 *  puntual perdía el referrer para siempre). */
async function captureInstallReferrerOnce(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(IR_DONE)) { signalReferrerDone(); return; }
    let mod: any = null;
    try {
      // Carga perezosa: si el módulo nativo no está, no rompe nada (y no
      // marcamos DONE: puede estar disponible en un build posterior).
      mod = pirLoader();
    } catch {
      signalReferrerDone(); // sin módulo no habrá referrer en esta sesión
      return;
    }
    const PIR = mod?.PlayInstallReferrer ?? mod?.default ?? mod;
    if (!PIR?.getInstallReferrerInfo) { signalReferrerDone(); return; }
    PIR.getInstallReferrerInfo((info: any, err: any) => {
      if (err) { signalReferrerDone(); return; } // transitorio → reintento en el próximo arranque
      void AsyncStorage.setItem(IR_DONE, "1").catch(() => {});
      const code = parseRefFromString(info?.installReferrer);
      if (!code) { signalReferrerDone(); return; }
      void (async () => {
        await storeIfEmpty(code);
        signalReferrerDone(); // código ya persistido → el alta puede leerlo
        // Referrer tardío con sesión ya iniciada (o carrera con el alta):
        // aplica al momento en vez de esperar a la próxima carga del Feed.
        try {
          const s = await CheckSession();
          if (s) await applyPendingRef(s.customerId);
        } catch {}
      })();
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
  else signalReferrerDone(); // sin Install Referrer fuera de Android
}
