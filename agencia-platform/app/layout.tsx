import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppChrome from "@/components/AppChrome";
import PwaRegister from "@/components/PwaRegister";
import ErrorReporter from "@/components/ErrorReporter";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Hub — Plataforma interna",
    description: "Plataforma interna multifunción",
      manifest: "/manifest.webmanifest",
        appleWebApp: {
            capable: true,
                title: "Hub",
                    statusBarStyle: "default"
                      },
                        icons: {
                            icon: [
                                  { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
                                        { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
                                            ],
                                                apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }]
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
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