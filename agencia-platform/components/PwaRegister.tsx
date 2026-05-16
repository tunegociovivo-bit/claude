"use client";

import { useEffect, useState } from "react";
import { CloudOff, Download, RefreshCw } from "lucide-react";

/**
 * Registra el service worker y monta una mini UI de estado offline:
 *  - Banner cuando el navegador pierde conexión.
 *  - Notificación cuando una mutación se ha encolado para reenviar
 *    al recuperar la conexión.
 *  - Botón "Instalar app" cuando el navegador dispara
 *    beforeinstallprompt (Chrome/Edge en desktop y Android). En iOS
 *    Safari no dispara el evento; mostramos un hint distinto si el
 *    user-agent es iOS y la app no está en standalone.
 */
export default function PwaRegister() {
  const [online, setOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [flushedRecent, setFlushedRecent] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOnline(navigator.onLine);
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});

    function onOnline() {
      setOnline(true);
      // Pedimos al SW que vacíe la cola al volver la conexión.
      navigator.serviceWorker.controller?.postMessage({ type: "FLUSH_QUEUE" });
    }
    function onOffline() {
      setOnline(false);
    }
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "queued") {
        setQueuedCount((n) => n + 1);
      }
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

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    navigator.serviceWorker.addEventListener("message", onMessage);
    window.addEventListener("beforeinstallprompt", onBeforeInstall as any);
    window.addEventListener("appinstalled", onInstalled);

    // Detectar iOS no-standalone para enseñar el hint manual de
    // "compartir → añadir a la pantalla de inicio".
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone =
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as any).standalone;
    if (isIos && !isStandalone) setIosHint(true);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall as any);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstallPrompt(null);
  }

  return (
    <>
      {/* Banner offline */}
      {!online && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] bg-amber-100 border border-amber-300 text-amber-900 rounded-full shadow-lg px-4 py-2 text-xs inline-flex items-center gap-2">
          <CloudOff className="h-3.5 w-3.5" />
          Sin conexión. {queuedCount > 0 && <span>{queuedCount} cambio{queuedCount === 1 ? "" : "s"} pendiente{queuedCount === 1 ? "" : "s"}.</span>}
        </div>
      )}
      {/* Aviso "guardado y sincronizando" */}
      {online && flushedRecent && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-full shadow-lg px-4 py-2 text-xs inline-flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Cambios sincronizados.
        </div>
      )}
      {/* Botón instalar */}
      {installPrompt && !installed && (
        <button
          type="button"
          onClick={install}
          className="fixed bottom-4 right-4 z-[70] inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-xs shadow-lg"
        >
          <Download className="h-3.5 w-3.5" />
          Instalar app
        </button>
      )}
      {iosHint && (
        <details className="fixed bottom-4 right-4 z-[70] bg-white border rounded-lg shadow-lg max-w-[260px]">
          <summary className="cursor-pointer px-3 py-2 text-xs text-slate-700 list-none flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Instalar en iPhone
          </summary>
          <div className="px-3 pb-3 text-[11px] text-slate-600">
            En Safari: pulsa el botón Compartir y elige <strong>Añadir a pantalla de inicio</strong>. La app se abrirá sin barra de navegador.
          </div>
        </details>
      )}
    </>
  );
}
