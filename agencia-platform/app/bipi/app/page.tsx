"use client";

/**
 * PWA cliente Bipi. Vive en /bipi/app.
 *
 * Funciona como app mobile-first: si no hay sesión, alta rápida; si la hay,
 * muestra el feed de ofertas activas con caducidad. En v2 esto se convierte
 * en app nativa con React Native Expo (misma API).
 */

import { useEffect, useState } from "react";

type Customer = {
  customerId: string;
  name?: string;
  totalSaved: number;
  totalPurchases: number;
  ambassadorLevel?: string;
};

const AMBASSADOR_BADGE: Record<string, { label: string; emoji: string; color: string }> = {
  bronze: { label: "Embajador Bronce", emoji: "🥉", color: "bg-orange-100 text-orange-800 border-orange-300" },
  silver: { label: "Embajador Plata", emoji: "🥈", color: "bg-slate-200 text-slate-800 border-slate-400" },
  gold: { label: "Embajador Oro", emoji: "🥇", color: "bg-amber-100 text-amber-900 border-amber-400" },
  founder: { label: "Bipi Founder", emoji: "💎", color: "bg-violet-100 text-violet-900 border-violet-400" }
};
type Offer = {
  offerId: string;
  business: { id: string; name: string; category: string; city: string; brandColor?: string | null };
  discountPct: number;
  expiresAt: string;
  hoursLeft: number;
  distanceM: number | null;
};

export default function BipiApp() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("bipi.customer");
      if (raw) setCustomer(JSON.parse(raw));
    } catch {}
  }, []);
  // Pide localización al entrar (silenciosa, sin bloqueo).
  useEffect(() => {
    if (!customer) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { timeout: 5000 }
    );
  }, [customer]);

  if (!customer) {
    return <Signup onDone={(c) => { setCustomer(c); localStorage.setItem("bipi.customer", JSON.stringify(c)); }} />;
  }
  return <OffersFeed customer={customer} coords={coords} onLogout={() => { setCustomer(null); localStorage.removeItem("bipi.customer"); }} />;
}

function Signup({ onDone }: { onDone: (c: Customer) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/bipi/customer/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      onDone({ customerId: j.customerId, name: j.name, totalSaved: j.totalSaved ?? 0, totalPurchases: j.totalPurchases ?? 0 });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold"><span className="text-amber-600">bi</span>pi</h1>
        <p className="text-slate-600 text-sm mt-2">Tus descuentos en el barrio. Escanea, ahorra, descubre.</p>
      </div>
      <form onSubmit={submit} className="space-y-3 bg-white border rounded-xl p-5 shadow-sm">
        <input
          type="text"
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg bg-white"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-3 py-2 border rounded-lg bg-white"
        />
        {error && <p className="text-rose-700 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-medium disabled:opacity-50"
        >
          {busy ? "Creando…" : "Entrar a Bipi"}
        </button>
        <p className="text-[11px] text-slate-500 text-center pt-2">
          Sin cartera. Sin tarjetas. Sin spam. Los descuentos se aplican directamente cuando escaneas el QR de un negocio Bipi.
        </p>
      </form>
    </main>
  );
}

function OffersFeed({ customer, coords, onLogout }: { customer: Customer; coords: { lat: number; lng: number } | null; onLogout: () => void }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushState, setPushState] = useState<"unknown" | "unsupported" | "denied" | "granted" | "loading">("unknown");

  // Carga ofertas + refresca perfil (badge embajador, total ahorrado real…)
  useEffect(() => {
    (async () => {
      setLoading(true);
      const url = new URL("/api/bipi/offers", window.location.origin);
      url.searchParams.set("customerId", customer.customerId);
      if (coords) {
        url.searchParams.set("lat", String(coords.lat));
        url.searchParams.set("lng", String(coords.lng));
      }
      try {
        const [offersRes, profileRes] = await Promise.all([
          fetch(url.toString()),
          fetch(`/api/bipi/customer/${customer.customerId}`)
        ]);
        if (offersRes.ok) setOffers((await offersRes.json()).items ?? []);
        if (profileRes.ok) {
          const fresh = await profileRes.json();
          // Persist actualizado en localStorage para los siguientes renders.
          try {
            const merged = { ...customer, ...fresh };
            localStorage.setItem("bipi.customer", JSON.stringify(merged));
          } catch {}
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [customer.customerId, coords]);

  // Estado de push: ¿el navegador soporta?, ¿el cliente ya aceptó?
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
      return;
    }
    if (Notification.permission === "granted") setPushState("granted");
    else if (Notification.permission === "denied") setPushState("denied");
    else setPushState("unknown");
  }, []);

  async function activatePush() {
    setPushState("loading");
    try {
      // 1. Obtener VAPID
      const r = await fetch("/api/bipi/push/vapid-public");
      const cfg = await r.json();
      if (!cfg.enabled || !cfg.key) {
        alert("Las notificaciones aún no están configuradas en el servidor.");
        setPushState("unknown");
        return;
      }
      // 2. Registrar SW
      const reg = await navigator.serviceWorker.register("/bipi-sw.js", { scope: "/bipi/" });
      await navigator.serviceWorker.ready;
      // 3. Pedir permiso
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPushState(perm === "denied" ? "denied" : "unknown");
        return;
      }
      // 4. Suscribir
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.key) as unknown as BufferSource
      });
      // 5. Enviar al backend
      await fetch("/api/bipi/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.customerId,
          subscription: sub.toJSON(),
          userAgent: navigator.userAgent
        })
      });
      setPushState("granted");
    } catch (e: any) {
      console.warn("push activation failed", e);
      setPushState("unknown");
      alert("No se pudieron activar las notificaciones: " + (e?.message ?? "error"));
    }
  }

  return (
    <main className="max-w-md mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-slate-500">Hola{customer.name ? `, ${customer.name}` : ""}</div>
          <div className="font-bold text-lg">Has ahorrado <span className="text-emerald-600">{customer.totalSaved.toFixed(2)} €</span></div>
          {customer.ambassadorLevel && customer.ambassadorLevel !== "none" && AMBASSADOR_BADGE[customer.ambassadorLevel] && (
            <div className={"inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium border " + AMBASSADOR_BADGE[customer.ambassadorLevel].color}>
              <span>{AMBASSADOR_BADGE[customer.ambassadorLevel].emoji}</span>
              <span>{AMBASSADOR_BADGE[customer.ambassadorLevel].label}</span>
            </div>
          )}
        </div>
        <button onClick={onLogout} className="text-xs text-slate-500 hover:underline">Salir</button>
      </div>

      {/* CTA de notificaciones */}
      {pushState === "unknown" && (
        <button
          onClick={activatePush}
          className="w-full mb-4 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium shadow"
        >
          🔔 Activar avisos cuando tus cupones estén a punto de caducar
        </button>
      )}
      {pushState === "denied" && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          Has bloqueado las notificaciones. Ve a los ajustes del navegador para reactivarlas si quieres recibir avisos cuando tus cupones caduquen.
        </div>
      )}
      {pushState === "granted" && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
          ✅ Avisos activos. Te recordaremos cuando tus cupones estén a punto de caducar.
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm">
        📲 <strong>Escanea el QR del negocio</strong> donde vas a pagar para llevarte el descuento. Cada compra te abre 3-5 cupones cerca.
      </div>

      <h2 className="text-sm font-semibold text-slate-700 mb-2">
        Tus cupones activos ({offers.length})
      </h2>
      {loading ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : offers.length === 0 ? (
        <div className="bg-white border rounded-xl p-6 text-center text-sm text-slate-500">
          Aún no tienes cupones. Escanea el QR de un negocio Bipi y empieza a desbloquear.
        </div>
      ) : (
        <div className="space-y-2">
          {offers.map((o) => (
            <div key={o.offerId} className="bg-white border rounded-xl p-4 flex items-center justify-between">
              <div className="flex-1">
                <div className="font-semibold">{o.business.name}</div>
                <div className="text-xs text-slate-500">
                  {o.business.category}
                  {o.distanceM != null && ` · a ${o.distanceM > 1000 ? `${(o.distanceM / 1000).toFixed(1)} km` : `${o.distanceM} m`}`}
                </div>
                <div className={"text-xs mt-1 " + (o.hoursLeft < 24 ? "text-rose-700" : "text-slate-500")}>
                  ⏰ caduca en {o.hoursLeft}h
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-700">{o.discountPct}%</div>
                <div className="text-[10px] text-slate-500 uppercase">descuento</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

/** Convierte la VAPID public key (URL-safe base64) a Uint8Array como
 *  pide PushManager.subscribe. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = typeof window !== "undefined" ? window.atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
