"use client";

import { useEffect, useState } from "react";
import { CloudOff, Download, RefreshCw, X } from "lucide-react";

/**
 * Registra el service worker y monta una mini UI de estado offline:
 *  - Banner cuando el navegador pierde conexión.
 *  - Notificación cuando una mutación se ha encolado para reenviar
 *    al recuperar la conexión.
 *  - Botón "Instalar app":
 *      a) Si el navegador disparó beforeinstallprompt (Chrome/Edge,
 *         capturado en layout.tsx via script inline), pulsa para
 *         abrir el diálogo nativo.
 *      b) Si NO se capturó pero estamos en móvil y la app no está
 *         ya instalada, mostramos un botón con instrucciones
 *         manuales (⋮ → "Instalar aplicación" o "Añadir a pantalla
 *         de inicio") que es lo que sucede en muchos Androids que
 *         no cumplen el "engagement heuristic" de Chrome.
 *  - iOS Safari nunca dispara el evento → instrucciones específicas.
 */
declare global {
  interface Window {
    __pwaInstallPrompt?: any;
    __pwaInstalled?: boolean;
  }
}

type Platform = "android" | "ios" | "desktop" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac|Win|Linux/.test(ua)) return "desktop";
  return "other";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    Boolean((navigator as any).standalone)
  );
}

export default function PwaRegister() {
  const [online, setOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [flushedRecent, setFlushedRecent] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [dismissedManual, setDismissedManual] = useState(false);
  // Ventana temporal: el CTA de instalar solo se muestra los primeros
  // 10s tras cargar la web. Pasado ese tiempo desaparece para no
  // estorbar (el user que quiera instalar lo hace al entrar; el resto
  // no quiere el botón ahí permanentemente).
  const [withinInstallWindow, setWithinInstallWindow] = useState(true);
  // Embebido dentro de una app nativa (WebView, p. ej. la pestaña Mapa de la
  // app Bubui): ahí NO ofrecemos "Instalar app" (ya está instalada como app
  // nativa y duplicaría controles). Detección por el bridge de
  // react-native-webview, el user-agent de Android System WebView, el
  // parámetro ?embed=1 o la clase bubui-embedded.
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    try {
      const ua = navigator.userAgent || "";
      const emb =
        !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView ||
        /; wv\)/.test(ua) ||
        new URLSearchParams(window.location.search).has("embed") ||
        sessionStorage.getItem("bubuiEmbed") === "1" ||
        document.body.classList.contains("bubui-embedded") ||
        // Nunca ofrecer "Instalar app" en ninguna página de Bubui: estorba en la
        // conversión. Cubre AMBOS casos: el dominio propio bubui.app (donde la
        // ruta es /reto, /app… sin prefijo) y hub.negociovivo.app/bubui/…
        /(^|\.)bubui\./i.test(window.location.hostname) ||
        window.location.pathname.startsWith("/bubui");
      setEmbedded(emb);
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setWithinInstallWindow(false), 10_000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOnline(navigator.onLine);
    setPlatform(detectPlatform());
    setInstalled(isStandalone() || Boolean(window.__pwaInstalled));

    // El script inline en layout.tsx ya capturó beforeinstallprompt
    // si se disparó antes de hidratar. Lo leemos aquí y nos
    // suscribimos al CustomEvent para los disparos que ocurran
    // DESPUÉS de hidratar.
    if (window.__pwaInstallPrompt) {
      setInstallPrompt(window.__pwaInstallPrompt);
    }

    // Recordamos si el user cerró el banner manual para no insistir.
    try {
      const dismissed = localStorage.getItem("pwa-install-dismissed");
      if (dismissed) setDismissedManual(true);
    } catch {}

    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});

    // CRÍTICO: cuando se publica una versión nueva del SW (cambia
    // VERSION en sw.js), el nuevo se instala + activa con
    // skipWaiting()+clients.claim(). En ese momento se dispara
    // controllerchange en TODOS los clientes (pestañas) controlados.
    // Si no recargamos, la pestaña sigue viendo el JS/HTML viejo en
    // RAM y los cambios visuales no aparecen aunque el deploy haya
    // ido bien.
    //
    // Guard `swControllerChangeHandled` para evitar bucles si por
    // alguna razón el evento se dispara varias veces.
    let reloadScheduled = false;
    function onControllerChange() {
      if (reloadScheduled) return;
      reloadScheduled = true;
      // Pequeño delay para no recargar a mitad de una mutación del user.
      // Es un trade-off: si está editando algo se pierde, pero el JS
      // viejo dejaría de funcionar pronto de todos modos. 500ms le da
      // tiempo a Save in flight a llegar a red antes de recargar.
      console.log("[pwa] nuevo Service Worker activo — recargando la página…");
      setTimeout(() => window.location.reload(), 500);
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    function onOnline() {
      setOnline(true);
      navigator.serviceWorker.controller?.postMessage({ type: "FLUSH_QUEUE" });
    }
    function onOffline() {
      setOnline(false);
    }
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "queued") setQueuedCount((n) => n + 1);
      if (e.data?.type === "flushed") {
        setQueuedCount((n) => Math.max(0, n - 1));
        setFlushedRecent(true);
        setTimeout(() => setFlushedRecent(false), 3000);
      }
    }
    function onBeforeInstall(e: any) {
      e.preventDefault();
      setInstallPrompt(e);
    }
    function onInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
    }
    function onEarlyPromptReady() {
      if (window.__pwaInstallPrompt) setInstallPrompt(window.__pwaInstallPrompt);
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    navigator.serviceWorker.addEventListener("message", onMessage);
    window.addEventListener("beforeinstallprompt", onBeforeInstall as any);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("pwaInstallPromptReady", onEarlyPromptReady);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall as any);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("pwaInstallPromptReady", onEarlyPromptReady);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstallPrompt(null);
  }

  function dismiss() {
    setDismissedManual(true);
    try {
      localStorage.setItem("pwa-install-dismissed", String(Date.now()));
    } catch {}
  }

  // ¿Mostramos algún CTA de instalación?
  // SOLO en móvil (android/ios) y SOLO durante los primeros 10s tras
  // cargar — en escritorio no tiene sentido (instalar PWA en desktop
  // no aporta para este uso) y permanentemente molesta.
  const isMobile = platform === "android" || platform === "ios";
  const showNative = !!installPrompt && !installed && isMobile && withinInstallWindow && !embedded;
  const showManual =
    !installPrompt &&
    !installed &&
    !dismissedManual &&
    isMobile &&
    withinInstallWindow &&
    !embedded;

  return (
    <>
      {/* Banner offline */}
      {!online && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] bg-amber-100 border border-amber-300 text-amber-900 rounded-full shadow-lg px-4 py-2 text-xs inline-flex items-center gap-2">
          <CloudOff className="h-3.5 w-3.5" />
          Sin conexión.{" "}
          {queuedCount > 0 && (
            <span>
              {queuedCount} cambio{queuedCount === 1 ? "" : "s"} pendiente
              {queuedCount === 1 ? "" : "s"}.
            </span>
          )}
        </div>
      )}

      {/* Aviso "guardado y sincronizando" */}
      {online && flushedRecent && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-full shadow-lg px-4 py-2 text-xs inline-flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Cambios sincronizados.
        </div>
      )}

      {/* Botón nativo (Chrome / Edge / Android) — diálogo del sistema */}
      {showNative && (
        <button
          type="button"
          onClick={install}
          className="fixed bottom-4 right-4 z-[70] inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-xs shadow-lg"
        >
          <Download className="h-3.5 w-3.5" />
          Instalar app
        </button>
      )}

      {/* Botón manual con instrucciones — fallback cuando Chrome no
          dispara beforeinstallprompt (engagement bajo, ya rechazado
          antes, in-app browser…) o cuando estás en iOS Safari */}
      {showManual && (
        <button
          type="button"
          onClick={() => setShowManualGuide(true)}
          className="fixed bottom-4 right-4 z-[70] inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-xs shadow-lg"
        >
          <Download className="h-3.5 w-3.5" />
          Instalar app
        </button>
      )}

      {/* Modal con instrucciones manuales */}
      {showManualGuide && (
        <div
          className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4"
          onClick={() => setShowManualGuide(false)}
        >
          <div
            className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <Download className="h-5 w-5 text-brand-600" />
              <h3 className="font-semibold text-slate-900 flex-1">Instalar Hub en tu móvil</h3>
              <button onClick={() => setShowManualGuide(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="h-4 w-4" />
              </button>
            </div>

            {platform === "android" && (
              <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside">
                <li>
                  Pulsa el icono de menú <code className="px-1 py-0.5 bg-slate-100 rounded">⋮</code> arriba a la derecha de Chrome.
                </li>
                <li>
                  Elige <strong>"Instalar aplicación"</strong> (a veces aparece como "Añadir a pantalla de inicio").
                </li>
                <li>Confirma. El icono de Hub queda en tu lanzador como una app más.</li>
              </ol>
            )}

            {platform === "ios" && (
              <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside">
                <li>
                  Asegúrate de estar en <strong>Safari</strong> (no funciona en Chrome iOS).
                </li>
                <li>
                  Pulsa el icono <strong>Compartir</strong> (cuadrado con flecha hacia arriba) en la parte inferior.
                </li>
                <li>
                  Desplázate y elige <strong>"Añadir a pantalla de inicio"</strong>.
                </li>
                <li>Confirma "Añadir". Hub aparecerá como una app más.</li>
              </ol>
            )}

            <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <strong>¿No te aparece la opción?</strong> Es posible que Chrome haya recordado un "No instalar" anterior. Borra los datos del sitio en Ajustes de Chrome → Sitios → hub.negociovivo.app, y vuelve a abrir esta pantalla.
            </div>

            <button
              onClick={() => {
                dismiss();
                setShowManualGuide(false);
              }}
              className="mt-4 w-full text-xs text-slate-500 hover:text-slate-700 py-2"
            >
              No volver a mostrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
