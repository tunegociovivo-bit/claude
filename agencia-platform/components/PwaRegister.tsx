"use client";

import { useEffect } from "react";

/**
 * Registra silenciosamente el service worker para que el navegador
 * considere el hub como una PWA instalable (Add to Home Screen / Install
 * App). El SW está en /sw.js y también gestiona push notifications.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // silencioso — si push no está configurado tampoco pasa nada
    });
  }, []);
  return null;
}
