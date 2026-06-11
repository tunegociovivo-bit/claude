"use client";

/**
 * Layout de las páginas "app" de Bubui (/bubui/app/*).
 *
 * Detecta cuándo la página se muestra EMBEBIDA dentro de la app nativa
 * (WebView) y añade la clase `bubui-embedded` al body, que oculta la
 * cabecera/footer/nav/instalar de la web (ver bubui.css) para no duplicar
 * menús con la navegación nativa de la app. Señales, por orden:
 *   - `window.ReactNativeWebView` (inyectado por react-native-webview),
 *   - `?embed=1` en la URL (lo añade la app; se recuerda en sessionStorage
 *     para las navegaciones internas),
 *   - user-agent de Android System WebView ("; wv)") — cubre APKs antiguos
 *     cuyo WebView no inyecta el bridge.
 */
import { useEffect } from "react";

export default function BubuiAppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      const embedParam = new URLSearchParams(window.location.search).has("embed");
      if (embedParam) sessionStorage.setItem("bubuiEmbed", "1");
      const embedded =
        !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView ||
        embedParam ||
        sessionStorage.getItem("bubuiEmbed") === "1" ||
        /; wv\)/.test(navigator.userAgent);
      if (embedded) document.body.classList.add("bubui-embedded");
    } catch {
      // sessionStorage puede no estar disponible (modo privado estricto).
    }
  }, []);
  return <>{children}</>;
}
