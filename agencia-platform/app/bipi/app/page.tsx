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
  bronze: { label: "Embajador Bronce", emoji: "🥉", color: "bg-orange-100 text-orange-800 border border-orange-300" },
  silver: { label: "Embajador Plata", emoji: "🥈", color: "bg-slate-200 text-slate-800 border border-slate-400" },
  gold: { label: "Embajador Oro", emoji: "🥇", color: "bg-pink-100 text-pink-800 border border-pink-300" },
  founder: { label: "Bipi Founder", emoji: "💎", color: "bg-black text-white border border-black" }
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
      <div className="text-center mb-6 bipi-fade-up">
        <h1 className="bipi-wordmark mx-auto justify-center" style={{ fontSize: 72 }}>bipi</h1>
        <p className="text-black mt-3 text-base font-bold tracking-tight">
          Ahorra. Disfruta. <span style={{ color: "#EC4899" }}>Apoya local.</span>
        </p>
        <p className="text-black/55 text-xs mt-2">Tus descuentos en el barrio. Escanea, ahorra, descubre.</p>
      </div>
      <form onSubmit={submit} className="space-y-3 bipi-card p-6 bipi-fade-up bipi-fade-up-1">
        <input
          type="text"
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bipi-input"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bipi-input"
        />
        {error && <p className="text-rose-700 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="bipi-btn w-full"
        >
          {busy ? "Creando…" : "Entrar a Bipi"}
        </button>
        <p className="text-[11px] text-black/50 text-center pt-2">
          Sin cartera. Sin tarjetas. Sin spam. Los descuentos se aplican directamente cuando escaneas el QR de un negocio Bipi.
        </p>
      </form>
    </main>
  );
}

const CATEGORIES = ["Todo", "Restauración", "Café / Bar", "Belleza", "Tiendas", "Fitness"];

function OffersFeed({ customer, coords, onLogout }: { customer: Customer; coords: { lat: number; lng: number } | null; onLogout: () => void }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushState, setPushState] = useState<"unknown" | "unsupported" | "denied" | "granted" | "loading">("unknown");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todo");

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

  const filtered = offers.filter((o) => {
    if (category !== "Todo" && !o.business.category?.toLowerCase().includes(category.toLowerCase().split(" ")[0])) return false;
    if (query.trim() && !`${o.business.name} ${o.business.category}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <main className="max-w-md mx-auto px-4 py-6 pb-24">
      {/* Header con nombre + ahorrado */}
      <div className="flex items-start justify-between mb-4 bipi-fade-up">
        <div>
          <div className="text-xs text-black/50">Hola{customer.name ? `, ${customer.name}` : ""}</div>
          <div className="mt-1">
            <div className="text-[10px] uppercase tracking-wider text-black/45 font-bold">Has ahorrado</div>
            <div className="bipi-discount-big">{customer.totalSaved.toFixed(2)} €</div>
          </div>
          {customer.ambassadorLevel &&
            customer.ambassadorLevel !== "none" &&
            AMBASSADOR_BADGE[customer.ambassadorLevel] && (
              <div className={"inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold " + AMBASSADOR_BADGE[customer.ambassadorLevel].color}>
                <span>{AMBASSADOR_BADGE[customer.ambassadorLevel].emoji}</span>
                <span>{AMBASSADOR_BADGE[customer.ambassadorLevel].label}</span>
              </div>
            )}
        </div>
        <button onClick={onLogout} className="text-xs text-black/40 hover:text-black/70">
          Salir
        </button>
      </div>

      {/* Search bar */}
      <div className="bipi-search bipi-fade-up bipi-fade-up-1 mb-3">
        <span aria-hidden>🔍</span>
        <input
          type="search"
          placeholder="Buscar negocio o categoría…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Category chips */}
      <div className="bipi-chips bipi-fade-up bipi-fade-up-2 mb-4">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={"bipi-chip" + (category === c ? " active" : "")}
          >
            {c}
          </button>
        ))}
      </div>

      {/* CTA de notificaciones (compactado) */}
      {pushState === "unknown" && (
        <button
          onClick={activatePush}
          className="bipi-btn w-full mb-4 text-sm py-2.5 bipi-fade-up bipi-fade-up-3"
        >
          🔔 Activar avisos de cupones
        </button>
      )}
      {pushState === "denied" && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-pink-50 border border-pink-200 text-xs text-pink-900">
          Has bloqueado las notificaciones. Actívalas en los ajustes del navegador.
        </div>
      )}
      {pushState === "granted" && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-black text-xs text-white">
          ✅ Avisos activos. Te avisaremos cuando tus cupones estén a punto de caducar.
        </div>
      )}

      <h2 className="text-xs font-bold uppercase tracking-wider text-black/50 mb-3">
        Tus cupones activos ({filtered.length})
      </h2>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bipi-skeleton h-44" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bipi-card p-6 text-center text-sm text-black/60">
          {offers.length === 0
            ? "Aún no tienes cupones. Escanea el QR de un negocio Bipi y empieza a desbloquear."
            : "Sin resultados para tu filtro."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o, i) => (
            <div
              key={o.offerId}
              className={"bipi-photo-card bipi-fade-up " + (i < 4 ? `bipi-fade-up-${i + 1}` : "")}
            >
              <div
                className="photo"
                style={
                  o.business.brandColor
                    ? { background: o.business.brandColor }
                    : undefined
                }
              >
                <div className="discount-tag">-{o.discountPct}%</div>
              </div>
              <div className="body">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="name truncate">{o.business.name}</div>
                    <div className="meta truncate">
                      {o.business.category}
                      {o.distanceM != null &&
                        ` · ${o.distanceM > 1000 ? `${(o.distanceM / 1000).toFixed(1)} km` : `${o.distanceM} m`}`}
                    </div>
                  </div>
                  <div className={"text-[11px] font-bold whitespace-nowrap " + (o.hoursLeft < 24 ? "text-pink-600" : "text-black/50")}>
                    ⏰ {o.hoursLeft}h
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 bg-black text-white rounded-2xl p-4 text-sm">
        📲 <strong>Escanea el QR del negocio</strong> donde vayas a pagar. Cada compra te abre 3-5 cupones cerca.
      </div>
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
