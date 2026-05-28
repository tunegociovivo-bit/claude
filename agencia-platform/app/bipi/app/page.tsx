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
  rewardLabel?: string | null;
  expiresAt: string;
  hoursLeft: number;
  distanceM: number | null;
};

export default function BipiApp() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // null = aún cargando localStorage; false = onboarded ya hecho; true = mostrar
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("bipi.customer");
      if (raw) setCustomer(JSON.parse(raw));
      const onboarded = localStorage.getItem("bipi.onboarded") === "1";
      setShowOnboarding(!raw && !onboarded);
      // Código de referido: ?ref= o el guardado por /bipi/r/<code>.
      const urlRef = new URLSearchParams(window.location.search).get("ref");
      const stored = localStorage.getItem("bipi.ref");
      const r = urlRef || stored;
      if (r) { setRef(r); localStorage.setItem("bipi.ref", r); }
    } catch {
      setShowOnboarding(false);
    }
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

  if (showOnboarding === null) return null; // SSR / mientras carga

  if (showOnboarding) {
    return (
      <Onboarding
        onDone={() => {
          try { localStorage.setItem("bipi.onboarded", "1"); } catch {}
          setShowOnboarding(false);
        }}
      />
    );
  }

  if (!customer) {
    return <Signup refCode={ref} onDone={(c) => { setCustomer(c); localStorage.setItem("bipi.customer", JSON.stringify(c)); try { localStorage.removeItem("bipi.ref"); } catch {} }} />;
  }
  return <OffersFeed customer={customer} coords={coords} onLogout={() => { setCustomer(null); localStorage.removeItem("bipi.customer"); }} />;
}

/** Onboarding · 3 slides con dots + Saltar + Siguiente/Empezar.
 *  Sólo se muestra una vez por navegador (localStorage `bipi.onboarded`). */
function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const slides = [
    {
      visual: (
        <div className="relative h-44 w-full grid place-items-center">
          <div className="absolute bipi-fade-up bipi-fade-up-1" style={{ transform: "translate(-46px, 10px) rotate(-8deg)" }}>
            <CouponCard color="#FCE7F3" pct={5} label="Café" />
          </div>
          <div className="absolute bipi-fade-up bipi-fade-up-2" style={{ transform: "translate(0, -8px)" }}>
            <CouponCard color="#FBCFE8" pct={10} label="Restaurante" highlight />
          </div>
          <div className="absolute bipi-fade-up bipi-fade-up-3" style={{ transform: "translate(46px, 10px) rotate(8deg)" }}>
            <CouponCard color="#F9A8D4" pct={8} label="Estética" />
          </div>
        </div>
      ),
      title: "Cada compra te abre descuentos cerca",
      body: "Escaneas el QR del negocio al pagar y se te abren 3-5 cupones en otros negocios del barrio."
    },
    {
      visual: (
        <div className="h-44 grid place-items-center">
          <div className="bipi-card p-5 text-left space-y-2 w-64 bipi-fade-up">
            <CheckLine>Sin cartera ni saldo</CheckLine>
            <CheckLine>Sin puntos que no canjeas</CheckLine>
            <CheckLine>Sin spam ni emails raros</CheckLine>
            <CheckLine>Sin tarjetas físicas</CheckLine>
          </div>
        </div>
      ),
      title: "Limpio. Directo. Sin trucos.",
      body: "El descuento se aplica cuando el negocio confirma tu compra. Punto."
    },
    {
      visual: (
        <div className="h-44 grid place-items-center">
          <div className="text-7xl bipi-fade-up">💖</div>
          <div className="absolute mt-32 text-[10px] uppercase tracking-widest text-black/55 font-bold">
            Piloto · Benalmádena
          </div>
        </div>
      ),
      title: "Apoya el comercio del barrio",
      body: "Cada euro que gastas en Bipi se queda en tu barrio. Negocios locales, no cadenas."
    }
  ];

  const cur = slides[step];
  const isLast = step === slides.length - 1;

  return (
    <main className="max-w-md mx-auto px-4 py-10 min-h-screen flex flex-col">
      <div className="flex items-center justify-between mb-8">
        <h1 className="bipi-wordmark" style={{ fontSize: 36 }}>bipi</h1>
        <button
          onClick={onDone}
          className="text-xs text-black/55 hover:text-black/80 font-semibold"
        >
          Saltar
        </button>
      </div>

      <div key={step} className="flex-1 flex flex-col justify-center text-center bipi-fade-up">
        <div className="mb-8">{cur.visual}</div>
        <h2 className="text-2xl font-black tracking-tight text-black px-4">{cur.title}</h2>
        <p className="text-black/60 text-sm mt-3 px-6 leading-relaxed">{cur.body}</p>
      </div>

      <div className="mt-8 space-y-4">
        {/* Dots */}
        <div className="flex items-center justify-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Slide ${i + 1}`}
              className="transition-all"
              style={{
                width: i === step ? 24 : 8,
                height: 8,
                borderRadius: 999,
                background: i === step ? "#EC4899" : "rgba(0,0,0,0.15)"
              }}
            />
          ))}
        </div>
        <button
          onClick={() => (isLast ? onDone() : setStep(step + 1))}
          className="bipi-btn w-full"
        >
          {isLast ? "Empezar" : "Siguiente"}
        </button>
      </div>
    </main>
  );
}

function CouponCard({ color, pct, label, highlight }: { color: string; pct: number; label: string; highlight?: boolean }) {
  return (
    <div
      className={"rounded-2xl px-5 py-3 shadow-lg " + (highlight ? "ring-2 ring-pink-500" : "")}
      style={{ background: color, minWidth: 130 }}
    >
      <div className="font-black text-2xl text-black leading-none">-{pct}%</div>
      <div className="text-[10px] uppercase tracking-wider text-black/65 font-bold mt-1">{label}</div>
    </div>
  );
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-black">
      <div className="w-5 h-5 rounded-full bg-pink-500 grid place-items-center text-white text-[11px] font-black">✓</div>
      <span>{children}</span>
    </div>
  );
}

function Signup({ onDone, refCode }: { onDone: (c: Customer) => void; refCode?: string | null }) {
  // step "form": nombre + teléfono (+ email opcional) → enviar código.
  // step "code": introducir el código SMS → verificar y entrar.
  const [step, setStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Pon tu nombre"); return; }
    if (!email.trim()) { setError("El email es obligatorio"); return; }
    if (!birthDate) { setError("Indica tu fecha de nacimiento"); return; }
    if (!gender) { setError("Indica tu sexo"); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/bipi/customer/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error?.message ?? `Error ${r.status}`); return; }
      setStep("code");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/bipi/customer/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, name, email, birthDate, gender, ref: refCode || undefined })
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error?.message ?? `Error ${r.status}`); return; }
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
        <p className="text-black/55 text-xs mt-2">Crea tu cuenta verificando tu teléfono.</p>
      </div>

      {step === "form" ? (
        <form onSubmit={sendCode} className="space-y-3 bipi-card p-6 bipi-fade-up bipi-fade-up-1">
          <input
            type="text"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bipi-input"
          />
          <input
            type="tel"
            inputMode="tel"
            placeholder="Teléfono móvil (ej: 600 11 12 22)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
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
          <label className="block text-xs font-semibold text-black/55">
            Fecha de nacimiento
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
              max={new Date().toISOString().slice(0, 10)}
              className="bipi-input mt-1"
            />
          </label>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            required
            className="bipi-input"
          >
            <option value="">Sexo…</option>
            <option value="female">Mujer</option>
            <option value="male">Hombre</option>
            <option value="other">Otro</option>
            <option value="prefer_not">Prefiero no decirlo</option>
          </select>
          {error && <p className="text-rose-700 text-sm">{error}</p>}
          <button type="submit" disabled={busy} className="bipi-btn w-full">
            {busy ? "Enviando…" : "Enviar código SMS"}
          </button>
          <p className="text-[11px] text-black/50 text-center pt-2">
            Te enviaremos un SMS con un código para verificar tu número. Sin cartera, sin tarjetas, sin spam.
          </p>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3 bipi-card p-6 bipi-fade-up bipi-fade-up-1">
          <p className="text-sm text-black/70">
            Introduce el código que enviamos por SMS a <strong>{phone}</strong>.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="● ● ● ● ● ●"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            autoFocus
            className="bipi-input text-center text-2xl tracking-[0.4em] font-bold"
          />
          {error && <p className="text-rose-700 text-sm">{error}</p>}
          <button type="submit" disabled={busy || code.length < 4} className="bipi-btn w-full">
            {busy ? "Verificando…" : "Verificar y entrar"}
          </button>
          <button
            type="button"
            onClick={() => { setStep("form"); setCode(""); setError(null); }}
            className="w-full text-xs text-black/50 hover:text-black/80"
          >
            ← Cambiar número o reenviar
          </button>
        </form>
      )}
    </main>
  );
}

function OffersFeed({ customer, coords, onLogout }: { customer: Customer; coords: { lat: number; lng: number } | null; onLogout: () => void }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushState, setPushState] = useState<"unknown" | "unsupported" | "denied" | "granted" | "loading">("unknown");
  const [savings, setSavings] = useState<{ id: string; discountPct: number; discountAmount: number; businessName: string; date: string }[]>([]);
  const [totalSaved, setTotalSaved] = useState(customer.totalSaved ?? 0);

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
          if (Array.isArray(fresh.savings)) setSavings(fresh.savings);
          if (typeof fresh.totalSaved === "number") setTotalSaved(fresh.totalSaved);
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
    <main className="max-w-md mx-auto px-4 py-6 pb-24">
      {/* Header: logo + salir */}
      <div className="flex items-center justify-between mb-4 bipi-fade-up">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bipi/logo.png" alt="bipi" style={{ height: 26, width: "auto" }} />
        <button onClick={onLogout} className="text-xs text-black/45 hover:text-black/70 font-semibold">
          Salir
        </button>
      </div>

      {/* Tarjeta Has ahorrado + historial */}
      <div className="bipi-card p-5 mb-4 bipi-fade-up bipi-fade-up-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-black/45 font-bold">Has ahorrado</div>
            <div className="bipi-discount-big">{totalSaved.toFixed(2)} €</div>
            {customer.ambassadorLevel &&
              customer.ambassadorLevel !== "none" &&
              AMBASSADOR_BADGE[customer.ambassadorLevel] && (
                <div className={"inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold " + AMBASSADOR_BADGE[customer.ambassadorLevel].color}>
                  <span>{AMBASSADOR_BADGE[customer.ambassadorLevel].emoji}</span>
                  <span>{AMBASSADOR_BADGE[customer.ambassadorLevel].label}</span>
                </div>
              )}
          </div>
          <div className="text-4xl" aria-hidden>🐷</div>
        </div>

        {savings.length > 0 ? (
          <div className="mt-4 pt-4 border-t border-black/5 space-y-2">
            {savings.slice(0, 4).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-black/75 truncate">
                  <span className="font-bold text-pink-600">{s.discountPct}%</span> en {s.businessName}
                </span>
                <span className="text-xs text-black/45 whitespace-nowrap ml-2">
                  {new Date(s.date).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })} · {s.discountAmount.toFixed(2)} €
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 pt-4 border-t border-black/5 text-xs text-black/55">
            Aún no has ahorrado. En tu próxima compra, escanea el QR del negocio y verás aquí tu ahorro 🎉
          </div>
        )}
      </div>

      {/* Botón escanear QR — con animación de atención */}
      <button
        onClick={() => alert("Abre la cámara de tu móvil y escanea el QR del negocio Bipi para llevarte el descuento.")}
        className="bipi-btn bipi-attention w-full mb-5 py-4 text-base bipi-fade-up bipi-fade-up-2"
      >
        <span aria-hidden>⛶</span> Escanear QR de un negocio
      </button>

      {/* Banner promocional */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/bipi/promo.png"
        alt="En breve comenzarás a recibir grandes descuentos al pasar cerca de un comercio bipi"
        className="w-full rounded-3xl mb-5 bipi-fade-up bipi-fade-up-3"
        style={{ display: "block" }}
      />

      {/* Invita amigos */}
      <a href="/bipi/app/afiliados" className="bipi-card p-4 mb-5 flex items-center gap-3 bipi-fade-up bipi-fade-up-3">
        <div className="text-3xl" aria-hidden>🎁</div>
        <div className="flex-1 min-w-0">
          <div className="font-black text-sm">Invita a 5 amigos, gana premios</div>
          <div className="text-xs text-black/55">Tú y ellos os lleváis cupones. Hitos 1 · 3 · 5.</div>
        </div>
        <div className="text-pink-600 font-bold">→</div>
      </a>

      {/* Notificaciones */}
      {pushState === "unknown" && (
        <button onClick={activatePush} className="bipi-btn-ghost w-full mb-5 text-sm py-2.5">
          🔔 Activar avisos de cupones
        </button>
      )}
      {pushState === "granted" && (
        <div className="mb-5 px-3 py-2 rounded-lg bg-black text-xs text-white">
          ✅ Avisos activos. Te avisaremos cuando tus cupones estén a punto de caducar.
        </div>
      )}

      <h2 className="text-xs font-bold uppercase tracking-wider text-black/50 mb-3">
        Tus cupones activos ({offers.length})
      </h2>
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <div key={i} className="bipi-skeleton h-44" />)}
        </div>
      ) : offers.length === 0 ? (
        <div className="bipi-card p-6 text-center space-y-3">
          <div className="text-4xl">🎟️</div>
          <p className="text-sm text-black/70 font-semibold">Aún no tienes cupones</p>
          <p className="text-xs text-black/55">
            Escanea el QR de un negocio Bipi para empezar a desbloquear descuentos cerca.
          </p>
          <a href="/bipi/app/descubre" className="bipi-btn-ghost inline-flex text-sm">
            🧭 Ver negocios cerca
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((o, i) => (
            <div key={o.offerId} className={"bipi-photo-card bipi-fade-up " + (i < 4 ? `bipi-fade-up-${i + 1}` : "")}>
              <div className="photo" style={o.business.brandColor ? { background: o.business.brandColor } : undefined}>
                <div className="discount-tag">{o.rewardLabel ? o.rewardLabel : `-${o.discountPct}%`}</div>
              </div>
              <div className="body">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="name truncate">{o.business.name}</div>
                    <div className="meta truncate">
                      {o.business.category}
                      {o.distanceM != null && ` · ${o.distanceM > 1000 ? `${(o.distanceM / 1000).toFixed(1)} km` : `${o.distanceM} m`}`}
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

      {/* Bottom nav (mobile) */}
      <nav className="bipi-bottom-nav">
        <a href="/bipi/app" className="active">
          <span style={{ fontSize: 18 }}>🏠</span>
          <span>Inicio</span>
        </a>
        <a href="/bipi/app/descubre">
          <span style={{ fontSize: 18 }}>🧭</span>
          <span>Descubre</span>
        </a>
        <a href="/bipi/app/mapa">
          <span style={{ fontSize: 18 }}>🗺</span>
          <span>Mapa</span>
        </a>
        <a href="#" onClick={(e) => { e.preventDefault(); onLogout(); }}>
          <span style={{ fontSize: 18 }}>👤</span>
          <span>Salir</span>
        </a>
      </nav>
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
