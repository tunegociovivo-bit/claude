"use client";

/**
 * Banner de instalación PWA de Bipi.
 *
 * - Android/Chrome: captura `beforeinstallprompt` y ofrece botón "Instalar".
 * - iOS Safari: no hay API, muestra instrucciones "Compartir → Añadir a inicio".
 * - Se auto-oculta si ya está en modo standalone (app instalada).
 * - Recuerda el descarte en localStorage (`bipi.installDismissed`) 14 días.
 */

import { useEffect, useState } from "react";

const DISMISS_KEY = "bipi.installDismissed";
const DISMISS_DAYS = 14;

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Ya instalada → no mostrar.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    // Descarte reciente → no mostrar.
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) {
        const until = Number(raw);
        if (Number.isFinite(until) && Date.now() < until) return;
      }
    } catch {}

    const ua = window.navigator.userAgent || "";
    const ios = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua);
    if (ios) {
      setIsIOS(true);
      // En iOS no hay evento; mostramos tras breve delay.
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000));
    } catch {}
  }

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {}
    setDeferred(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-3 pointer-events-none">
      <div className="max-w-md mx-auto pointer-events-auto bipi-card p-4 flex items-center gap-3 shadow-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bipi/icon-192.png" alt="Bipi" className="w-11 h-11 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-black text-sm leading-tight">Instala Bipi en tu móvil</div>
          {isIOS ? (
            <div className="text-[11px] text-black/60 mt-0.5 leading-snug">
              Toca <span className="font-bold">Compartir</span> <span aria-hidden>􀈂</span> y luego{" "}
              <span className="font-bold">Añadir a pantalla de inicio</span>.
            </div>
          ) : (
            <div className="text-[11px] text-black/60 mt-0.5">
              Acceso directo, sin descargas. Cupones siempre a mano.
            </div>
          )}
        </div>
        {isIOS ? (
          <button onClick={dismiss} className="text-xs font-bold text-black/45 px-2 shrink-0">
            Vale
          </button>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={dismiss} className="text-xs font-bold text-black/45 px-2">
              Ahora no
            </button>
            <button onClick={install} className="bipi-btn text-xs px-4 py-2">
              Instalar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
