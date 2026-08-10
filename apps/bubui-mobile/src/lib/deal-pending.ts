import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking, Platform } from "react-native";
import { api } from "./api";
import { CheckSession } from "./session";

/**
 * Captura y reclamo de RETOS (custom-deal) para la app nativa.
 *
 * Dos fuentes de captura:
 *  1) Deep link: el cliente abre el reto con la app instalada
 *     (bubui://reto/<token>, https://bubui.app/reto/<token> o ...?deal=<token>).
 *  2) Play Install Referrer (Android): instalación diferida — no tenía la app,
 *     la instala desde Play (con &referrer=reto_<token>) y al primer arranque
 *     recuperamos el token. (iOS no tiene Install Referrer → el cliente vuelve a
 *     pulsar el enlace tras instalar y el deep link lo captura.)
 *
 * Este módulo replica el ENDURECIMIENTO que ya tenía referral-pending.ts y que
 * a este le faltaba (por eso el reto se perdía en la prueba real del 9-ago):
 *   - IR_DONE se marca SOLO tras una respuesta TERMINAL del API de Play; un
 *     error transitorio o el módulo ausente NO lo marcan → se reintenta en el
 *     siguiente arranque (antes se marcaba ANTES del callback y un fallo puntual
 *     perdía el referrer para siempre).
 *   - waitForDealCapture(): el alta espera (acotado) a que la captura termine
 *     antes de concluir que no hay reto → cierra la carrera captura/registro.
 *   - Cargador del módulo nativo inyectable para poder testear la captura.
 */

const KEY = "bubui.pendingDeal";
const IR_DONE = "bubui.installReferrerDealChecked";

// "Token" centinela (16 hex) para eventos de CICLO DE VIDA/diagnóstico que no van
// ligados a un reto concreto (arranque de la app, estado del Install Referrer,
// carga de la fuente de iconos). Permite ver en BubuiDealTrace, consultando este
// bucket, QUÉ build está corriendo de verdad y si el referrer/iconos funcionan.
export const APP_LIFECYCLE_TOKEN = "0000000000000000";

// Suscripción a "reto CAPTURADO" (token guardado). La usa el onboarding para
// REACCIONAR si el Install Referrer llega TARDE (tras el primer render): antes se
// leía el pendiente una sola vez al montar y, si el referrer tardaba más que la
// espera, el onboarding se quedaba con el botón de invitado (reto perdido).
const capturedListeners = new Set<(token: string) => void>();
export function onDealCaptured(fn: (token: string) => void): () => void {
  capturedListeners.add(fn);
  return () => capturedListeners.delete(fn);
}
function notifyDealCaptured(token: string): void {
  capturedListeners.forEach((fn) => { try { fn(token); } catch {} });
}

/** Traza de diagnóstico de ciclo de vida (sin PII), en el bucket centinela. */
export function traceLifecycle(stage: string): void {
  void api.traceDeal(APP_LIFECYCLE_TOKEN, stage);
}

// Readiness de la captura del reto: el alta espera (acotado) a que termine.
let irSignal: (() => void) | null = null;
const irReady = new Promise<void>((res) => { irSignal = res; });
function signalDealCaptureDone(): void { try { irSignal?.(); } catch {} irSignal = null; }
export async function waitForDealCapture(maxMs = 2500): Promise<void> {
  await Promise.race([irReady, new Promise<void>((res) => setTimeout(res, maxMs))]);
}

// Carga perezosa del módulo nativo, inyectable para tests (en vitest/ESM no
// existe require; en la app real Metro sí lo provee).
let pirLoader: () => any = () => require("react-native-play-install-referrer");
export function _setPirLoaderForTests(fn: () => any): void { pirLoader = fn; }

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

async function storeIfEmpty(token: string): Promise<void> {
  if (!(await getPendingDeal())) await storePendingDeal(token);
}

async function captureFromUrl(url: string | null): Promise<void> {
  const token = parseDealFromString(url);
  if (!token) return;
  await storePendingDeal(token); // deep link = intención directa, prevalece
  signalDealCaptureDone(); // ya hay token: el alta no necesita esperar más
  notifyDealCaptured(token); // el onboarding reacciona aunque llegue tarde
  void api.traceDeal(token, "app_capture_deeplink");
  // Reclamo INMEDIATO si ya hay sesión (evita esperar al siguiente arranque).
  try {
    const s = await CheckSession();
    if (s) await claimPendingDeal(s.customerId);
  } catch {}
}

/**
 * Android: lee el Install Referrer (instalación diferida). IR_DONE se marca SOLO
 * tras una respuesta TERMINAL válida del API de Play — un error transitorio o el
 * módulo ausente dejan el flag SIN poner y se reintenta en el siguiente arranque.
 */
async function captureInstallReferrerOnce(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(IR_DONE)) { signalDealCaptureDone(); return; }
    let mod: any = null;
    try {
      mod = pirLoader();
    } catch {
      traceLifecycle("app_ref_no_module"); // el módulo nativo no está en el build
      signalDealCaptureDone(); // sin módulo no habrá referrer en esta sesión
      return;
    }
    const PIR = mod?.PlayInstallReferrer ?? mod?.default ?? mod;
    if (!PIR?.getInstallReferrerInfo) { traceLifecycle("app_ref_no_api"); signalDealCaptureDone(); return; }
    PIR.getInstallReferrerInfo((info: any, err: any) => {
      if (err) { traceLifecycle("app_ref_error"); signalDealCaptureDone(); return; } // transitorio → reintento próximo arranque
      void AsyncStorage.setItem(IR_DONE, "1").catch(() => {});
      const token = parseDealFromString(info?.installReferrer);
      if (!token) {
        // Llegó un referrer pero SIN token de reto (p. ej. instalación orgánica
        // o el enlace no llevaba &referrer=reto_…). Clave para el diagnóstico.
        traceLifecycle("app_ref_no_token");
        signalDealCaptureDone();
        return;
      }
      void (async () => {
        await storeIfEmpty(token);
        signalDealCaptureDone(); // token persistido → el alta puede leerlo
        notifyDealCaptured(token); // el onboarding reacciona aunque sea tardío
        void api.traceDeal(token, "app_capture_install_referrer");
        // Referrer tardío con sesión ya iniciada: aplica al momento.
        try {
          const s = await CheckSession();
          if (s) await claimPendingDeal(s.customerId);
        } catch {}
      })();
    });
  } catch {
    traceLifecycle("app_ref_exception");
    signalDealCaptureDone();
  }
}

let inited = false;
/** Arranca la captura de retos (deep links + install referrer). Idempotente. */
export function initDealCapture(): void {
  if (inited) return;
  inited = true;
  Linking.getInitialURL().then(captureFromUrl).catch(() => {});
  Linking.addEventListener("url", (e) => { void captureFromUrl(e.url); });
  if (Platform.OS === "android") void captureInstallReferrerOnce();
  else signalDealCaptureDone(); // sin Install Referrer fuera de Android
}

/**
 * Suscripción a "reto reclamado": el Feed la usa para recargar las ofertas en
 * cuanto un reclamo termina bien. Devuelve la función de desuscripción.
 */
const claimedListeners = new Set<() => void>();
export function onDealClaimed(fn: () => void): () => void {
  claimedListeners.add(fn);
  return () => claimedListeners.delete(fn);
}

/**
 * Reclama el reto pendiente (si lo hay) para el cliente con sesión. Requiere que
 * el auth ya esté fijado (saveSession/CheckSession lo hacen). Si falla, deja el
 * pendiente para reintentar en el próximo arranque.
 */
export async function claimPendingDeal(customerId: string): Promise<void> {
  const token = await getPendingDeal();
  if (!token) return;
  void api.traceDeal(token, "app_claim_attempt");
  try {
    const res = await api.claimDeal(token, customerId);
    // Solo descartamos el pendiente con CONFIRMACIÓN SEMÁNTICA REAL del servidor
    // (cuerpo ok:true = reto reclamado/ya-mío). Un 2xx sin ok, o cualquier fallo
    // (red/5xx/401/expirado/reclamado-por-otro), CONSERVA el pendiente para
    // reintentar en el próximo arranque; nunca se pierde por un falso positivo.
    if (res?.ok === true) {
      await clearPendingDeal();
      void api.traceDeal(token, "app_claim_ok");
      claimedListeners.forEach((fn) => { try { fn(); } catch {} });
    } else {
      void api.traceDeal(token, "app_claim_retry_later");
    }
  } catch {
    void api.traceDeal(token, "app_claim_retry_later");
    // se reintentará al próximo arranque con sesión
  }
}
