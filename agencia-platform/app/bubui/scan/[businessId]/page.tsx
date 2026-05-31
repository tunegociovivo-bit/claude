"use client";

/**
 * Página que abre el QR del negocio en el móvil del cliente.
 *
 * 1) PUENTE (SmartRedirect): al entrar, intenta abrir la app instalada por
 *    deep link (bubui://bubui/scan/<id>). Si la app NO está (seguimos en la
 *    web tras ~1,5s), mostramos opciones: descargar en Play Store (Android) o
 *    seguir en el navegador.
 * 2) FLUJO WEB (WebFlow): alta express + importe, como red de seguridad para
 *    quien no quiere/puede instalar la app (p. ej. iPhone hasta App Store).
 *
 * Se puede forzar el flujo web saltando el puente con ?web=1 (lo usa el propio
 * botón "seguir en el navegador" y el deep link de retorno).
 */

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const ANDROID_PACKAGE = "com.negociovivo.bubui";
const PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

type Customer = { customerId: string; name?: string; totalSaved: number; totalPurchases: number };

export default function ScanPage() {
  const params = useParams() as { businessId: string };
  const search = useSearchParams();
  const businessId = params.businessId;
  // Si ?web=1 → saltamos el puente y vamos directos al flujo web.
  const [showBridge, setShowBridge] = useState(search.get("web") !== "1");

  if (showBridge) {
    return <SmartRedirect businessId={businessId} onContinueWeb={() => setShowBridge(false)} />;
  }
  return <WebFlow businessId={businessId} />;
}

/**
 * Puente inteligente: detecta SO, intenta abrir la app y, si no aparece,
 * ofrece tienda + web. La detección de "app instalada" no es 100% fiable en
 * móvil (lo limitan iOS/Android), así que usamos el patrón estándar: lanzar el
 * deep link y, si la página sigue visible pasado un tiempo, asumir que no está.
 */
function SmartRedirect({ businessId, onContinueWeb }: { businessId: string; onContinueWeb: () => void }) {
  const [os, setOs] = useState<"android" | "ios" | "other">("other");
  const [triedApp, setTriedApp] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const detected = isAndroid ? "android" : isIOS ? "ios" : "other";
    setOs(detected);

    // En escritorio no tiene sentido el deep link → directo al flujo web.
    if (detected === "other") {
      onContinueWeb();
      return;
    }

    // Intentamos abrir la app por deep link. Si la app está instalada, el SO
    // cambia de contexto (la pestaña pasa a background) y el timeout no salta.
    const deepLink = `bubui://bubui/scan/${businessId}`;
    let abort = false;
    const onHide = () => { abort = true; };
    document.addEventListener("visibilitychange", onHide);

    const t = window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onHide);
      // Si seguimos visibles → la app no se abrió. Mostramos opciones.
      if (!abort && !document.hidden) setTriedApp(true);
    }, 1500);

    // Disparamos el deep link.
    window.location.href = deepLink;

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [businessId, onContinueWeb]);

  return (
    <main className="max-w-md mx-auto px-4 py-12 text-center">
      <h1 className="bubui-wordmark mx-auto justify-center" style={{ fontSize: 56 }}>bubui</h1>

      {!triedApp ? (
        <p className="text-black/60 text-sm mt-6">Abriendo la app…</p>
      ) : (
        <div className="mt-6 space-y-4">
          <p className="text-black/70 text-sm">
            Para registrar tu compra y tu descuento, abre Bubui:
          </p>

          {/* Si tiene la app pero no se abrió sola, este botón la reintenta. */}
          <a href={`bubui://bubui/scan/${businessId}`} className="bubui-btn block text-center">
            Ya tengo la app — abrir
          </a>

          {os === "android" && (
            <a href={PLAY_URL} className="bubui-btn block text-center">
              Descargar en Google Play
            </a>
          )}

          <button
            onClick={onContinueWeb}
            className="w-full text-sm text-pink-600 hover:underline mt-1"
          >
            Seguir en el navegador (sin instalar)
          </button>
        </div>
      )}
    </main>
  );
}

function WebFlow({ businessId }: { businessId: string }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [stage, setStage] = useState<"signup" | "amount" | "sent">("signup");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("bubui.customer");
      if (raw) {
        setCustomer(JSON.parse(raw));
        setStage("amount");
      }
    } catch {}
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {},
        { timeout: 5000, enableHighAccuracy: true }
      );
    }
  }, []);

  function onVerified(c: Customer) {
    localStorage.setItem("bubui.customer", JSON.stringify(c));
    setCustomer(c);
    setStage("amount");
  }

  async function submitAmount() {
    if (!customer) return;
    const value = Number(amount.replace(",", "."));
    if (!value || value <= 0) {
      setError("Importe inválido");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/bubui/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          customerId: customer.customerId,
          amount: value,
          scanLat: coords?.lat,
          scanLng: coords?.lng
        })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setResult(j);
      setStage("sent");
    } finally {
      setSending(false);
    }
  }

  if (stage === "signup") {
    return <SignupForm businessId={businessId} onVerified={onVerified} />;
  }

  if (stage === "amount") {
    return (
      <main className="max-w-md mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold mb-2">¿Cuánto has pagado?</h1>
        <p className="text-slate-600 text-sm mb-6">Introduce el importe del ticket. El negocio confirmará y te aplicarán el descuento.</p>
        <div className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-baseline gap-2">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              className="flex-1 text-5xl font-black border-b-2 border-pink-500 focus:outline-none focus:border-pink-600 py-2 bg-transparent"
            />
            <span className="text-3xl font-bold text-black/50">€</span>
          </div>
          {error && <p className="text-rose-700 text-sm">{error}</p>}
          <button
            onClick={submitAmount}
            disabled={sending || !amount}
            className="bubui-btn w-full"
          >
            {sending ? "Enviando…" : "Confirmar"}
          </button>
        </div>
      </main>
    );
  }

  // sent
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="bg-white border rounded-xl p-6 shadow-sm text-center space-y-4">
        {result?.status === "rejected" ? (
          <>
            <div className="text-5xl">❌</div>
            <h2 className="text-xl font-bold">Escaneo no válido</h2>
            <p className="text-sm text-slate-600">{result.rejectionReason}</p>
          </>
        ) : (
          <>
            <div className="text-5xl">{result?.wheelSpin ? "🎰" : "🎉"}</div>
            <h2 className="text-xl font-bold">
              {result?.wheelSpin ? "¡La ruleta ha girado!" : "¡Ahorro aplicado!"}
            </h2>
            {result?.wheelSpin && (
              <div className="rounded-2xl bg-pink-50 border border-pink-200 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider font-bold text-pink-700/70">
                  Te ha tocado
                </div>
                <div className="text-5xl font-black text-pink-600 bubui-fade-up">
                  {result.wheelSpin.rolled}%
                </div>
                <div className="text-[11px] text-black/55 mt-1">
                  Rango posible: {result.wheelSpin.min}% – {result.wheelSpin.max}%
                </div>
              </div>
            )}
            <p className="text-sm text-slate-600">
              Te has llevado un <strong>{result?.discountPct ?? "—"}%</strong>
              {typeof result?.discountAmount === "number" ? ` (${result.discountAmount.toFixed(2)} €)` : ""} en esta compra.
            </p>
            {result?.offerRedeemed && (
              <p className="text-sm font-semibold text-pink-600">🎟 Has canjeado un cupón cruzado.</p>
            )}
            {result?.offersUnlocked > 0 && (
              <p className="text-xs text-black/50">
                🔓 Has desbloqueado {result.offersUnlocked} cupones nuevos en negocios cerca.
              </p>
            )}
            <a href="/bubui/app" className="bubui-btn block text-center">
              Ver mi ahorro y cupones
            </a>
          </>
        )}
      </div>
    </main>
  );
}

function SignupForm({
  businessId,
  onVerified
}: {
  businessId: string;
  onVerified: (c: Customer) => void;
}) {
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
      const r = await fetch("/api/bubui/customer/request-otp", {
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
      const r = await fetch("/api/bubui/customer/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, name, email, birthDate, gender, firstBusinessId: businessId })
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error?.message ?? `Error ${r.status}`); return; }
      onVerified({ customerId: j.customerId, name: j.name, totalSaved: j.totalSaved ?? 0, totalPurchases: j.totalPurchases ?? 0 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-6">
        <h1 className="bubui-wordmark mx-auto justify-center" style={{ fontSize: 64 }}>bubui</h1>
        <p className="text-black/60 text-sm mt-3">
          ¡Estás a un paso de tu descuento! Verifica tu teléfono — 30 segundos.
        </p>
      </div>
      {step === "form" ? (
        <form onSubmit={sendCode} className="space-y-3 bubui-card p-5">
          <input
            type="text"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bubui-input"
          />
          <input
            type="tel"
            inputMode="tel"
            placeholder="Teléfono móvil"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className="bubui-input"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bubui-input"
          />
          <label className="block text-xs font-semibold text-black/55">
            Fecha de nacimiento
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
              max={new Date().toISOString().slice(0, 10)}
              className="bubui-input mt-1"
            />
          </label>
          <select value={gender} onChange={(e) => setGender(e.target.value)} required className="bubui-input">
            <option value="">Sexo…</option>
            <option value="female">Mujer</option>
            <option value="male">Hombre</option>
            <option value="other">Otro</option>
            <option value="prefer_not">Prefiero no decirlo</option>
          </select>
          {error && <p className="text-rose-700 text-sm">{error}</p>}
          <button type="submit" disabled={busy} className="bubui-btn w-full">
            {busy ? "Enviando…" : "Enviar código SMS"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3 bubui-card p-5">
          <p className="text-sm text-black/70">
            Código SMS enviado a <strong>{phone}</strong>.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="● ● ● ● ● ●"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            autoFocus
            className="bubui-input text-center text-2xl tracking-[0.4em] font-bold"
          />
          {error && <p className="text-rose-700 text-sm">{error}</p>}
          <button type="submit" disabled={busy || code.length < 4} className="bubui-btn w-full">
            {busy ? "Verificando…" : "Verificar y seguir"}
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
