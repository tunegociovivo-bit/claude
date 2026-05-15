"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";

type Status = "loading" | "unsupported" | "disabled" | "subscribed" | "unsubscribed" | "blocked" | "subscribing";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushSubscribeButton() {
  const [status, setStatus] = useState<Status>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      try {
        const r = await fetch("/api/v1/notifications/push");
        if (!r.ok) {
          setStatus("disabled");
          return;
        }
        const d = await r.json();
        if (!d.enabled) {
          setStatus("disabled");
          return;
        }
        setPublicKey(d.publicKey);
        if (Notification.permission === "denied") {
          setStatus("blocked");
          return;
        }
        // Comprobar si ya hay subscription registrada en este navegador
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const existing = await reg.pushManager.getSubscription();
        if (existing && d.subscribed) {
          setStatus("subscribed");
        } else {
          setStatus("unsubscribed");
        }
      } catch (e: any) {
        setError(e.message);
        setStatus("disabled");
      }
    })();
  }, []);

  async function subscribe() {
    if (!publicKey) return;
    setStatus("subscribing");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
      });
      const json = sub.toJSON();
      const r = await fetch("/api/v1/notifications/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent
        })
      });
      if (!r.ok) throw new Error("No se pudo registrar la suscripción");
      setStatus("subscribed");
    } catch (e: any) {
      setError(e.message ?? String(e));
      setStatus(Notification.permission === "denied" ? "blocked" : "unsubscribed");
    }
  }

  async function unsubscribe() {
    setStatus("subscribing");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/v1/notifications/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE"
        });
        await sub.unsubscribe();
      }
      setStatus("unsubscribed");
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  if (status === "loading") {
    return (
      <button
        disabled
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border bg-slate-50 text-slate-400"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando…
      </button>
    );
  }
  if (status === "unsupported") {
    return (
      <span className="text-xs text-slate-500 italic px-3 py-2">
        Tu navegador no soporta notificaciones push.
      </span>
    );
  }
  if (status === "disabled") {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg"
        title="VAPID no configurado en el servidor"
      >
        <BellOff className="h-4 w-4" />
        Push no disponible (sin configurar)
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg">
        <BellOff className="h-4 w-4" />
        Notificaciones bloqueadas. Habilítalas en la configuración del navegador.
      </span>
    );
  }
  if (status === "subscribed") {
    return (
      <button
        onClick={unsubscribe}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100"
      >
        <BellRing className="h-4 w-4" />
        Push activado — Desactivar
      </button>
    );
  }
  if (status === "subscribing") {
    return (
      <button
        disabled
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border bg-slate-50 text-slate-400"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Procesando…
      </button>
    );
  }
  return (
    <>
      <button
        onClick={subscribe}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-brand-600 hover:bg-brand-700 text-white"
      >
        <Bell className="h-4 w-4" />
        Activar notificaciones en este dispositivo
      </button>
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </>
  );
}
