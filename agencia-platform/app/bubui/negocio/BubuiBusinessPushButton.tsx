"use client";

import { useEffect, useState } from "react";

type Status = "loading" | "unsupported" | "disabled" | "subscribed" | "unsubscribed" | "blocked" | "working";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Activa/desactiva el Web Push del panel del negocio en ESTE dispositivo.
 * Reutiliza el VAPID de Bubui (mismo endpoint que clientes) y el service worker
 * /sw.js. Avisa al dueño de eventos de valor (cliente nuevo vía Bubui, etc.).
 */
export default function BubuiBusinessPushButton({ businessId, token }: { businessId: string; token: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      try {
        const r = await fetch("/api/bubui/push/vapid-public");
        const d = await r.json();
        if (!d.enabled || !d.key) { setStatus("disabled"); return; }
        setPublicKey(d.key);
        if (Notification.permission === "denied") { setStatus("blocked"); return; }
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const existing = await reg.pushManager.getSubscription();
        setStatus(existing ? "subscribed" : "unsubscribed");
      } catch {
        setStatus("disabled");
      }
    })();
  }, []);

  async function subscribe() {
    if (!publicKey) return;
    setStatus("working");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
      });
      const json = sub.toJSON();
      const r = await fetch(`/api/bubui/business/${businessId}/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscription: { endpoint: json.endpoint, keys: json.keys }, userAgent: navigator.userAgent })
      });
      if (!r.ok) throw new Error("No se pudo registrar");
      setStatus("subscribed");
    } catch {
      setStatus(Notification.permission === "denied" ? "blocked" : "unsubscribed");
    }
  }

  async function unsubscribe() {
    setStatus("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/bubui/business/${businessId}/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus("unsubscribed");
    } catch {
      setStatus("unsubscribed");
    }
  }

  if (status === "loading" || status === "unsupported" || status === "disabled") return null;
  if (status === "blocked") {
    return <p className="text-[11px] text-amber-700">Notificaciones bloqueadas en este navegador. Actívalas en sus ajustes para enterarte de clientes nuevos.</p>;
  }
  if (status === "subscribed") {
    return (
      <button onClick={unsubscribe} className="text-xs font-semibold text-emerald-700 hover:underline">
        🔔 Avisos activados — desactivar
      </button>
    );
  }
  return (
    <button
      onClick={subscribe}
      disabled={status === "working"}
      className="text-xs font-bold text-white bg-pink-600 hover:bg-pink-700 rounded-lg px-3 py-1.5 disabled:opacity-60"
    >
      🔔 Avísame de clientes nuevos
    </button>
  );
}
