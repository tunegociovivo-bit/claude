"use client";

/**
 * Redirección del enlace de invitación. Separada en cliente para que la página
 * (server) pueda generar metadata OG (preview rico en WhatsApp).
 *
 * Estrategia de atribución por plataforma:
 *  - Móvil con la app instalada → abre la app vía deep link (bubui://r/<code>),
 *    que captura el código y lo vincula al alta.
 *  - Android sin la app → Play Store con &referrer=ref_<code>; al instalar, el
 *    Install Referrer recupera el código (atribución diferida).
 *  - iOS sin app / escritorio → PWA (/bubui/app?ref=<code>), que ya atribuye.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ANDROID_PACKAGE = "com.negociovivo.bubui";

export default function ReferralRedirect({ code }: { code: string }) {
  const router = useRouter();
  useEffect(() => {
    try {
      if (code) localStorage.setItem("bubui.ref", code);
    } catch {}

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isAndroid = /android/i.test(ua);
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isMobile = isAndroid || isIOS;
    const pwa = `/bubui/app?ref=${encodeURIComponent(code ?? "")}`;

    if (!isMobile || !code) {
      router.replace(pwa);
      return;
    }

    // Intenta abrir la app instalada con el código.
    const deepLink = `bubui://r/${encodeURIComponent(code)}`;
    const playStore = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&referrer=${encodeURIComponent(`ref_${code}`)}`;

    // Si la app abre, la pestaña se oculta → cancelamos el fallback.
    let cancelled = false;
    const onHide = () => { if (document.hidden) cancelled = true; };
    document.addEventListener("visibilitychange", onHide);

    const fallback = setTimeout(() => {
      if (cancelled) return;
      if (isAndroid) window.location.href = playStore; // sin app → Play (con referrer)
      else router.replace(pwa); // iOS sin app → PWA
    }, 1300);

    try { window.location.href = deepLink; } catch {}

    return () => {
      clearTimeout(fallback);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [code, router]);

  return null;
}
