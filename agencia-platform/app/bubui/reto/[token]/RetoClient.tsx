"use client";

/**
 * Página del RETO PERSONALIZADO que el comercio envía a un cliente por WhatsApp.
 * El cliente lo abre, inicia sesión (teléfono + SMS), lo reclama y obtiene un
 * enlace para compartir con sus amigos. Cuando se unan los amigos requeridos,
 * su descuento se activa. Funciona en navegador (no depende de la app nativa).
 */
import { useEffect, useState } from "react";

type Deal = {
  token: string;
  businessName: string;
  city: string | null;
  title: string | null;
  clientDiscountPct: number;
  friendsRequired: number;
  friendDiscountPct: number;
  friendTitle: string | null;
  message: string | null;
  expired: boolean;
  claimed: boolean;
};
type Session = { customerId: string; name?: string; token: string };

const ANDROID_PACKAGE = "com.negociovivo.bubui";
const PLAY_URL = (token: string) =>
  `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&referrer=${encodeURIComponent(`reto_${token}`)}`;
// App Store (iPhone): se rellena al publicar vía NEXT_PUBLIC_BUBUI_IOS_URL.
const APPSTORE_URL = process.env.NEXT_PUBLIC_BUBUI_IOS_URL || "";

export default function RetoClient({ token }: { token: string }) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Fase 2: el reto SOLO se acepta desde la app (mode fijo "app"). El código del
  // flujo web sigue en el archivo pero queda inalcanzable; para reactivarlo,
  // volver a exponer setMode + el botón "Continuar sin la app".
  const [mode] = useState<"app" | "web">("app");
  const [os, setOs] = useState<"android" | "ios" | "other">("other");
  const [triedApp, setTriedApp] = useState(false);
  const [step, setStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/bubui/custom-deal/${token}`)
      .then((r) => r.json())
      .then((j) => (j?.error ? setLoadErr(j.error.message) : setDeal(j)))
      .catch(() => setLoadErr("No se pudo cargar el reto."));
    try {
      const raw = localStorage.getItem("bubui.customer");
      if (raw) setSession(JSON.parse(raw));
    } catch {}
    try {
      const ua = navigator.userAgent || "";
      setOs(/Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios" : "other");
    } catch {}
  }, [token]);

  // Intenta abrir la app instalada por deep link; si la pestaña sigue visible
  // pasado un momento, es que no está instalada → mostramos tienda/instalar.
  function openApp() {
    setTriedApp(false);
    let abort = false;
    const onHide = () => { abort = true; };
    document.addEventListener("visibilitychange", onHide);
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onHide);
      if (!abort && !document.hidden) setTriedApp(true);
    }, 1500);
    try { window.location.href = `bubui://reto/${token}`; } catch { setTriedApp(true); }
  }

  function authHeaders(s: Session) {
    return { "Content-Type": "application/json", Authorization: `Bearer ${s.customerId}:${s.token}` };
  }

  async function claim(s: Session) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/bubui/custom-deal/${token}/claim`, {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({ customerId: s.customerId })
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error?.message ?? `Error ${r.status}`); return; }
      setShareUrl(j.shareUrl);
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!name.trim()) { setError("Pon tu nombre"); return; }
    if (phone.trim().length < 6) { setError("Teléfono no válido"); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError("Email no válido"); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/bubui/customer/request-otp", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone.trim() })
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error?.message ?? "No se pudo enviar el código"); return; }
      setStep("code");
    } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/bubui/customer/verify-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim(), name: name.trim(), email: email.trim() })
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error?.message ?? "Código incorrecto"); return; }
      const s: Session = { customerId: j.customerId, name: j.name, token: j.token };
      try { localStorage.setItem("bubui.customer", JSON.stringify(s)); } catch {}
      setSession(s);
      await claim(s);
    } finally { setBusy(false); }
  }

  if (loadErr) {
    return <Shell><p className="text-rose-600 text-sm">{loadErr}</p></Shell>;
  }
  if (!deal) return <Shell><p className="text-black/50 text-sm">Cargando…</p></Shell>;
  if (deal.expired) return <Shell><p className="text-sm">⏳ Este reto ha caducado. Pídele a {deal.businessName} uno nuevo.</p></Shell>;
  if (deal.claimed && !shareUrl) {
    // Reclamado: si soy yo, igualmente puedo reclamar (idempotente) si tengo sesión.
    if (!session) return <Shell><p className="text-sm">Este reto ya fue reclamado.</p></Shell>;
  }

  // Éxito: muestro el enlace para compartir con amigos.
  if (shareUrl) {
    const waText = `¡Únete a Bubui y consigue un ${deal.friendDiscountPct}%${deal.friendTitle ? ` en ${deal.friendTitle}` : ""} en ${deal.businessName}! 🎁 Usa mi enlace: ${shareUrl}`;
    const waShare = `https://wa.me/?text=${encodeURIComponent(waText)}`;
    return (
      <Shell>
        <div className="text-center space-y-3">
          <div className="text-4xl">🎉</div>
          <h1 className="text-xl font-black">¡Reto aceptado!</h1>
          <p className="text-sm text-black/70">
            Comparte tu enlace con tus amigos/as. Cuando se unan <b>{deal.friendsRequired}</b>, se activa tu{" "}
            <b>{deal.clientDiscountPct}%{deal.title ? ` en ${deal.title}` : ""}</b>. Cada amigo/a recibe un <b>{deal.friendDiscountPct}%{deal.friendTitle ? ` en ${deal.friendTitle}` : ""}</b>.
          </p>
          <a href={waShare} target="_blank" rel="noreferrer" className="bubui-btn w-full inline-flex justify-center">📲 Compartir por WhatsApp</a>
          <button
            onClick={() => { navigator.clipboard?.writeText(shareUrl).then(() => alert("Enlace copiado")); }}
            className="w-full text-sm font-semibold border rounded-full py-2.5 hover:bg-black/5"
          >
            Copiar mi enlace
          </button>
          <p className="text-[11px] text-black/45 break-all">{shareUrl}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center mb-4">
        <div className="text-3xl mb-1">🎁</div>
        <h1 className="text-xl font-black leading-tight">{deal.businessName} te propone un reto</h1>
        {deal.message ? (
          // El negocio personalizó el mensaje: lo mostramos tal cual, para
          // que coincida con lo que el cliente leyó en WhatsApp.
          <p className="text-sm text-black/70 mt-2 whitespace-pre-line">{deal.message}</p>
        ) : (
          <p className="text-sm text-black/70 mt-2">
            Trae a <b>{deal.friendsRequired}</b> {deal.friendsRequired === 1 ? "amigo/a" : "amigos/as"} y consigue{" "}
            <b className="text-pink-600">{deal.clientDiscountPct}%{deal.title ? ` en ${deal.title}` : " de descuento"}</b>.
            Cada {deal.friendsRequired === 1 ? "amigo/a" : "amigo/a"} se lleva un <b>{deal.friendDiscountPct}%{deal.friendTitle ? ` en ${deal.friendTitle}` : ""}</b>.
          </p>
        )}
      </div>

      {mode === "app" ? (
        <div className="space-y-3">
          <button onClick={openApp} className="bubui-btn w-full">📲 Aceptar reto en la app</button>
          <p className="text-[11px] text-black/50 text-center">
            Para aceptar el reto necesitas la app de Bubui. Si ya la tienes, se abrirá; si no, instálala gratis y el reto se activará al registrarte.
          </p>
          {(triedApp || os === "other") && (
            <div className="space-y-2 pt-1">
              {os !== "ios" && (
                <a href={PLAY_URL(token)} className="w-full inline-flex justify-center text-sm font-semibold border rounded-full py-2.5 hover:bg-black/5">⬇️ Instalar en Android (Google Play)</a>
              )}
              {os !== "android" && APPSTORE_URL && (
                <a href={APPSTORE_URL} className="w-full inline-flex justify-center text-sm font-semibold border rounded-full py-2.5 hover:bg-black/5">⬇️ Instalar en iPhone (App Store)</a>
              )}
              {os === "ios" && (
                <p className="text-[11px] text-black/50 text-center">
                  Instala Bubui desde la App Store y, cuando la tengas, <b>vuelve a pulsar este enlace</b> para aceptar el reto.
                </p>
              )}
              <button onClick={openApp} className="w-full text-xs text-black/50">↻ Ya tengo la app — abrirla</button>
            </div>
          )}
          {/* Fase 2: el reto SOLO se acepta desde la app instalada. El respaldo
              web se ha retirado a propósito (era temporal durante la revisión de
              tiendas). Para reactivarlo, volver a poner aquí el botón que hacía
              setMode("web"). */}
        </div>
      ) : session ? (
        <button onClick={() => claim(session)} disabled={busy} className="bubui-btn w-full">
          {busy ? "Aceptando…" : "Aceptar reto"}
        </button>
      ) : step === "form" ? (
        <div className="space-y-2">
          <input className="bubui-input" placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="bubui-input" placeholder="Teléfono móvil" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className="bubui-input" placeholder="Email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button onClick={sendCode} disabled={busy} className="bubui-btn w-full">{busy ? "Enviando…" : "Aceptar reto"}</button>
          <p className="text-[11px] text-black/45 text-center">Te enviaremos un código por SMS para verificar tu número.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-black/70">Código SMS enviado a {phone}.</p>
          <input className="bubui-input text-center text-2xl tracking-[0.3em] font-bold" inputMode="numeric" placeholder="● ● ● ● ● ●" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} />
          <button onClick={verify} disabled={busy || code.length < 4} className="bubui-btn w-full">{busy ? "Verificando…" : "Confirmar y aceptar"}</button>
          <button onClick={() => { setStep("form"); setCode(""); }} className="w-full text-xs text-black/50">← Cambiar número</button>
        </div>
      )}
      {error && <p className="text-rose-600 text-sm mt-2 text-center">{error}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="bubui-card p-6">{children}</div>
    </main>
  );
}
