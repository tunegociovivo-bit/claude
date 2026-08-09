"use client";

/**
 * Acción del enlace de invitación (/bubui/r/<code>).
 *
 * ANTES: redirección automática por JS (deep link → timeout → Play). Dentro
 * del navegador de WhatsApp, el intento de deep link podía disparar
 * visibilitychange y CANCELAR el fallback → el amigo se quedaba en una
 * página muerta e instalaba la app a mano, SIN atribución. Por eso el nivel
 * cliente→amigos perdía referidos.
 *
 * AHORA (mismo patrón que /reto, que funciona):
 *  1. Al cargar: registra el clic en el servidor (atribución de reserva por
 *     IP — funciona aunque TODO lo demás falle) y guarda el código en
 *     localStorage (atribución PWA).
 *  2. Intenta abrir la app instalada UNA vez; si la página sigue visible,
 *     muestra BOTONES explícitos: "Instalar en Google Play" es un enlace
 *     real con &referrer= (clic del usuario = atribución fiable) y "Ya
 *     tengo la app" reintenta el deep link.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ANDROID_PACKAGE = "com.negociovivo.bubui";

export default function ReferralRedirect({ code }: { code: string }) {
  const router = useRouter();
  const [os, setOs] = useState<"android" | "ios" | "other">("other");
  const [triedApp, setTriedApp] = useState(false);

  const deepLink = `bubui://r/${encodeURIComponent(code)}`;
  const playStore = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&referrer=${encodeURIComponent(`ref_${code}`)}`;
  const pwa = `/bubui/app?ref=${encodeURIComponent(code ?? "")}`;

  function tryOpenApp() {
    setTriedApp(false);
    let opened = false;
    const onHide = () => { if (document.hidden) opened = true; };
    document.addEventListener("visibilitychange", onHide);
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onHide);
      if (!opened && !document.hidden) setTriedApp(true); // sin app → botones
    }, 1500);
    try { window.location.href = deepLink; } catch { setTriedApp(true); }
  }

  useEffect(() => {
    if (!code) { router.replace(pwa); return; }
    try { localStorage.setItem("bubui.ref", code); } catch {}
    // Atribución de reserva por IP: aunque el amigo acabe instalando la app
    // a mano desde Play, el registro lo vinculará igual.
    fetch("/api/bubui/referral-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    }).catch(() => {});

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isAndroid = /android/i.test(ua);
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    if (!isAndroid && !isIOS) { router.replace(pwa); return; } // escritorio → PWA
    setOs(isAndroid ? "android" : "ios");
    tryOpenApp(); // con la app instalada, entra directo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!triedApp) return null; // abriendo la app / esperando el intento

  return (
    <div className="mt-8 space-y-3">
      {os === "android" ? (
        <a href={playStore} className="bubui-btn w-full inline-flex justify-center">
          ⬇️ Instalar en Android (Google Play)
        </a>
      ) : (
        <button onClick={() => router.replace(pwa)} className="bubui-btn w-full">
          🎁 Conseguir mi cupón
        </button>
      )}
      <button
        onClick={tryOpenApp}
        className="w-full text-sm font-semibold text-pink-600 py-2"
      >
        ↻ Ya tengo la app — abrirla
      </button>
      <p className="text-[12px] text-black/45 leading-snug">
        Instala Bubui gratis y tu cupón de bienvenida se activará solo al registrarte.
      </p>
    </div>
  );
}
