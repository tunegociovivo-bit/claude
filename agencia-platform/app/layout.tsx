import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppChrome from "@/components/AppChrome";
import PwaRegister from "@/components/PwaRegister";
import ErrorReporter from "@/components/ErrorReporter";
import Providers from "@/components/Providers";

// Favicon + icono PWA dinámicos: /api/brand-icon devuelve el logo
// del workspace en vivo, así cuando el admin cambia el logo en
// /admin/workspace, el icono del browser y de la app instalada se
// actualizan solos (TTL 5min server + cache del browser). Fallback
// a /public/icon-192.png si el workspace no tiene logo.
export const metadata: Metadata = {
  title: "Hub — Plataforma interna",
  description: "Plataforma interna multifunción",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // Título debajo del icono al instalar en iOS. Android usa el
    // short_name del manifest.webmanifest (también puesto a "HUB NV").
    title: "HUB NV",
    statusBarStyle: "default"
  },
  icons: {
    icon: [
      { url: "/api/brand-icon?size=192", sizes: "192x192", type: "image/png" },
      { url: "/api/brand-icon?size=512", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/api/brand-icon?size=192", sizes: "192x192", type: "image/png" }],
    shortcut: [{ url: "/api/brand-icon", type: "image/png" }]
  }
};

                                                  export const viewport: Viewport = {
                                                    width: "device-width",
                                                      initialScale: 1,
                                                        maximumScale: 5,
                                                          themeColor: "#5B6CFF"
                                                          };

                                                          /**
 * Script inline que captura `beforeinstallprompt` ANTES de que React
 * hidrate. Chrome dispara este evento al cargar la página (a veces
 * varios segundos antes de que monte PwaRegister); si no lo cogemos
 * a tiempo, lo perdemos para siempre y el botón "Instalar app" nunca
 * aparece. Guardamos el evento en window.__pwaInstallPrompt — el
 * componente PwaRegister lo lee al montar.
 */
const earlyInstallCapture = `
  (function () {
    function onBeforeInstall(e) {
      e.preventDefault();
      window.__pwaInstallPrompt = e;
      window.dispatchEvent(new CustomEvent("pwaInstallPromptReady"));
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", function () {
      window.__pwaInstallPrompt = null;
      window.__pwaInstalled = true;
    });
  })();
`;

/**
 * Detector + auto-unregister del Service Worker viejo.
 *
 * Por qué es necesario: si el user tenía instalado un SW antiguo
 * que cacheaba /_next/static/* con cache-first (v2-v8 de
 * sw.js histórico), su browser sigue sirviendo chunks JS de hace
 * semanas aunque Railway tenga el deploy fresco. El bump de VERSION
 * + skipWaiting NO arregla esto porque la pestaña abierta tiene
 * el JS viejo en RAM hasta que el user cierre todas las pestañas.
 *
 * Este script va INLINE en el <head>, así se ejecuta SIEMPRE en
 * cada navegación, independiente del bundle JS. Compara la versión
 * esperada con la versión del SW activo (via postMessage); si
 * difieren o si el SW activo no responde (= es uno viejo sin el
 * listener GET_VERSION), desregistra TODOS los SWs + limpia caches
 * + recarga la página.
 *
 * Después de la primera ejecución (cuando el user entra tras este
 * deploy), el SW nuevo v9 está activo y no vuelve a recargar.
 *
 * IMPORTANTE: actualizar EXPECTED_VERSION en CADA cambio del sw.js.
 */
const swSelfHeal = `
  (function () {
    var EXPECTED = "v101-2026-05-19-feedback-learn-scrollbar";
    if (!('serviceWorker' in navigator)) return;
    var key = "hub_sw_v_seen";
    var seen = null;
    try { seen = localStorage.getItem(key); } catch (e) {}
    if (seen === EXPECTED) return; // ya estamos al día — no molestar

    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg || !reg.active) {
        // No hay SW todavía → primera visita. Ponemos versión y dejamos
        // que PwaRegister registre el SW v9 normalmente.
        try { localStorage.setItem(key, EXPECTED); } catch (e) {}
        return;
      }
      // Hay SW. Le preguntamos su versión con timeout 1.5s.
      var done = false;
      var ch = new MessageChannel();
      ch.port1.onmessage = function (e) {
        if (done) return; done = true;
        var v = e.data && e.data.version;
        if (v === EXPECTED) {
          try { localStorage.setItem(key, EXPECTED); } catch (e) {}
          return;
        }
        nukeAndReload();
      };
      try {
        reg.active.postMessage({ type: "GET_VERSION" }, [ch.port2]);
      } catch (e) { nukeAndReload(); return; }
      setTimeout(function () {
        if (done) return; done = true;
        // SW viejo sin listener GET_VERSION → nukear.
        nukeAndReload();
      }, 1500);

      function nukeAndReload() {
        console.warn("[pwa] SW desactualizado — limpiando caches y recargando…");
        Promise.resolve()
          .then(function () {
            return navigator.serviceWorker.getRegistrations().then(function (regs) {
              return Promise.all(regs.map(function (r) { return r.unregister(); }));
            });
          })
          .then(function () {
            if ('caches' in window) {
              return caches.keys().then(function (ks) {
                return Promise.all(ks.map(function (k) { return caches.delete(k); }));
              });
            }
          })
          .then(function () {
            try { localStorage.setItem(key, EXPECTED); } catch (e) {}
            // location.reload sin args = obedece HTTP cache; con true es
            // deprecated. Usamos location.replace al mismo URL para forzar
            // navegación limpia.
            location.replace(location.href);
          })
          .catch(function () {
            try { localStorage.setItem(key, EXPECTED); } catch (e) {}
            location.replace(location.href);
          });
      }
    }).catch(function () {});
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/* PRIMER script: auto-heal del SW viejo. Va antes de
            cualquier otro porque puede disparar location.replace()
            y abortar la carga si detecta SW desactualizado. */}
        <script dangerouslySetInnerHTML={{ __html: swSelfHeal }} />
        <script dangerouslySetInnerHTML={{ __html: earlyInstallCapture }} />
      </head>
      <body className="overscroll-none">
        <Providers>
          <AppChrome>{children}</AppChrome>
        </Providers>
        <ErrorReporter />
        <PwaRegister />
      </body>
    </html>
  );
}