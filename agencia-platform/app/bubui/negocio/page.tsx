"use client";

/**
 * Panel del negocio Bubui. Vive en /bubui/negocio.
 *
 * Si no hay sesión guardada (localStorage `bubui.business`), muestra el
 * login. Si la hay, muestra el dashboard con compras pendientes a
 * confirmar y métricas básicas.
 */

import { useEffect, useState } from "react";
import BubuiBusinessPushButton from "./BubuiBusinessPushButton";
import BubuiAlertPrefs from "./BubuiAlertPrefs";
import BubuiMesaBills from "./BubuiMesaBills";
import BubuiPendingProofs from "./BubuiPendingProofs";

type Session = { businessId: string; name: string; token: string };

export default function NegocioPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false); // ficha por activar (vino por claim)
  const [peek, setPeek] = useState(false); // "ver mi ficha primero"
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    let stored: Session | null = null;
    try {
      const raw = localStorage.getItem("bubui.business");
      if (raw) stored = JSON.parse(raw);
    } catch {}

    const url = new URL(window.location.href);
    const claim = url.searchParams.get("claim");
    if (claim) {
      setClaiming(true);
      fetch("/api/bubui/business/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: claim })
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error?.message ?? "Enlace no válido");
          return j;
        })
        .then((j) => {
          const s: Session = { businessId: j.businessId, name: j.name, token: j.token };
          setSession(s);
          localStorage.setItem("bubui.business", JSON.stringify(s));
          setPending(!!j.pending);
          url.searchParams.delete("claim");
          window.history.replaceState({}, "", url.pathname + url.search);
        })
        .catch((e) => setClaimError(e?.message ?? "Enlace no válido"))
        .finally(() => setClaiming(false));
    } else if (stored) {
      setSession(stored);
    }
  }, []);

  if (claiming) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-500 text-sm">
        Preparando tu Bubui…
      </div>
    );
  }
  if (claimError && !session) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <p className="text-rose-600 font-medium mb-2">{claimError}</p>
          <a href="/negocios" className="text-brand-600 underline text-sm">Ir a iniciar sesión</a>
        </div>
      </div>
    );
  }
  if (!session) {
    return <LoginForm onLogin={(s) => { setSession(s); localStorage.setItem("bubui.business", JSON.stringify(s)); }} />;
  }
  return (
    <>
      {pending && (
        <ActivateGate
          session={session}
          peek={peek}
          onPeek={() => setPeek(true)}
          onActivated={() => { setPending(false); setPeek(false); }}
        />
      )}
      <Dashboard
        session={session}
        onLogout={() => { setSession(null); setPending(false); localStorage.removeItem("bubui.business"); }}
      />
    </>
  );
}

/** Pantalla de activación de una ficha pre-creada (claim). Muestra que su
 *  Bubui ya está montado y pide email + contraseña para ponerlo en vivo. */
function ActivateGate({
  session,
  peek,
  onPeek,
  onActivated
}: {
  session: Session;
  peek: boolean;
  onPeek: () => void;
  onActivated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/bubui/business/${session.businessId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.error?.message ?? "No se pudo activar"); return; }
      onActivated();
    } finally {
      setBusy(false);
    }
  }

  // Si está "peek", solo una barra fija para reabrir.
  if (peek && !open) {
    return (
      <div className="sticky top-0 z-40 bg-emerald-600 text-white text-sm px-4 py-2 flex items-center justify-between">
        <span>Tu ficha está lista pero <strong>aún no activa</strong>.</span>
        <button onClick={() => setOpen(true)} className="bg-white text-emerald-700 rounded-full px-3 py-1 text-xs font-semibold">
          Activar ahora
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold text-slate-900">🎉 ¡Tu Bubui ya está montado!</h2>
        <p className="mt-1 text-sm text-slate-600">
          Hemos preparado la ficha de <strong>{session.name}</strong> con tus datos de Google.
          Solo falta activarla para ponerla en marcha. Crea tu acceso:
        </p>
        <form onSubmit={activate} className="mt-4 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Tu email"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Crea una contraseña (mín. 6)"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
          />
          {error && <p className="text-rose-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-semibold"
          >
            {busy ? "Activando…" : "Activar mi Bubui"}
          </button>
        </form>
        <button
          onClick={() => { setOpen(false); onPeek(); }}
          className="mt-3 w-full text-center text-xs text-slate-500 hover:text-slate-700"
        >
          Ver mi ficha primero
        </button>
      </div>
    </div>
  );
}

function LoginForm({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [forgotSent, setForgotSent] = useState(false);

  async function sendForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/bubui/business/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      // Respuesta siempre ok (no enumeración). Mostramos confirmación.
      setForgotSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "forgot") {
    return (
      <main className="max-w-md mx-auto px-4 py-12">
        <div className="text-center mb-6 bubui-fade-up">
          <h1 className="bubui-wordmark mx-auto justify-center" style={{ fontSize: 56 }}>bubui</h1>
          <p className="text-black/60 text-sm mt-3">Recuperar contraseña</p>
        </div>
        {forgotSent ? (
          <div className="bubui-card p-6 bubui-fade-up bubui-fade-up-1 text-center space-y-3">
            <p className="text-sm">
              Si <b>{email}</b> tiene una cuenta, te hemos enviado un enlace para
              crear una contraseña nueva. Revisa tu correo (y la carpeta de spam).
            </p>
            <button onClick={() => { setMode("login"); setForgotSent(false); }} className="bubui-btn w-full">
              Volver al inicio de sesión
            </button>
          </div>
        ) : (
          <form onSubmit={sendForgot} className="space-y-3 bubui-card p-6 bubui-fade-up bubui-fade-up-1">
            <p className="text-xs text-black/60">
              Introduce el email de tu negocio y te enviaremos un enlace para
              restablecer la contraseña.
            </p>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bubui-input"
            />
            <button type="submit" disabled={busy} className="bubui-btn w-full">
              {busy ? "Enviando…" : "Enviar enlace"}
            </button>
            <button
              type="button"
              onClick={() => setMode("login")}
              className="text-xs text-black/55 text-center w-full hover:underline"
            >
              ← Volver
            </button>
          </form>
        )}
      </main>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/bubui/business/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      onLogin({ businessId: j.businessId, name: j.name, token: j.token });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-6 bubui-fade-up">
        <h1 className="bubui-wordmark mx-auto justify-center" style={{ fontSize: 56 }}>bubui</h1>
        <p className="text-black/60 text-sm mt-3">Panel del negocio</p>
      </div>
      <form onSubmit={submit} className="space-y-3 bubui-card p-6 bubui-fade-up bubui-fade-up-1">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bubui-input"
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="bubui-input"
        />
        {error && <p className="text-rose-700 text-sm">{error}</p>}
        <button type="submit" disabled={busy} className="bubui-btn w-full">
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <button
          type="button"
          onClick={() => { setMode("forgot"); setError(null); }}
          className="text-xs text-pink-600 font-semibold text-center w-full hover:underline"
        >
          ¿Olvidaste tu contraseña?
        </button>
        <p className="text-xs text-black/55 text-center">
          ¿Aún no tienes cuenta? <a href="/bubui/registro" className="text-pink-600 font-semibold hover:underline">Crea tu negocio</a>
        </p>
      </form>
    </main>
  );
}

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [tab, setTab] = useState<"inicio" | "nicho" | "crecer" | "ajustes">("inicio");
  // Sub-pestañas dentro de "Crecer" (mucho contenido → lo organizamos).
  const [crecerTab, setCrecerTab] = useState<"captar" | "destacar" | "red" | "analitica" | "fidelizar">("captar");
  // Botón flotante "Anúnciate" — el admin puede apagarlo desde su panel.
  const [anunciateOn, setAnunciateOn] = useState(false);
  useEffect(() => {
    fetch("/api/bubui/anunciate-button")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setAnunciateOn(!!d.enabled))
      .catch(() => {});
  }, []);

  // `silent` evita el flash de "Cargando…" en los refrescos automáticos:
  // solo la primera carga (sin datos aún) muestra el estado de carga.
  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/bubui/business/${session.businessId}/dashboard`, {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      if (r.ok) {
        setData(await r.json());
        setLoadErr(null);
      } else {
        // No dejamos el panel atascado en "Cargando…": mostramos el error real.
        const j = await r.json().catch(() => ({}));
        setLoadErr(r.status === 401 ? "Tu sesión ha caducado. Vuelve a entrar." : `Error ${r.status}: ${j?.error?.message ?? "no se pudo cargar el panel"}`);
      }
    } catch {
      setLoadErr("Sin conexión con el servidor. Reintentando…");
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // Auto-refresh pendientes cada 10s — silencioso (sin flash de "Cargando…").
    const i = setInterval(() => load(true), 10_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(purchaseId: string, action: "confirm" | "reject") {
    setConfirming(purchaseId);
    try {
      const r = await fetch("/api/bubui/purchase/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ purchaseId, businessId: session.businessId, action })
      });
      if (!r.ok) {
        const j = await r.json();
        alert(j?.error?.message ?? `Error ${r.status}`);
      }
      await load(true);
    } finally {
      setConfirming(null);
    }
  }

  if (!data) {
    // Cargando solo si aún no hubo error; si falló, mostramos el motivo + reintento.
    return (
      <main className="max-w-3xl mx-auto px-4 py-12 space-y-3">
        {loading && !loadErr ? (
          <p>Cargando…</p>
        ) : (
          <>
            <p className="text-sm text-rose-600">{loadErr ?? "No se pudo cargar el panel."}</p>
            <div className="flex gap-2">
              <button onClick={() => load()} className="bubui-btn text-sm py-2 px-4">Reintentar</button>
              <button onClick={onLogout} className="text-sm py-2 px-4 border rounded">Cerrar sesión</button>
            </div>
          </>
        )}
      </main>
    );
  }
  const b = data.business;
  const m = data.metrics;

  const niche =
    b.businessType === "restaurante"
      ? { icon: "🍽️", label: "Mesa", desc: "Configura y gestiona tu Mesa Colectiva (descuento de grupo viral)." }
      : b.businessType === "comercio_producto"
        ? { icon: "💸", label: "Descuentos", desc: "Configura el descuento que ofreces por cada acción del cliente." }
        : { icon: "💸", label: "Descuentos", desc: "Configura tus descuentos por acción y, si quieres, tus citas." };
  const tabs = [
    { key: "inicio" as const, icon: "🏠", label: "Inicio", desc: "Tu día a día: ventas, compras por confirmar y novedades." },
    { key: "nicho" as const, icon: niche.icon, label: niche.label, desc: niche.desc },
    { key: "crecer" as const, icon: "🚀", label: "Crecer", desc: "Lo que hace crecer tu negocio: anúnciate, hazte Pro, destácate, trae clientes y fideliza." },
    { key: "ajustes" as const, icon: "⚙️", label: "Ajustes", desc: "Tu ficha, fotos, QR y tipo de negocio." }
  ];
  const cur = tabs.find((t) => t.key === tab) ?? tabs[0];

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between bubui-fade-up">
        <div>
          <h1 className="text-2xl font-black tracking-tight">{b.name}</h1>
          <p className="text-xs text-black/55">
            {b.category} · {b.city} · Plan {b.plan} · Karma {b.visibilityScore}/100
          </p>
        </div>
        <button onClick={onLogout} className="text-xs text-black/45 hover:text-black/70">Cerrar sesión</button>
      </div>

      {/* Barra de pestañas — fija (4 columnas), sin scroll, pegada arriba.
          "Crecer" se resalta siempre (es donde se monetiza). */}
      <nav className="sticky top-0 z-20 -mx-4 px-2 py-2 bg-white/95 backdrop-blur border-b grid grid-cols-4 gap-1">
        {tabs.map((t) => {
          const isCrecer = t.key === "crecer";
          const active = tab === t.key;
          const base = "flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[10px] font-bold leading-tight transition relative";
          let cls: string;
          let style: React.CSSProperties | undefined;
          if (isCrecer) {
            // Siempre destacado: degradado y, si activo, con sombra extra.
            cls = base + " text-white shadow-md" + (active ? " ring-2 ring-amber-300" : "");
            style = { background: "linear-gradient(135deg,#f59e0b,#ec1c6e)" };
          } else {
            cls = base + (active ? " bg-pink-600 text-white" : " text-black/55 hover:bg-black/5");
          }
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={cls} style={style}>
              <span className="text-lg leading-none">{t.icon}</span>
              <span className="truncate w-full text-center">{isCrecer ? "Crecer 💰" : t.label}</span>
            </button>
          );
        })}
      </nav>
      <p className="text-xs text-black/55 -mt-1">{cur.desc}</p>

      {/* Activar push del panel en este dispositivo + elegir qué avisos recibir. */}
      <div className="-mt-1">
        <div className="flex justify-end">
          <BubuiBusinessPushButton businessId={b.id} token={session.token} />
        </div>
        <BubuiAlertPrefs
          businessId={b.id}
          token={session.token}
          initial={{
            pushOnNewClient: b.pushOnNewClient,
            pushOnReview: b.pushOnReview,
            pushOnBooking: b.pushOnBooking,
            pushOnCoupon: b.pushOnCoupon
          }}
        />
      </div>

      {/* Avisos (ej. cliente alcanzó 5 referidos) — siempre visibles */}
      {Array.isArray(data.notifications) && data.notifications.length > 0 && (
        <section className="rounded-2xl border-2 border-pink-300 bg-pink-50 p-4 bubui-fade-up">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm text-pink-800">🔔 Novedades ({data.notifications.length})</h3>
            <button
              onClick={async () => {
                await fetch(`/api/bubui/business/${b.id}/notifications/read`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${session.token}` }
                });
                load();
              }}
              className="text-xs font-semibold text-pink-700 hover:underline"
            >
              Marcar leídas
            </button>
          </div>
          <ul className="space-y-1.5">
            {data.notifications.map((n: any) => (
              <li key={n.id} className="text-sm text-black/75">
                {n.message}
                <span className="text-[11px] text-black/40 ml-1">· {new Date(n.createdAt).toLocaleDateString("es-ES")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ───────────── PESTAÑA: INICIO ───────────── */}
      {tab === "inicio" && (
        <>
          {/* Banner informativo: Bubui también gestiona subvenciones. Las
              ayudas concretas se envían por WhatsApp/email tras encontrarlas. */}
          <section
            className="rounded-2xl p-4 text-white bubui-fade-up"
            style={{ background: "linear-gradient(135deg,#db2777,#f97316)" }}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none">💶</span>
              <div>
                <h3 className="font-black text-sm">Bubui también te consigue subvenciones</h3>
                <p className="text-[13px] text-white/90 mt-0.5">
                  Buscamos ayudas públicas para hacer crecer tu negocio y te las gestionamos nosotros.
                  Cuando encontremos alguna que encaje con tu sector, te avisamos por WhatsApp y email.
                </p>
              </div>
            </div>
          </section>
          {/* Capturas provisionales por verificar (la IA no pudo validarlas) */}
          <BubuiPendingProofs businessId={b.id} token={session.token} />
          {/* Cuentas que Bubui ha traído en Mesa Colectiva (de un vistazo) */}
          <BubuiMesaBills businessId={b.id} token={session.token} />
          {/* Compras por confirmar — LO MÁS USADO: destacado y arriba del todo */}
          <section className={`rounded-2xl p-4 sm:p-5 ${data.pending.length > 0 ? "border-2 border-emerald-400 bg-emerald-50 shadow-lg shadow-emerald-100" : "bubui-card"}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-black text-base flex items-center gap-2">
                🧾 Compras por confirmar
                {data.pending.length > 0 && (
                  <span className="bg-emerald-600 text-white text-xs font-black rounded-full min-w-6 h-6 px-2 grid place-items-center animate-pulse">
                    {data.pending.length}
                  </span>
                )}
              </h3>
            </div>
            {data.pending.length === 0 ? (
              <div className="py-6 text-center text-sm text-black/55">
                Todo al día ✅ — cuando un cliente escanee su compra, aparecerá aquí para que la confirmes.
              </div>
            ) : (
              <div className="space-y-2">
                {data.pending.map((p: any) => {
                  const initial = (p.customer.name ?? p.customer.email ?? "?").charAt(0).toUpperCase();
                  return (
                    <div key={p.id} className="bg-white rounded-xl border border-emerald-200 p-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center font-black shrink-0">{initial}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate text-sm">
                          {p.customer.name ?? p.customer.email}
                          {p.offerRedeemed && <span className="ml-1.5 text-[10px] font-bold text-pink-600">🎟 CRUZADO</span>}
                        </div>
                        <div className="text-[11px] text-black/55">
                          {new Date(p.scannedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · <strong className="text-emerald-700">{p.amount.toFixed(2)} €</strong> · {p.discountPct}% off
                        </div>
                      </div>
                      <button
                        onClick={() => act(p.id, "reject")}
                        disabled={confirming === p.id}
                        className="px-2.5 py-2 rounded-lg border border-black/15 bg-white hover:bg-black/5 text-xs font-semibold disabled:opacity-50 shrink-0"
                      >
                        ✕
                      </button>
                      <button
                        onClick={() => act(p.id, "confirm")}
                        disabled={confirming === p.id}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black disabled:opacity-50 shrink-0"
                      >
                        ✓ Confirmar
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Resumen — tarjeta oscura con gráfica de ventas + métricas */}
          <section className="bubui-fade-up bubui-fade-up-1 space-y-3">
            <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#1A1A1A,#0A0A0A)" }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/50 font-bold">Ventas Bubui · 30 días</div>
                  <div className="text-4xl font-black mt-1">
                    {(m.revenue30 ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €
                  </div>
                </div>
                {typeof m.deltas?.scans7 === "number" && (
                  <div className={"text-xs font-bold px-2 py-1 rounded-full " + (m.deltas.scans7 >= 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
                    {m.deltas.scans7 >= 0 ? "↗" : "↘"} {Math.abs(m.deltas.scans7)}% escaneos 7d
                  </div>
                )}
              </div>
              <SalesChart data={m.dailyRevenue ?? []} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetricCard label="Ventas 30d" value={m.scans30} sub="confirmadas" />
              <MetricCard label="Nuevos clientes" value={m.newCustomers30 ?? 0} sub="30 días" />
              <MetricCard label="Ticket medio" value={`${(m.ticketMedio ?? 0).toFixed(2)} €`} />
              <MetricCard label="Escaneos 7d" value={m.scans7} />
            </div>
          </section>

          <RankingCard businessId={b.id} token={session.token} />
        </>
      )}

      {/* ───────────── PESTAÑA: MI NICHO ───────────── */}
      {tab === "nicho" && (
        <>
          {/* Lo principal para comercio y servicios: descuentos por acción.
              El catálogo/servicios queda como opcional debajo. */}
          {(b.businessType === "comercio_producto" || b.businessType === "servicios") && (
            <Highlight label="⭐ Lo más importante">
              <DiscountsConfig business={b} token={session.token} onSaved={load} />
            </Highlight>
          )}
          {b.businessType === "servicios" && (
            <>
              <BookingsPanel businessId={b.id} token={session.token} />
              <details className="bubui-card p-0 overflow-hidden">
                <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-black/70">
                  📅 Tus servicios y citas (opcional)
                </summary>
                <div className="px-1 pb-1">
                  <ServicesConfig business={b} token={session.token} onSaved={load} />
                </div>
              </details>
            </>
          )}
          {b.businessType === "restaurante" && (
            <>
              <MesaTablesPanel businessId={b.id} token={session.token} />
              <MesaConfig business={b} token={session.token} onSaved={load} />
            </>
          )}
        </>
      )}

      {/* ───────────── PESTAÑA: CRECER ─────────────
          Mucho contenido → sub-pestañas para no abrumar. Orden: lo que
          monetiza primero; "Fidelizar" (antes pestaña propia) al final. */}
      {tab === "crecer" && (
        <>
          {(() => {
            const subTabs = [
              { key: "captar" as const, icon: "🚀", label: "Captar" },
              { key: "destacar" as const, icon: "✨", label: "Destacar" },
              { key: "red" as const, icon: "🔗", label: "Red" },
              { key: "analitica" as const, icon: "📈", label: "Analítica" },
              { key: "fidelizar" as const, icon: "🎁", label: "Fidelizar" }
            ];
            return (
              <nav className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {subTabs.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setCrecerTab(s.key)}
                    className={`shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      crecerTab === s.key ? "bg-pink-600 text-white shadow" : "bg-black/5 text-black/60 hover:bg-black/10"
                    }`}
                  >
                    <span>{s.icon}</span> {s.label}
                  </button>
                ))}
              </nav>
            );
          })()}

          {/* CAPTAR — lo que monetiza: anúnciate + hazte Pro/Premium */}
          {crecerTab === "captar" && (
            <>
              <Highlight label="⭐ Lo más potente">
                <PushAdForm businessId={b.id} businessName={b.name} token={session.token} plan={b.plan} />
              </Highlight>
              <Highlight label="💎 Recomendado">
                <PlanCard business={b} token={session.token} onChanged={load} />
              </Highlight>
            </>
          )}

          {/* DESTACAR — visibilidad en la app y página pública */}
          {crecerTab === "destacar" && (
            <>
              <PromotionPanel business={b} token={session.token} onChanged={load} />
              <ShareWidget slug={b.slug} name={b.name} discountPct={b.defaultDiscountPct} />
            </>
          )}

          {/* RED — trae otros negocios y mira los cruces de clientes */}
          {crecerTab === "red" && (
            <>
              <BusinessReferralPanel businessId={b.id} token={session.token} />
              <CrossShopperPanel businessId={b.id} token={session.token} />
            </>
          )}

          {/* ANALÍTICA — mide tu crecimiento */}
          {crecerTab === "analitica" && (
            <PremiumAnalytics businessId={b.id} token={session.token} plan={b.plan} />
          )}

          {/* FIDELIZAR — antes era una pestaña propia; ahora vive aquí, al final */}
          {crecerTab === "fidelizar" && (
            <>
              <Highlight label="⭐ Lo más usado">
                <LoyaltyConfig business={b} token={session.token} onSaved={load} />
              </Highlight>
              <EngagementConfig business={b} token={session.token} onSaved={load} />
              <ReferralConfig business={b} token={session.token} onSaved={load} />
            </>
          )}
        </>
      )}

      {/* ───────────── PESTAÑA: AJUSTES ───────────── */}
      {tab === "ajustes" && (
        <>
          {/* Editar perfil (incluye el tipo de negocio) */}
          <ProfileEditor business={b} token={session.token} onSaved={load} />
          {/* Redes y reseñas autocompletadas por IA */}
          <AutofillProfile business={b} token={session.token} onSaved={load} />
          <AiPhotoStudio business={b} token={session.token} onSaved={load} />

          {/* QR + cartel + CSV */}
          <section className="bg-white border rounded-xl p-5 shadow-sm flex items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.qrPngUrl} alt="QR" className="w-32 h-32 border rounded" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Tu QR</h3>
              <p className="text-xs text-slate-600 mb-2">Imprímelo y ponlo en la caja. Cada escaneo sube tu karma y te hace más visible.</p>
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={`/api/bubui/business/${b.id}/poster.png`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-bold text-pink-700 border-2 border-pink-600 rounded-full px-3 py-1 hover:bg-pink-50"
                >
                  🖨️ Descargar cartel para imprimir
                </a>
                <a href={b.qrPngUrl} download className="text-sm text-pink-600 hover:underline">Solo el QR (PNG)</a>
                <span className="text-slate-400">·</span>
                <CsvDownloadButton businessId={b.id} token={session.token} />
              </div>
              {/* Pedir la pegatina QR impresa: se la llevamos gratis al local. */}
              <StickerRequest business={b} token={session.token} onChanged={load} />
            </div>
          </section>
        </>
      )}

      {/* Botón flotante "Anúnciate" — fijo y llamativo en cualquier pestaña.
          Se oculta cuando ya estás en "Crecer" (donde vive el formulario). */}
      {anunciateOn && tab !== "crecer" && (
        <button
          onClick={() => {
            setTab("crecer");
            setCrecerTab("captar");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          aria-label="Anúnciate"
          className="bubui-anunciate-btn fixed bottom-5 left-1/2 z-40 inline-flex items-center gap-2 rounded-full pl-4 pr-5 py-3 text-white font-black text-sm shadow-xl"
        >
          <span className="text-lg leading-none">📣</span>
          <span>Anúnciate</span>
        </button>
      )}
    </main>
  );
}

/** Marco llamativo para resaltar las secciones más interesantes de cada
 *  pestaña: anillo degradado + chip. Envuelve cualquier tarjeta. */
function Highlight({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="absolute -top-2.5 left-4 z-10 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-white bg-gradient-to-r from-pink-600 to-orange-500 rounded-full px-2.5 py-0.5 shadow-md">
        {label}
      </span>
      <div className="rounded-2xl p-[2.5px] bg-gradient-to-br from-pink-500 via-orange-400 to-amber-400 shadow-lg shadow-pink-100">
        <div className="rounded-[14px] overflow-hidden bg-white">{children}</div>
      </div>
    </div>
  );
}

/** Ranking mensual: pica al dueño a competir por el "destacado gratis"
 *  mostrando su posición y el podio en vivo. */
function RankingCard({ businessId, token }: { businessId: string; token: string }) {
  const [r, setR] = useState<{
    position: number | null;
    total: number;
    customers: number;
    top: { position: number; name: string; city: string | null; customers: number; isMe: boolean }[];
  } | null>(null);

  useEffect(() => {
    fetch(`/api/bubui/business/${businessId}/ranking`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then(setR)
      .catch(() => {});
  }, [businessId, token]);

  if (!r) return null;
  const leading = r.position === 1;
  const monthName = new Date().toLocaleDateString("es-ES", { month: "long" });

  return (
    <section className="bg-white rounded-2xl border-2 border-amber-200 p-4 mt-4">
      <h3 className="font-bold text-sm flex items-center gap-2">🏆 Ranking de {monthName}</h3>
      <p className="text-xs text-slate-600 mt-1">
        El negocio que más clientes traiga este mes aparece <b>destacado gratis</b> en Descubre.
      </p>
      <div className="mt-3 flex items-end gap-3">
        <div className="text-3xl font-black text-amber-600">{r.position ? `#${r.position}` : "—"}</div>
        <div className="text-xs text-slate-600 pb-1">
          {r.position
            ? leading
              ? `¡Vas líder con ${r.customers} clientes! 🔥`
              : `${r.customers} cliente${r.customers === 1 ? "" : "s"} este mes · de ${r.total} negocios`
            : "Aún sin clientes este mes — ¡reparte tu QR!"}
        </div>
      </div>
      {r.top.length > 0 && (
        <ul className="mt-3 space-y-1">
          {r.top.map((t) => (
            <li
              key={t.position}
              className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg ${
                t.isMe ? "bg-amber-50 border border-amber-200 font-semibold" : "bg-slate-50"
              }`}
            >
              <span className="truncate">
                {t.position === 1 ? "🥇" : t.position === 2 ? "🥈" : t.position === 3 ? "🥉" : `${t.position}.`}{" "}
                {t.name}
                {t.isMe ? " (tú)" : ""}
              </span>
              <span className="text-slate-500 shrink-0 ml-2">{t.customers}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Programa de referidos B2B: invita a otros negocios y gana semanas de banner
 *  del Home (1 por cada 5 negocios activos). Muestra enlace, progreso y las
 *  campañas de banner ganadas (con subida de imagen). */
function BusinessReferralPanel({ businessId, token }: { businessId: string; token: string }) {
  const [data, setData] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/bubui/business/${businessId}/business-referral`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r.ok) setData(await r.json());
    } catch {}
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return null;

  const pct = Math.round((data.towardsNext / data.businessesPerReward) * 100);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(data.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  function shareWhatsApp() {
    const text = `Únete a Bubui y consigue más clientes en el barrio. Date de alta con mi enlace: ${data.inviteUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }
  async function saveCampaignImage(campaignId: string, imageUrl: string, link: string) {
    setSavingId(campaignId);
    try {
      const r = await fetch(`/api/bubui/business/${businessId}/business-referral`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ campaignId, imageUrl, link: link || null })
      });
      if (!r.ok) {
        const j = await r.json();
        alert(j?.error?.message ?? `Error ${r.status}`);
      } else {
        await load();
      }
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="bubui-card p-5 space-y-4">
      <img
        src="/bubui/referido-negocios.png"
        alt="Comparte tu referido y recibe 1 semana de banner gratis por cada 5 negocios"
        className="w-full max-w-[340px] mx-auto"
      />
      <div>
        <h3 className="font-bold text-sm">🤝 Invita a otros negocios</h3>
        <p className="text-[13px] text-black/55 mt-1">
          Comparte tu enlace con otros comercios. Por cada <b>5 negocios</b> que se den de alta con tu enlace y reciban
          su primer cliente, ganas <b>una semana de banner</b> en la portada de la app.
        </p>
      </div>

      <div className="rounded-xl border border-black/10 p-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-semibold">
            {data.qualifiedReferrals} negocio{data.qualifiedReferrals === 1 ? "" : "s"} activo
            {data.qualifiedReferrals === 1 ? "" : "s"}
          </span>
          <span className="text-black/55">{data.remainingForNext} para la próxima semana 🎁</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-black/10 overflow-hidden">
          <div className="h-full bg-pink-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        {data.weeksEarned > 0 && (
          <p className="text-xs text-emerald-600 font-semibold mt-2">
            Has ganado {data.weeksEarned} semana{data.weeksEarned === 1 ? "" : "s"} de banner en total.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <input readOnly value={data.inviteUrl} className="bubui-input flex-1 text-xs" />
          <button onClick={copyLink} className="bubui-btn whitespace-nowrap">
            {copied ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
        <button onClick={shareWhatsApp} className="bubui-btn bubui-attention w-full">
          Compartir por WhatsApp
        </button>
      </div>

      {data.campaigns.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-black/55">Tus banners</h4>
          {data.campaigns.map((c: any) => (
            <BannerCampaignRow
              key={c.id}
              campaign={c}
              saving={savingId === c.id}
              onSave={(img, link) => saveCampaignImage(c.id, img, link)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BannerCampaignRow({
  campaign,
  saving,
  onSave
}: {
  campaign: any;
  saving: boolean;
  onSave: (imageUrl: string, link: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState(campaign.imageUrl ?? "");
  const [link, setLink] = useState(campaign.link ?? "");
  const statusLabel =
    campaign.status === "active"
      ? `🟢 En portada${campaign.endsAt ? ` · hasta ${new Date(campaign.endsAt).toLocaleDateString("es-ES")}` : ""}`
      : campaign.status === "queued"
      ? "🕒 En cola"
      : "✓ Finalizada";

  return (
    <div className="rounded-xl border border-black/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{statusLabel}</span>
        <span className="text-[11px] text-black/45">1 semana</span>
      </div>
      {campaign.status !== "done" && (
        <>
          <input
            className="bubui-input text-xs"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="URL de la imagen del banner (https://…)"
          />
          <input
            className="bubui-input text-xs"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Enlace al tocar (opcional)"
          />
          <button
            onClick={() => onSave(imageUrl, link)}
            disabled={saving || !imageUrl}
            className="bubui-btn text-xs disabled:opacity-50"
          >
            {saving ? "Guardando…" : campaign.imageUrl ? "Actualizar imagen" : "Guardar imagen"}
          </button>
        </>
      )}
      {campaign.imageUrl && (
        <img src={campaign.imageUrl} alt="banner" className="rounded-lg max-w-[280px] w-full border border-black/10" />
      )}
    </div>
  );
}

/** Botón para descargar CSV con las compras confirmadas del negocio.
 *  Usa fetch para incluir el header Authorization, crea blob y dispara
 *  descarga (no se puede hacer con <a download> porque no permite headers). */
function CsvDownloadButton({ businessId, token }: { businessId: string; token: string }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await fetch(`/api/bubui/business/${businessId}/purchases.csv`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) {
        alert("No se pudo descargar el CSV.");
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bubui-compras-${businessId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={go}
      disabled={busy}
      className="text-sm text-pink-600 hover:underline disabled:opacity-50"
    >
      {busy ? "Generando…" : "Descargar CSV compras"}
    </button>
  );
}

/** Widget de compartir página pública. Native Web Share API si está
 *  disponible (móvil), si no fallback a deep links de WhatsApp/Telegram
 *  + botón "copiar URL" con feedback. */
/** Configuración del programa de afiliados: recompensas por hito (1/3/5)
 *  que financia este negocio. */
function ReferralConfig({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(business.referralEnabled ?? true);
  const [r1, setR1] = useState(business.referralReward1 ?? "2");
  const [r3, setR3] = useState(business.referralReward3 ?? "3");
  const [r5, setR5] = useState(business.referralReward5 ?? "5");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          referralEnabled: enabled,
          referralReward1: r1 || null,
          referralReward3: r3 || null,
          referralReward5: r5 || null
        })
      });
      setStatus(r.ok ? "Guardado." : "Error al guardar.");
      if (r.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bubui-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm">🎁 Programa "Trae amigos"</h3>
          <p className="text-xs text-black/55 mt-0.5">
            Tus clientes invitan; al llegar a 1, 3 y 5 amigos verificados, tú les das estas recompensas. Pon un <strong>número</strong> (ej. 5 = cupón del 5% guardado) o un <strong>texto</strong> (ej. "Tapa gratis"). Recibirás un aviso al llegar a 5.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold shrink-0">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Activo
        </label>
      </div>
      {enabled && (
        <>
          {/* Plantillas preestablecidas — un clic rellena los 3 hitos. El
              dueño puede afinar valores después. */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] uppercase tracking-wider font-bold text-black/45 mr-1">Plantillas:</span>
            {[
              { label: "Conservadora", r1: "3", r3: "5", r5: "10" },
              { label: "Equilibrada", r1: "5", r3: "10", r5: "15" },
              { label: "Agresiva", r1: "5", r3: "15", r5: "25" }
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setR1(p.r1); setR3(p.r3); setR5(p.r5); }}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-pink-300 text-pink-700 hover:bg-pink-50"
              >
                {p.label} {p.r1}/{p.r3}/{p.r5}%
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {[
              { n: 1, v: r1, set: setR1 },
              { n: 3, v: r3, set: setR3 },
              { n: 5, v: r5, set: setR5 }
            ].map((m) => (
              <label key={m.n} className="flex items-center gap-2 text-xs">
                <span className="w-20 font-semibold text-black/60">{m.n} {m.n === 1 ? "amigo" : "amigos"}</span>
                <input
                  value={m.v}
                  onChange={(e) => m.set(e.target.value)}
                  placeholder="Recompensa (ej: Tapa gratis)"
                  className="flex-1 px-2 py-1.5 border rounded bg-white"
                />
              </label>
            ))}
          </div>
        </>
      )}
      {status && <p className="text-xs text-emerald-700">{status}</p>}
      <button onClick={save} disabled={saving} className="bubui-btn w-full text-sm py-2">
        {saving ? "Guardando…" : "Guardar afiliados"}
      </button>
    </section>
  );
}

/** Tarjeta de fidelidad — sellos digitales. El cliente acumula 1 sello por
 *  cada compra confirmada en el negocio; al completar el objetivo se le
 *  desbloquea automáticamente un cupón. La tarjeta empieza el siguiente
 *  ciclo y el cliente puede repetir. */
function LoyaltyConfig({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(business.loyaltyEnabled ?? false);
  const [goal, setGoal] = useState<number>(business.loyaltyGoal ?? 5);
  const [pct, setPct] = useState<number>(business.loyaltyRewardPct ?? 0);
  const [label, setLabel] = useState<string>(business.loyaltyRewardLabel ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          loyaltyEnabled: enabled,
          loyaltyGoal: Number(goal),
          loyaltyRewardPct: Number(pct),
          loyaltyRewardLabel: label.trim() || null
        })
      });
      setStatus(r.ok ? "Guardado." : "Error al guardar.");
      if (r.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bubui-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm">🎟️ Tarjeta de fidelidad</h3>
          <p className="text-xs text-black/55 mt-0.5">
            Cada compra confirmada suma 1 sello. Al completar el objetivo, el
            cliente recibe automáticamente el cupón y la tarjeta se reinicia
            para el siguiente ciclo.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold shrink-0">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Activa
        </label>
      </div>
      {enabled && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] uppercase tracking-wider font-bold text-black/45 mr-1">Plantillas:</span>
            {[
              { label: "Café × 5", goal: 5, pct: 0, txt: "Café gratis" },
              { label: "5 visitas · 15%", goal: 5, pct: 15, txt: "" },
              { label: "10 visitas · 30%", goal: 10, pct: 30, txt: "" }
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setGoal(p.goal); setPct(p.pct); setLabel(p.txt); }}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-pink-300 text-pink-700 hover:bg-pink-50"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid sm:grid-cols-3 gap-2 text-xs">
            <label>
              <span className="block font-medium mb-1">Sellos para completar</span>
              <input
                type="number"
                min={2}
                max={20}
                value={goal}
                onChange={(e) => setGoal(Number(e.target.value))}
                className="w-full px-2 py-1.5 border rounded bg-white"
              />
            </label>
            <label>
              <span className="block font-medium mb-1">% de la recompensa</span>
              <input
                type="number"
                min={0}
                max={90}
                value={pct}
                onChange={(e) => setPct(Number(e.target.value))}
                className="w-full px-2 py-1.5 border rounded bg-white"
              />
              <span className="block text-[10px] text-slate-500 mt-0.5">0 si usas texto libre</span>
            </label>
            <label>
              <span className="block font-medium mb-1">o texto (alternativa)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ej. Café gratis"
                className="w-full px-2 py-1.5 border rounded bg-white"
              />
            </label>
          </div>
          {/* Vista previa de los sellos */}
          <div className="flex gap-1 pt-1">
            {Array.from({ length: Math.max(2, Math.min(20, goal)) }).map((_, i) => (
              <div
                key={i}
                className="h-7 w-7 rounded-full grid place-items-center text-[10px] font-black border-2 border-dashed border-pink-300 text-pink-300"
              >
                {i + 1}
              </div>
            ))}
          </div>
        </>
      )}
      {status && <p className="text-xs text-emerald-700">{status}</p>}
      <button onClick={save} disabled={saving} className="bubui-btn w-full text-sm py-2">
        {saving ? "Guardando…" : "Guardar fidelidad"}
      </button>
    </section>
  );
}

/** Configuración de la Mesa Colectiva (solo restaurantes). */
function MesaConfig({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [v, setV] = useState({
    mesaEnabled: !!business.mesaEnabled,
    mesaBasePct: business.mesaBasePct ?? 5,
    mesaMinDiners: business.mesaMinDiners ?? 4,
    mesaShareBonusPct: business.mesaShareBonusPct ?? 5,
    mesaReviewBonusPct: business.mesaReviewBonusPct ?? 3,
    mesaReviewPlatform: business.mesaReviewPlatform ?? "google",
    mesaMaxPct: business.mesaMaxPct ?? 20,
    mesaJoinWindowMin: business.mesaJoinWindowMin ?? 60,
    mesaNextVisitDays: business.mesaNextVisitDays ?? 15,
    mesaBonusOnThisVisit: !!business.mesaBonusOnThisVisit,
    mesaVeteranMustContribute: business.mesaVeteranMustContribute ?? true,
    mesaNewUserMustContribute: business.mesaNewUserMustContribute ?? false,
    mesaVeteranShareFriends: business.mesaVeteranShareFriends ?? 1,
    mesaAutoAdjust: business.mesaAutoAdjust ?? true,
    mesaActShare: business.mesaActShare ?? true,
    mesaActReview: business.mesaActReview ?? true,
    mesaActPhoto: business.mesaActPhoto ?? true,
    mesaActFollow: !!business.mesaActFollow,
    mesaPerkLabel: business.mesaPerkLabel ?? ""
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Simulador: el dueño juega con nº de comensales y ticket para ver el efecto.
  const [simDiners, setSimDiners] = useState(6);
  const [simTicket, setSimTicket] = useState(120);
  const set = (k: string, val: any) => setV((s) => ({ ...s, [k]: val }));

  const PLATFORMS: { value: string; label: string }[] = [
    { value: "google", label: "Google" },
    { value: "tripadvisor", label: "Tripadvisor" },
    { value: "trustpilot", label: "Trustpilot" },
    { value: "instagram", label: "Instagram" }
  ];
  // Campo numérico con ayuda debajo.
  const num = (k: string, label: string, min: number, max: number, help: string) => (
    <label className="text-xs">
      <span className="block font-semibold mb-1">{label}</span>
      <input type="number" min={min} max={max} value={(v as any)[k]} onChange={(e) => set(k, Number(e.target.value))} className="w-full px-2 py-1.5 border rounded bg-white" />
      <span className="block text-[10px] text-black/45 mt-0.5 leading-tight">{help}</span>
    </label>
  );
  const chk = (k: string, label: string, help?: string) => (
    <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" checked={(v as any)[k]} onChange={(e) => set(k, e.target.checked)} className="mt-0.5" />
      <span><span className="font-medium">{label}</span>{help && <span className="block text-[10px] text-black/45 leading-tight">{help}</span>}</span>
    </label>
  );

  // Cálculo del simulador (espejo del motor): base con quórum + bonus, con tope.
  const clamp = (n: number) => Math.max(0, Math.min(v.mesaMaxPct, Math.round(n)));
  const quorum = simDiners >= v.mesaMinDiners;
  const pctNow = quorum ? (v.mesaBonusOnThisVisit ? clamp(v.mesaBasePct + v.mesaShareBonusPct + v.mesaReviewBonusPct) : clamp(v.mesaBasePct)) : 0;
  const pctNext = quorum && !v.mesaBonusOnThisVisit ? clamp(v.mesaShareBonusPct + v.mesaReviewBonusPct) : 0;
  const maxPot = clamp(v.mesaBasePct + v.mesaShareBonusPct + v.mesaReviewBonusPct);
  const eur = (p: number) => Math.round((simTicket * p) / 100 * 100) / 100;
  const platformLabel = PLATFORMS.find((p) => p.value === v.mesaReviewPlatform)?.label ?? "Google";
  const perk = (v.mesaPerkLabel || "").trim();

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(v)
      });
      setStatus(r.ok ? "Guardado." : "Error al guardar.");
      if (r.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bubui-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm">🍽️ Mesa Colectiva</h3>
          <p className="text-xs text-black/60 mt-1 leading-snug">
            Una mesa de varias personas escanea un <b>QR de grupo</b> y desbloquea un descuento
            compartido. Cuanto más grande la mesa y más colaboren (invitar amigos, dejar reseña),
            mayor es el descuento. Así <b>llenas mesas y consigues clientes y reseñas nuevas</b>.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold shrink-0">
          <input type="checkbox" checked={v.mesaEnabled} onChange={(e) => set("mesaEnabled", e.target.checked)} />
          Activa
        </label>
      </div>
      {v.mesaEnabled && (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            {num("mesaBasePct", "% descuento base", 0, 50, "El que se aplica al juntar el mínimo de comensales.")}
            {num("mesaMinDiners", "Mínimo de comensales", 2, 50, "Cuántos deben escanear el QR de la mesa para activarlo.")}
            {num("mesaMaxPct", "% máximo (tope)", 0, 50, "El descuento nunca pasará de aquí, protege tu margen.")}
            {num("mesaShareBonusPct", "+% si invitan amigos", 0, 50, `Extra si TODA la mesa invita a ${v.mesaVeteranShareFriends} amigo${v.mesaVeteranShareFriends === 1 ? "" : "s"} c/u. Solo cuenta si el amigo INSTALA la app y se DA DE ALTA.`)}
            {num("mesaReviewBonusPct", `+% si dejan reseña`, 0, 50, `Extra si TODA la mesa te deja una reseña en ${platformLabel}.`)}
            {num("mesaVeteranShareFriends", "Amigos a invitar (c/u)", 1, 10, "Nº de amigos que cada uno debe invitar para el extra. El amigo tiene que instalar Bubui y darse de alta para que cuente.")}
            {num("mesaJoinWindowMin", "Ventana de unión (min)", 5, 180, "Minutos para que se unan tras crear la mesa.")}
            {num("mesaNextVisitDays", "Caducidad del cupón (días)", 1, 120, "Cuánto dura el cupón de la próxima visita.")}
            <label className="text-xs">
              <span className="block font-semibold mb-1">Reseña en</span>
              <select value={v.mesaReviewPlatform} onChange={(e) => set("mesaReviewPlatform", e.target.value)} className="w-full px-2 py-1.5 border rounded bg-white">
                {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <span className="block text-[10px] text-black/45 mt-0.5 leading-tight">Dónde piden la reseña (según tu sector).</span>
            </label>
          </div>

          <div className="space-y-2 pt-1">
            {chk("mesaBonusOnThisVisit", "Aplicar el extra en esta misma cuenta", "Si lo desmarcas, el extra se guarda como cupón para su PRÓXIMA visita (vuelven antes).")}
            {chk("mesaVeteranMustContribute", "Quien ya tiene Bubui debe aportar", "Un cliente nuevo aporta instalándose; quien ya la tiene desbloquea su parte haciendo una acción (invitar/reseña).")}
            {chk("mesaNewUserMustContribute", "Quien se instala también debe aportar", "Por defecto, instalarse la app ya desbloquea su parte. Actívalo para exigir además una acción (invitar/reseña) a quien acaba de descargarla. Mete más fricción al recién llegado.")}
            {chk("mesaAutoAdjust", "Auto-ajuste por saturación", "Cuando casi todos ya tienen Bubui, pide algo más (más reseñas/contenido). Recomendado.")}
          </div>

          <div className="pt-1">
            <span className="text-[11px] uppercase tracking-wider font-bold text-black/45">Acciones que vale hacer (para quien ya tiene Bubui):</span>
            <div className="grid sm:grid-cols-2 gap-1.5 mt-1">
              {chk("mesaActShare", "Invitar amigos")}
              {chk("mesaActReview", `Reseña en ${platformLabel}`)}
              {chk("mesaActPhoto", "Foto en redes (etiquetando)")}
              {chk("mesaActFollow", "Seguir en redes")}
            </div>
          </div>

          {/* Regalo de próxima visita (alternativa/extra al %) */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-1">
            <label className="text-xs block">
              <span className="block font-semibold mb-1">🎁 Regalo para la próxima visita (opcional)</span>
              <input
                type="text"
                value={v.mesaPerkLabel}
                onChange={(e) => set("mesaPerkLabel", e.target.value)}
                placeholder='Ej. "1 bebida gratis", "1 café gratis", "1 bebida con cada plato"'
                className="w-full px-2 py-1.5 border rounded bg-white"
                maxLength={80}
              />
              <span className="block text-[10px] text-black/50 mt-0.5 leading-tight">
                Si lo rellenas, al completar los pasos extra (compartir/reseña) cada comensal recibe este regalo como <b>cupón para su próxima visita</b> — el incentivo que les llega por push para volver. Déjalo vacío si solo quieres dar % de descuento.
              </span>
            </label>
          </div>

          {/* ── Simulador ── */}
          <div className="rounded-xl border-2 border-pink-200 bg-pink-50/50 p-4 space-y-3">
            <div className="font-bold text-sm">🔮 Simulador</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label>
                <span className="block font-semibold mb-1">Comensales en la mesa</span>
                <input type="number" min={1} max={50} value={simDiners} onChange={(e) => setSimDiners(Number(e.target.value) || 0)} className="w-full px-2 py-1.5 border rounded bg-white" />
              </label>
              <label>
                <span className="block font-semibold mb-1">Importe de la cuenta (€)</span>
                <input type="number" min={0} value={simTicket} onChange={(e) => setSimTicket(Number(e.target.value) || 0)} className="w-full px-2 py-1.5 border rounded bg-white" />
              </label>
            </div>

            {/* Lo que ve el cliente + Lo que ganas tú — JUNTOS y llamativo */}
            <div className="rounded-xl border-2 border-emerald-300 bg-gradient-to-b from-emerald-50 to-white p-4 space-y-3 shadow-sm">
              {/* Lo que ve el cliente */}
              <div className="space-y-1">
                <div className="text-sm font-black uppercase tracking-wide text-black/55">Lo que ve el cliente</div>
                {!quorum ? (
                  <p className="text-sm">Sois {simDiners}. <b>Juntaos {v.mesaMinDiners}</b> para activar el descuento de mesa.</p>
                ) : (
                  <>
                    <p className="text-3xl font-black text-emerald-600">¡Os ahorráis {eur(pctNow)}€!</p>
                    <p className="text-xs text-black/65">
                      Mesa de {simDiners} → <b>{pctNow}%</b> ahora (pagáis {Math.round((simTicket - eur(pctNow)) * 100) / 100}€).
                      {pctNext > 0 && <> Y completad los pasos para <b>+{eur(pctNext)}€</b> en vuestra próxima visita.</>}
                    </p>
                    {maxPot > pctNow + pctNext && (
                      <p className="text-[11px] text-amber-600 font-semibold">Hasta {eur(maxPot)}€ ({maxPot}%) si lo completáis todo.</p>
                    )}
                    {perk && (
                      <p className="text-xs font-semibold text-amber-700">🎁 + {perk} para vuestra próxima visita al completar los pasos.</p>
                    )}
                  </>
                )}
              </div>

              <div className="border-t border-emerald-200" />

              {/* Lo que ganas tú */}
              <div className="space-y-1">
                <div className="text-sm font-black uppercase tracking-wide text-emerald-700">💰 Lo que ganas tú</div>
                {quorum ? (
                  <ul className="text-sm text-black/80 space-y-1.5 leading-snug">
                    <li>🍽️ Llenas una mesa de <b>{simDiners}</b> (cuenta de {simTicket}€) que quizá no habría venido.</li>
                    <li>📲 Los que no tengan Bubui <b>se la instalan</b> → entran en tu red: verán tus <b>banners</b> y recibirán <b>avisos push cuando pasen cerca</b> para atraerlos de vuelta.</li>
                    {v.mesaActShare && <li>👥 Hasta <b>{simDiners * v.mesaVeteranShareFriends} clientes nuevos</b> que <b>instalan la app y se dan de alta</b> (cada uno invita a {v.mesaVeteranShareFriends} para llevarse el descuento).</li>}
                    {v.mesaActReview && <li>⭐ Hasta <b>{simDiners} reseñas</b> nuevas en {platformLabel}.</li>}
                    {perk && <li>🎁 Entregas <b>{perk}</b> solo cuando <b>vuelven</b> (cupón de próxima visita) → más recurrencia.</li>}
                    <li>💸 Te cuesta <b>{eur(pctNow)}€</b> de descuento hoy{pctNext > 0 ? ` (+${eur(pctNext)}€ solo si vuelven)` : ""}.</li>
                  </ul>
                ) : (
                  <p className="text-xs text-black/55">Sube el nº de comensales en el simulador para ver el efecto.</p>
                )}
              </div>
            </div>

            {/* Pasos y el descuento de cada uno */}
            <div className="rounded-lg bg-white border p-3 space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider font-bold text-black/40">Pasos para el descuento máximo</div>
              <ol className="text-xs text-black/75 space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="bg-emerald-100 text-emerald-700 font-black rounded px-1.5 shrink-0">{v.mesaBasePct}%</span>
                  <span><b>En el restaurante:</b> juntaos {v.mesaMinDiners}+ y escanead el QR de la mesa. (<b>{eur(v.mesaBasePct)}€</b>)</span>
                </li>
                {v.mesaActShare && v.mesaShareBonusPct > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="bg-pink-100 text-pink-700 font-black rounded px-1.5 shrink-0">+{v.mesaShareBonusPct}%</span>
                    <span><b>Compartir la app:</b> cada uno invita a {v.mesaVeteranShareFriends} amigo{v.mesaVeteranShareFriends === 1 ? "" : "s"} que <b>instale Bubui y se dé de alta</b>. (<b>{eur(v.mesaShareBonusPct)}€</b>)</span>
                  </li>
                )}
                {v.mesaActReview && v.mesaReviewBonusPct > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="bg-amber-100 text-amber-700 font-black rounded px-1.5 shrink-0">+{v.mesaReviewBonusPct}%</span>
                    <span><b>Reseña:</b> os dejan una reseña en {platformLabel}. (<b>{eur(v.mesaReviewBonusPct)}€</b>)</span>
                  </li>
                )}
                {perk && (
                  <li className="flex items-start gap-2">
                    <span className="bg-amber-100 text-amber-700 font-black rounded px-1.5 shrink-0">🎁</span>
                    <span><b>Regalo:</b> al completar los pasos, {perk} como cupón para la <b>próxima visita</b>.</span>
                  </li>
                )}
                <li className="text-[11px] text-black/50 pl-1">
                  {v.mesaBonusOnThisVisit
                    ? "Los extras se aplican en esta misma cuenta."
                    : "¿No completan los pasos en el local? Les llega un push para hacerlos y el extra queda como cupón para su PRÓXIMA visita → vuelven."}
                </li>
              </ol>
            </div>
          </div>
        </>
      )}
      {status && <p className="text-xs text-emerald-700">{status}</p>}
      <button onClick={save} disabled={saving} className="bubui-btn w-full text-sm py-2">
        {saving ? "Guardando…" : "Guardar Mesa Colectiva"}
      </button>
    </section>
  );
}

/** Descuentos por ACCIÓN — el núcleo de Bubui para comercio y servicios.
 *  Reúne en un sitio los % que ya soporta el modelo (escaneo, reto de
 *  compartir, reseña, cupón cruzado) con copy orientado a la acción, para que
 *  el comercio no tenga que montar un catálogo. */
function DiscountsConfig({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [newCust, setNewCust] = useState<number>(business.newCustomerDiscountPct ?? business.defaultDiscountPct ?? 5);
  const [cross, setCross] = useState<number>(business.crossDiscountPct ?? 10);
  const [review, setReview] = useState<number>(business.reviewRewardPct ?? 8);
  const [sharePct, setSharePct] = useState<number>(business.shareOfferPct ?? 10);
  const [shareFriends, setShareFriends] = useState<number>(business.shareOfferFriends ?? 5);
  const [shareLabel, setShareLabel] = useState<string>(business.shareOfferLabel ?? "");
  const [followPct, setFollowPct] = useState<number>(business.ppFollowDiscountPct ?? 5);
  const [photoPct, setPhotoPct] = useState<number>(business.ppPhotoDiscountPct ?? 5);
  const [ppEnabled, setPpEnabled] = useState<boolean>(business.postPurchasePushEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          newCustomerDiscountPct: Number(newCust),
          crossDiscountPct: Number(cross),
          reviewRewardPct: Number(review),
          shareOfferPct: Number(sharePct),
          shareOfferFriends: Number(shareFriends),
          shareOfferLabel: shareLabel.trim() || null,
          ppFollowDiscountPct: Number(followPct),
          ppPhotoDiscountPct: Number(photoPct),
          postPurchasePushEnabled: ppEnabled
        })
      });
      setStatus(r.ok ? "Guardado ✓" : "Error al guardar.");
      if (r.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bubui-card p-5 space-y-3">
      <div>
        <h3 className="font-bold text-sm">💸 Tus descuentos por acción</h3>
        <p className="text-xs text-black/55 mt-0.5">
          Define qué descuento se lleva el cliente según lo que hace. Esto es lo que mueve Bubui.
        </p>
      </div>

      {/* Cliente NUEVO: descuento de bienvenida al instalar Bubui y comprar */}
      <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">🆕 Cliente nuevo (instala Bubui y compra)</div>
          <p className="text-[12px] text-black/55">Descuento de bienvenida para quien escanea tu QR, se instala Bubui y compra por primera vez. Es lo que le anima a darse de alta.</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input type="number" min={3} max={90} value={newCust} onChange={(e) => setNewCust(Number(e.target.value))} className="w-16 px-2 py-1.5 border rounded bg-white text-right" />
          <span className="text-sm font-bold">%</span>
        </div>
      </div>

      {/* Aviso: el recurrente NO cobra por escanear */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
        🔁 <b>El cliente que ya tiene Bubui no recibe descuento solo por escanear.</b> Lo gana realizando una de estas acciones o con un cupón de otro negocio de la zona 👇
      </div>

      {/* Reto compartir */}
      <div className="rounded-xl border border-black/10 p-3 space-y-2">
        <div>
          <div className="font-semibold text-sm">🚀 Reto: comparte Bubui (descuento mayor)</div>
          <p className="text-[12px] text-black/55">Descuento más alto que el cliente desbloquea al compartir Bubui y traer amigos nuevos. 0 = desactivado.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="block">
            <span className="block text-black/60 mb-1">Descuento %</span>
            <input type="number" min={0} max={90} value={sharePct} onChange={(e) => setSharePct(Number(e.target.value))} className="w-full px-2 py-1.5 border rounded bg-white" />
          </label>
          <label className="block">
            <span className="block text-black/60 mb-1">Amigos a traer</span>
            <input type="number" min={1} max={20} value={shareFriends} onChange={(e) => setShareFriends(Number(e.target.value))} className="w-full px-2 py-1.5 border rounded bg-white" />
          </label>
          <label className="block">
            <span className="block text-black/60 mb-1">o texto</span>
            <input value={shareLabel} onChange={(e) => setShareLabel(e.target.value)} placeholder="Ej: Producto gratis" className="w-full px-2 py-1.5 border rounded bg-white" />
          </label>
        </div>
      </div>

      {/* Reseña */}
      <div className="rounded-xl border border-black/10 p-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">⭐ Por dejar una reseña</div>
          <p className="text-[12px] text-black/55">Descuento extra (una sola vez) por reseñar tu negocio. 0 = desactivado.</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input type="number" min={0} max={90} value={review} onChange={(e) => setReview(Number(e.target.value))} className="w-16 px-2 py-1.5 border rounded bg-white text-right" />
          <span className="text-sm font-bold">%</span>
        </div>
      </div>

      {/* Seguir en redes */}
      <div className="rounded-xl border border-black/10 p-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">📷 Por seguirte en redes (IG/FB)</div>
          <p className="text-[12px] text-black/55">Descuento por seguir tu Instagram/Facebook. 0 = desactivado.</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input type="number" min={0} max={90} value={followPct} onChange={(e) => setFollowPct(Number(e.target.value))} className="w-16 px-2 py-1.5 border rounded bg-white text-right" />
          <span className="text-sm font-bold">%</span>
        </div>
      </div>

      {/* Subir foto/historia */}
      <div className="rounded-xl border border-black/10 p-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">🤳 Por subir una foto/historia</div>
          <p className="text-[12px] text-black/55">Descuento por compartir una foto o historia etiquetando tu negocio. 0 = desactivado.</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input type="number" min={0} max={90} value={photoPct} onChange={(e) => setPhotoPct(Number(e.target.value))} className="w-16 px-2 py-1.5 border rounded bg-white text-right" />
          <span className="text-sm font-bold">%</span>
        </div>
      </div>

      {/* Cupón cruzado */}
      <div className="rounded-xl border border-black/10 p-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">🔁 Cupón cruzado de otros negocios</div>
          <p className="text-[12px] text-black/55">Descuento para clientes que llegan con un cupón de otro comercio Bubui de la zona.</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input type="number" min={3} max={90} value={cross} onChange={(e) => setCross(Number(e.target.value))} className="w-16 px-2 py-1.5 border rounded bg-white text-right" />
          <span className="text-sm font-bold">%</span>
        </div>
      </div>

      {/* Interruptor del recordatorio post-compra */}
      <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
        <label className="flex items-start gap-2 text-xs font-semibold cursor-pointer">
          <input type="checkbox" checked={ppEnabled} onChange={(e) => setPpEnabled(e.target.checked)} className="mt-0.5 accent-pink-600" />
          <span>
            ⏰ Recordatorio post-compra (a la hora)
            <span className="block font-normal text-black/55 mt-0.5">
              Una hora después de una compra, enviamos al cliente un aviso para que haga una de las acciones de arriba y gane su descuento para la próxima visita. Actívalo cuando quieras empezar a usarlo.
            </span>
          </span>
        </label>
      </div>

      {status && <p className="text-xs text-emerald-700">{status}</p>}
      <button onClick={save} disabled={saving} className="bubui-btn w-full text-sm py-2">
        {saving ? "Guardando…" : "Guardar descuentos"}
      </button>
    </section>
  );
}

/** Catálogo de productos (nicho comercio_producto). */
function ProductCatalog({ businessId, token }: { businessId: string; token: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", priceEur: "", stock: "", description: "", imageUrl: "" });
  const [busy, setBusy] = useState(false);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  async function load() {
    const r = await fetch(`/api/bubui/business/${businessId}/products`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/bubui/business/${businessId}/products`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: form.name.trim(),
          priceEur: form.priceEur ? Number(form.priceEur) : null,
          stock: form.stock ? Number(form.stock) : null,
          description: form.description.trim() || null,
          imageUrl: form.imageUrl.trim() || null
        })
      });
      if (r.ok) { setForm({ name: "", priceEur: "", stock: "", description: "", imageUrl: "" }); load(); }
    } finally {
      setBusy(false);
    }
  }
  async function toggle(p: any) {
    await fetch(`/api/bubui/business/${businessId}/products/${p.id}`, { method: "PATCH", headers, body: JSON.stringify({ active: !p.active }) });
    load();
  }
  async function del(p: any) {
    if (!confirm(`¿Borrar "${p.name}"?`)) return;
    await fetch(`/api/bubui/business/${businessId}/products/${p.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    load();
  }

  return (
    <section className="bubui-card p-5 space-y-3">
      <div>
        <h3 className="font-bold text-sm">🛍️ Catálogo de productos</h3>
        <p className="text-xs text-black/55 mt-0.5">Tus productos aparecen en tu página pública de Bubui.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del producto" className="px-2 py-1.5 border rounded bg-white text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input value={form.priceEur} onChange={(e) => setForm({ ...form, priceEur: e.target.value })} placeholder="Precio €" type="number" className="px-2 py-1.5 border rounded bg-white text-sm" />
          <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="Stock (opcional)" type="number" className="px-2 py-1.5 border rounded bg-white text-sm" />
        </div>
        <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="URL de la foto (opcional)" className="px-2 py-1.5 border rounded bg-white text-sm sm:col-span-2" />
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción (opcional)" className="px-2 py-1.5 border rounded bg-white text-sm sm:col-span-2" />
      </div>
      <button onClick={add} disabled={busy || !form.name.trim()} className="bubui-btn w-full text-sm py-2 disabled:opacity-50">
        {busy ? "Añadiendo…" : "Añadir producto"}
      </button>
      <div className="space-y-1.5">
        {items.length === 0 && <p className="text-xs text-black/45">Aún no tienes productos.</p>}
        {items.map((p) => (
          <div key={p.id} className={`flex items-center gap-2 border rounded-lg p-2 text-sm ${p.active ? "" : "opacity-50"}`}>
            {p.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt={p.name} className="w-10 h-10 rounded object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{p.name}</div>
              <div className="text-[11px] text-black/55">{p.priceEur != null ? `${p.priceEur}€` : "sin precio"}{p.stock != null ? ` · ${p.stock} uds` : ""}</div>
            </div>
            <button onClick={() => toggle(p)} className="text-[11px] px-2 py-1 rounded border">{p.active ? "Ocultar" : "Mostrar"}</button>
            <button onClick={() => del(p)} className="text-[11px] px-2 py-1 rounded border text-rose-600">Borrar</button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Reservas: servicios ofertados + activar citas online (nicho servicios). */
function ServicesConfig({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(business.bookingEnabled ?? false);
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", unit: "", priceEur: "" });
  const [busy, setBusy] = useState(false);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  async function load() {
    const r = await fetch(`/api/bubui/business/${business.id}/services`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveEnabled(next: boolean) {
    setEnabled(next);
    await fetch(`/api/bubui/business/${business.id}/profile`, { method: "PATCH", headers, body: JSON.stringify({ bookingEnabled: next }) });
    onSaved();
  }
  async function add() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/services`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: form.name.trim(), unit: form.unit.trim() || null, priceEur: form.priceEur ? Number(form.priceEur) : null })
      });
      if (r.ok) { setForm({ name: "", unit: "", priceEur: "" }); load(); }
    } finally {
      setBusy(false);
    }
  }
  async function del(s: any) {
    if (!confirm(`¿Borrar "${s.name}"?`)) return;
    await fetch(`/api/bubui/business/${business.id}/services/${s.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    load();
  }

  return (
    <section className="bubui-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm">📅 Reservas / Citas</h3>
          <p className="text-xs text-black/55 mt-0.5">Activa las citas online y define tus servicios. Los clientes piden cita desde tu ficha y tú la confirmas.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold shrink-0">
          <input type="checkbox" checked={enabled} onChange={(e) => saveEnabled(e.target.checked)} />
          Activas
        </label>
      </div>
      {enabled && (
        <>
          <div className="grid sm:grid-cols-3 gap-2">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Servicio (ej. Corte, Pintar habitación, Plan mensual)" className="px-2 py-1.5 border rounded bg-white text-sm" />
            <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Unidad (ej. 30 min, por sesión, /mes)" className="px-2 py-1.5 border rounded bg-white text-sm" />
            <input value={form.priceEur} onChange={(e) => setForm({ ...form, priceEur: e.target.value })} placeholder="Precio €" type="number" className="px-2 py-1.5 border rounded bg-white text-sm" />
          </div>
          <button onClick={add} disabled={busy || !form.name.trim()} className="bubui-btn w-full text-sm py-2 disabled:opacity-50">{busy ? "Añadiendo…" : "Añadir servicio"}</button>
          <div className="space-y-1.5">
            {items.length === 0 && <p className="text-xs text-black/45">Aún no tienes servicios.</p>}
            {items.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border rounded-lg p-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{s.name}</div>
                  <div className="text-[11px] text-black/55">{s.unit && String(s.unit).trim() ? s.unit : `${s.durationMin} min`}{s.priceEur != null ? ` · ${s.priceEur}€` : ""}</div>
                </div>
                <button onClick={() => del(s)} className="text-[11px] px-2 py-1 rounded border text-rose-600">Borrar</button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Citas recibidas: confirmar o cancelar. */
function BookingsPanel({ businessId, token }: { businessId: string; token: string }) {
  const [items, setItems] = useState<any[]>([]);
  async function load() {
    const r = await fetch(`/api/bubui/business/${businessId}/bookings`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }
  useEffect(() => {
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function setStatus(id: string, status: string) {
    await fetch(`/api/bubui/business/${businessId}/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status })
    });
    load();
  }
  const pend = items.filter((b) => b.status !== "cancelled");
  if (pend.length === 0) return null;
  return (
    <section className="bubui-card p-5 space-y-2">
      <h3 className="font-bold text-sm">📅 Citas ({pend.length})</h3>
      {pend.map((b) => (
        <div key={b.id} className={`border rounded-lg p-2.5 text-xs space-y-1 ${b.status === "confirmed" ? "border-emerald-300 bg-emerald-50/40" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold">{b.customerName} · {b.customerPhone}</span>
            <span className={`px-1.5 py-0.5 rounded ${b.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{b.status === "confirmed" ? "confirmada" : "pendiente"}</span>
          </div>
          <div className="text-black/60">{new Date(b.startsAt).toLocaleString("es-ES")}{b.service ? ` · ${b.service.name}` : ""}{b.notes ? ` · ${b.notes}` : ""}</div>
          <div className="flex gap-2 pt-0.5">
            {b.status !== "confirmed" && <button onClick={() => setStatus(b.id, "confirmed")} className="bubui-btn text-[11px] py-1 px-2">Confirmar</button>}
            <button onClick={() => setStatus(b.id, "cancelled")} className="text-[11px] py-1 px-2 border rounded text-rose-600">Cancelar</button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Autocompletar redes y reseñas con IA (+ datos reales) y verificar. */
function AutofillProfile({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  // Tripadvisor solo tiene sentido en restauración/hoteles → según el nicho.
  const FIELDS: { key: string; label: string; ph: string }[] = [
    { key: "googlePlaceId", label: "Google (Place ID para reseñas)", ph: "ChIJ…" },
    { key: "instagramUrl", label: "Instagram", ph: "https://instagram.com/…" },
    { key: "facebookUrl", label: "Facebook", ph: "https://facebook.com/…" },
    { key: "tiktokUrl", label: "TikTok", ph: "https://tiktok.com/@…" },
    { key: "trustpilotUrl", label: "Trustpilot", ph: "https://trustpilot.com/review/…" },
    ...(business.businessType === "restaurante"
      ? [{ key: "tripadvisorUrl", label: "Tripadvisor", ph: "https://tripadvisor.es/…" }]
      : [])
  ];
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, business[f.key] ?? ""]))
  );
  const [sources, setSources] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function autofill() {
    setLoading(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/autofill`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setStatus(d?.error?.message ?? "No se pudo autocompletar."); return; }
      const dr = d.draft ?? {};
      setVals((v) => ({
        ...v,
        googlePlaceId: dr.googlePlaceId || v.googlePlaceId,
        instagramUrl: dr.instagramUrl || v.instagramUrl,
        facebookUrl: dr.facebookUrl || v.facebookUrl,
        tiktokUrl: dr.tiktokUrl || v.tiktokUrl,
        trustpilotUrl: dr.trustpilotUrl || v.trustpilotUrl,
        tripadvisorUrl: dr.tripadvisorUrl || v.tripadvisorUrl
      }));
      setSources(dr.sources ?? {});
      setStatus("Revisa y corrige lo que haga falta, luego guarda. ✨");
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f.key, vals[f.key].trim() || null])))
      });
      setStatus(r.ok ? "Guardado ✅" : "Error al guardar.");
      if (r.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }
  const srcLabel: Record<string, string> = { places: "Google", web: "tu web", ia: "IA (verifica)" };

  return (
    <section className="bubui-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-sm">🔗 Redes y reseñas</h3>
          <p className="text-xs text-black/55 mt-0.5">La IA las busca por ti a partir de tus datos y tu web. Revísalas y guarda.</p>
        </div>
        <button onClick={autofill} disabled={loading} className="bubui-btn text-xs py-2 px-3 shrink-0 disabled:opacity-50">
          {loading ? "Buscando…" : "✨ Autocompletar con IA"}
        </button>
      </div>
      <div className="space-y-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-xs">
            <span className="font-medium flex items-center gap-1.5">
              {f.label}
              {sources[f.key] && <span className="text-[10px] px-1.5 rounded bg-black/5 text-black/50">{srcLabel[sources[f.key]] ?? sources[f.key]}</span>}
            </span>
            <input
              value={vals[f.key]}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.ph}
              className="mt-1 w-full px-2 py-1.5 border rounded bg-white font-mono text-[12px]"
            />
          </label>
        ))}
      </div>
      {status && <p className="text-xs text-emerald-700">{status}</p>}
      <button onClick={save} disabled={saving} className="bubui-btn w-full text-sm py-2 disabled:opacity-50">
        {saving ? "Guardando…" : "Guardar redes y reseñas"}
      </button>
    </section>
  );
}

/** Mesas abiertas para verificar y canjear (vista del camarero/dueño). */
function MesaTablesPanel({ businessId, token }: { businessId: string; token: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [tickets, setTickets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/bubui/business/${businessId}/tables`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }
  useEffect(() => {
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function redeem(sessionId: string) {
    const amount = Number(tickets[sessionId]);
    if (!amount || amount <= 0) { setMsg("Pon el importe del ticket."); return; }
    setBusy(sessionId);
    setMsg(null);
    try {
      const r = await fetch(`/api/bubui/business/${businessId}/table/${sessionId}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticketAmount: amount })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg(`✓ Aplicado ${d.appliedPct}% (pagan ${d.payNow}€). ${d.nextVisitPct > 0 ? `Cupón próxima visita ${d.nextVisitPct}% a ${d.couponsCreated} comensales.` : ""}`);
        load();
      } else {
        setMsg(d?.error?.message ?? "Error");
      }
    } finally {
      setBusy(null);
    }
  }

  async function cancelTable(sessionId: string) {
    if (!confirm("¿Eliminar esta mesa activa? Se cerrará sin aplicar descuento (úsalo si se quedó colgada por error).")) return;
    setBusy(sessionId);
    setMsg(null);
    try {
      const r = await fetch(`/api/bubui/business/${businessId}/table/${sessionId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg("✓ Mesa eliminada.");
        load();
      } else {
        setMsg(d?.error?.message ?? "No se pudo eliminar la mesa.");
      }
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return null;
  return (
    <section className="bubui-card p-5 space-y-3">
      <h3 className="font-bold text-sm">🍽️ Mesas activas ({items.length})</h3>
      {msg && <p className="text-xs text-emerald-700">{msg}</p>}
      {items.map((t) => (
        <div key={t.id} className="border rounded-lg p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Mesa {t.tableLabel || t.code} · {t.diners} comensales</span>
            <span className={`px-1.5 py-0.5 rounded ${t.everyonePaidEntry ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {t.everyonePaidEntry ? `${t.pctNow}% listo` : `Falta ${t.pendingContributors} por aportar`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Importe ticket €"
              value={tickets[t.id] ?? ""}
              onChange={(e) => setTickets((s) => ({ ...s, [t.id]: e.target.value }))}
              className="flex-1 px-2 py-1.5 border rounded bg-white"
            />
            <button
              onClick={() => redeem(t.id)}
              disabled={busy === t.id || !t.everyonePaidEntry}
              className="bubui-btn text-xs py-1.5 px-3 disabled:opacity-50"
              title={t.everyonePaidEntry ? "Aplicar el descuento" : "Aún faltan aportes en la mesa"}
            >
              {busy === t.id ? "…" : "Verificar y aplicar"}
            </button>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => cancelTable(t.id)}
              disabled={busy === t.id}
              className="text-[11px] text-black/45 hover:text-rose-600 disabled:opacity-50"
              title="Eliminar esta mesa (si se quedó colgada por error)"
            >
              🗑️ Eliminar mesa
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Generador de fotos pro con IA: el dueño describe el ambiente/estilo y
 *  recibe una portada lista para "Guardar como mi imagen de portada".
 *  Gated por plan != "free". */
function AiPhotoStudio({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string>(business.name ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPayment, setNeedsPayment] = useState(false);
  const [saved, setSaved] = useState(false);

  // Estado de uso: el admin decide cuántos banners son GRATIS (freeCount).
  // Mientras used < freeCount es gratis; después hace falta un crédito (1€
  // cada uno) que se compra por Stripe.
  const used: number = business.aiBannerUsed ?? 0;
  const credits: number = business.aiBannerCredits ?? 0;
  const freeCount: number = business.aiBannerFreeCount ?? 1;
  const remainingFree = Math.max(0, freeCount - used);
  const isFree = remainingFree > 0;
  const canGenerateNow = isFree || credits > 0;
  // El admin puede limitar el Banner IA a planes de pago (gate también en API).
  const paidOnly: boolean = business.aiBannerPaidOnly ?? false;
  const isPaid = business.plan === "pro" || business.plan === "premium";
  const planBlocked = paidOnly && !isPaid;

  function pickFile(f: File | null) {
    setFile(f);
    setUrl(null);
    setSaved(false);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function generate() {
    if (!file) { setError("Sube una foto del escaparate de tu negocio."); return; }
    if (!name.trim()) { setError("Escribe el nombre de tu negocio."); return; }
    setBusy(true);
    setError(null);
    setUrl(null);
    setSaved(false);
    setNeedsPayment(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim());
      const r = await fetch(`/api/bubui/business/${business.id}/ai-banner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const j = await r.json();
      if (!r.ok) {
        if (j?.error?.needsPayment) setNeedsPayment(true);
        setError(j?.error?.message ?? "No se pudo generar");
        return;
      }
      setUrl(j.url);
      onSaved(); // refresca el contador de usos/créditos
    } catch {
      setError("No se pudo generar el banner. Reintenta.");
    } finally {
      setBusy(false);
    }
  }

  async function payForAnother() {
    setPaying(true);
    setError(null);
    try {
      const r = await fetch(`/api/bubui/stripe/checkout-ai-banner`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: business.id })
      });
      const j = await r.json();
      if (!r.ok || !j?.url) {
        setError(j?.error?.message ?? "No se pudo iniciar el pago.");
        return;
      }
      window.location.href = j.url; // Stripe Checkout
    } finally {
      setPaying(false);
    }
  }

  async function useAsCover() {
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ logoUrl: url })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error?.message ?? "No se pudo guardar como portada");
        return;
      }
      setSaved(true);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bubui-card p-5 space-y-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full">
        <h3 className="font-bold text-sm flex items-center gap-2">
          🖼️ Banner IA · Crea tu portada desde una foto
          {isFree ? (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
              {remainingFree} GRATIS
            </span>
          ) : (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">1€/edición</span>
          )}
        </h3>
        <span className="text-xs text-black/55">{open ? "Cerrar" : "Abrir"}</span>
      </button>
      {open && planBlocked && (
        <p className="text-xs text-rose-700 font-semibold">
          El Banner IA está disponible solo para planes Pro o Premium. Mejora tu plan para usarlo.
        </p>
      )}
      {open && !planBlocked && (
        <>
          {/* Aviso destacado de cómo funciona y el coste */}
          <div className="text-xs rounded-lg border border-pink-200 bg-pink-50/70 p-3 space-y-1">
            <p className="font-bold text-pink-700">Cómo funciona</p>
            <p>
              1) Sube una <b>foto del escaparate</b> de tu negocio. 2) Escribe el <b>nombre</b> tal y
              como quieres que aparezca. La IA mejora la foto y le pone tu nombre, lista para portada.
            </p>
            <p className="text-pink-700 font-semibold">
              {freeCount > 0 ? (
                <>
                  ⚠️ Tienes <b>{remainingFree}</b> de <b>{freeCount}</b> banner(s) <b>GRATIS</b> disponibles.
                  Cuando los uses, cada nueva edición cuesta <b>1€</b>. Elige bien la foto antes de generar.
                </>
              ) : (
                <>⚠️ Cada banner cuesta <b>1€</b>. Elige bien la foto antes de generar.</>
              )}
            </p>
            {!isFree && (
              <p className="text-black/60">
                {freeCount > 0 ? <>Ya usaste tus banners gratis. </> : null}
                Créditos disponibles: <b>{credits}</b>.
              </p>
            )}
          </div>

          <label className="block text-xs">
            <span className="block font-semibold mb-1">Nombre de tu negocio (se rotula en el banner)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Cafetería La Plaza"
              maxLength={60}
              className="w-full px-2 py-1.5 border rounded bg-white"
              disabled={busy}
            />
          </label>

          <label className="block text-xs">
            <span className="block font-semibold mb-1">Foto del escaparate de tu negocio</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs"
            />
          </label>

          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Escaparate" className="w-full max-h-40 object-cover rounded-lg border" />
          )}

          {canGenerateNow ? (
            <button
              onClick={generate}
              disabled={busy || !file || !name.trim()}
              className="bubui-btn w-full text-sm py-2 disabled:opacity-50"
            >
              {busy ? "Generando… (30-90s)" : isFree ? "✨ Generar mi banner GRATIS" : "✨ Generar (gastar 1 crédito)"}
            </button>
          ) : (
            <button
              onClick={payForAnother}
              disabled={paying}
              className="bubui-btn w-full text-sm py-2 disabled:opacity-50"
            >
              {paying ? "Abriendo el pago…" : "Pagar 1€ y generar otra edición"}
            </button>
          )}

          {error && (
            <div className="space-y-2">
              <p className="text-xs text-rose-700">{error}</p>
              {needsPayment && (
                <button
                  onClick={payForAnother}
                  disabled={paying}
                  className="bubui-btn w-full text-xs py-2 disabled:opacity-50"
                >
                  {paying ? "Abriendo el pago…" : "Pagar 1€ y generar otra edición"}
                </button>
              )}
            </div>
          )}

          {url && (
            <div className="space-y-2 pt-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Banner generado" className="w-full rounded-lg border" />
              {saved ? (
                <p className="text-xs text-emerald-700 font-semibold">✅ Guardado como tu portada. Ya se ve en tu ficha pública.</p>
              ) : (
                <div className="flex gap-2">
                  <button onClick={useAsCover} disabled={busy} className="bubui-btn flex-1 text-xs py-2">
                    Guardar como mi portada
                  </button>
                  <a href={url} download="bubui-banner.png" className="px-3 py-2 rounded-full border text-xs font-semibold inline-flex items-center">
                    Descargar
                  </a>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Engagement automático: cumpleaños + ruleta al escanear el QR. Solo para
 *  planes Pro/Premium (la API de PATCH acepta los campos pero el cron solo
 *  procesa negocios de plan pago, y la ruleta queda inactiva con plan free
 *  desde el mismo componente). */
function EngagementConfig({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const paid = business.plan === "pro" || business.plan === "premium";
  const [bdEnabled, setBdEnabled] = useState<boolean>(business.birthdayEnabled ?? false);
  const [bdPct, setBdPct] = useState<number>(business.birthdayDiscountPct ?? 15);
  const [bdMsg, setBdMsg] = useState<string>(business.birthdayMessage ?? "");
  const [wEnabled, setWEnabled] = useState<boolean>(business.wheelEnabled ?? false);
  const [wMin, setWMin] = useState<number>(business.wheelMinPct ?? 3);
  const [wMax, setWMax] = useState<number>(business.wheelMaxPct ?? 20);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          birthdayEnabled: bdEnabled,
          birthdayDiscountPct: Number(bdPct),
          birthdayMessage: bdMsg.trim() || null,
          wheelEnabled: wEnabled,
          wheelMinPct: Number(wMin),
          wheelMaxPct: Number(wMax)
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus(j?.error?.message ?? "Error al guardar.");
        return;
      }
      setStatus("Guardado.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bubui-card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm flex items-center gap-2">
          ⚡ Engagement automático
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">PREMIUM</span>
        </h3>
        <p className="text-xs text-black/55 mt-0.5">
          Cumpleaños + ruleta al escanear el QR. Solo se aplican si tu plan es Pro o Premium.
        </p>
      </div>

      {/* Cumpleaños */}
      <div className="border-t pt-3">
        <label className="flex items-center justify-between gap-2 text-sm">
          <div>
            <div className="font-semibold">🎂 Cupón de cumpleaños</div>
            <div className="text-xs text-black/55">
              El día del cumpleaños del cliente (los que vinieron por tu QR) recibe push + email con un cupón especial.
            </div>
          </div>
          <input type="checkbox" checked={bdEnabled} onChange={(e) => setBdEnabled(e.target.checked)} />
        </label>
        {bdEnabled && (
          <div className="mt-2 grid sm:grid-cols-3 gap-2 text-xs">
            <label>
              <span className="block font-medium mb-1">% descuento</span>
              <input
                type="number"
                min={3}
                max={50}
                value={bdPct}
                onChange={(e) => setBdPct(Number(e.target.value))}
                className="w-full px-2 py-1.5 border rounded bg-white"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="block font-medium mb-1">Mensaje opcional</span>
              <input
                value={bdMsg}
                onChange={(e) => setBdMsg(e.target.value)}
                placeholder="Ej. Ven a celebrarlo con nosotros 🎈"
                className="w-full px-2 py-1.5 border rounded bg-white"
              />
            </label>
          </div>
        )}
      </div>

      {/* Ruleta */}
      <div className="border-t pt-3">
        <label className="flex items-center justify-between gap-2 text-sm">
          <div>
            <div className="font-semibold">🎰 Ruleta al escanear</div>
            <div className="text-xs text-black/55">
              En vez del % fijo por escanear el QR, el cliente gira y le sale un % aleatorio entre min y max.
            </div>
          </div>
          <input type="checkbox" checked={wEnabled} onChange={(e) => setWEnabled(e.target.checked)} />
        </label>
        {wEnabled && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <label>
              <span className="block font-medium mb-1">% mínimo</span>
              <input
                type="number"
                min={0}
                max={90}
                value={wMin}
                onChange={(e) => setWMin(Number(e.target.value))}
                className="w-full px-2 py-1.5 border rounded bg-white"
              />
            </label>
            <label>
              <span className="block font-medium mb-1">% máximo</span>
              <input
                type="number"
                min={0}
                max={90}
                value={wMax}
                onChange={(e) => setWMax(Number(e.target.value))}
                className="w-full px-2 py-1.5 border rounded bg-white"
              />
            </label>
          </div>
        )}
      </div>

      {!paid && (
        <p className="text-[11px] text-rose-700">
          Estás en plan Free — al guardar, los toggles quedarán guardados pero no se aplicarán hasta que subas a Pro o Premium.
        </p>
      )}
      {status && <p className="text-xs text-emerald-700">{status}</p>}
      <button onClick={save} disabled={saving} className="bubui-btn w-full text-sm py-2">
        {saving ? "Guardando…" : "Guardar engagement"}
      </button>
    </section>
  );
}

/** Pin destacado en mapa/Descubre + slot patrocinado en el feed. Gated por
 *  plan != "free". */
function PromotionPanel({ business, token, onChanged }: { business: any; token: string; onChanged: () => void }) {
  const paid = business.plan === "pro" || business.plan === "premium";
  const [featured, setFeatured] = useState<boolean>(business.featured ?? false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<{ quota: number; usedThisMonth: number; remaining: number; active: any | null } | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/bubui/business/${business.id}/sponsored`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!cancelled && r.ok) setSponsor(await r.json());
    })();
    return () => { cancelled = true; };
  }, [business.id, token]);

  async function toggleFeatured() {
    if (!paid) return;
    setBusy("featured");
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/featured`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ featured: !featured })
      });
      const j = await r.json();
      if (!r.ok) {
        setStatus(j?.error?.message ?? "Error");
        return;
      }
      setFeatured(j.featured);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function launchSlot() {
    if (!paid) return;
    if (!title.trim() || !body.trim()) {
      setStatus("Rellena título y cuerpo.");
      return;
    }
    setBusy("slot");
    setStatus(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/sponsored`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: title.trim(), body: body.trim() })
      });
      const j = await r.json();
      if (!r.ok) {
        setStatus(j?.error?.message ?? "Error");
        return;
      }
      setStatus(`Slot activo. Te quedan ${j.remaining} este mes.`);
      setTitle("");
      setBody("");
      // refresca estado
      const r2 = await fetch(`/api/bubui/business/${business.id}/sponsored`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r2.ok) setSponsor(await r2.json());
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bubui-card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm flex items-center gap-2">
          ⭐ Visibilidad
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">PREMIUM</span>
        </h3>
      </div>

      {/* Pin destacado */}
      <div className="border-t pt-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">📍 Pin destacado en mapa y Descubre</div>
          <div className="text-xs text-black/55">
            Apareces primero, con borde rosa, al abrir el mapa o la sección "Descubre".
          </div>
        </div>
        <button
          onClick={toggleFeatured}
          disabled={!paid || busy === "featured"}
          className={"px-3 py-1.5 rounded-full text-xs font-bold border " + (featured ? "bg-pink-500 text-white border-pink-500" : "bg-white border-black/15") + (!paid ? " opacity-50 cursor-not-allowed" : "")}
        >
          {featured ? "Activado" : "Activar"}
        </button>
      </div>

      {/* Sponsored slot */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">📣 Slot patrocinado (24h)</div>
            <div className="text-xs text-black/55">
              Tu negocio aparece como "hero" del feed de clientes de tu ciudad durante 24h.
            </div>
          </div>
          {sponsor && (
            <span className="text-[11px] font-bold text-black/55">
              {sponsor.usedThisMonth}/{sponsor.quota} este mes
            </span>
          )}
        </div>
        {sponsor?.active && (
          <div className="rounded-lg bg-pink-50 border border-pink-200 p-2 text-xs">
            <b>Activo ahora:</b> {sponsor.active.title} · acaba el{" "}
            {new Date(sponsor.active.endsAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
          </div>
        )}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título corto (máx 60)"
          className="w-full px-2 py-1.5 border rounded bg-white text-xs"
          disabled={!paid}
          maxLength={60}
        />
        <textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Mensaje (máx 180)"
          className="w-full px-2 py-1.5 border rounded bg-white text-xs"
          disabled={!paid}
          maxLength={180}
        />
        <button
          onClick={launchSlot}
          disabled={!paid || busy === "slot" || (sponsor != null && sponsor.remaining <= 0)}
          className="bubui-btn w-full text-sm py-2 disabled:opacity-50"
        >
          {busy === "slot" ? "Activando…" : "Activar 24h"}
        </button>
      </div>

      {!paid && (
        <p className="text-[11px] text-rose-700 border-t pt-2">
          Disponible con Pro (1 slot/mes) o Premium (4 slots/mes).
        </p>
      )}
      {status && <p className="text-xs text-emerald-700">{status}</p>}
    </section>
  );
}

/** Analítica premium: cohortes + heatmap. Fetch lazy al abrir. */
function PremiumAnalytics({ businessId, token, plan }: { businessId: string; token: string; plan: string }) {
  const paid = plan === "pro" || plan === "premium";
  const [cohorts, setCohorts] = useState<any[] | null>(null);
  const [heatmap, setHeatmap] = useState<{ grid: number[][]; max: number; total: number; sinceDays: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [c, h] = await Promise.all([
        fetch(`/api/bubui/business/${businessId}/cohorts`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/bubui/business/${businessId}/heatmap`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (c.ok) setCohorts((await c.json()).cohorts);
      if (h.ok) setHeatmap(await h.json());
      if (!c.ok || !h.ok) setError("No se pudo cargar la analítica.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && paid && !cohorts) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <section className="bubui-card p-5 space-y-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full">
        <h3 className="font-bold text-sm flex items-center gap-2">
          📊 Analítica avanzada
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">PREMIUM</span>
        </h3>
        <span className="text-xs text-black/55">{open ? "Cerrar" : "Abrir"}</span>
      </button>
      {!paid && open && (
        <p className="text-xs text-rose-700">Cohortes y heatmap requieren plan Pro o Premium.</p>
      )}
      {paid && open && (
        <>
          {loading && <p className="text-xs text-black/55">Cargando…</p>}
          {error && <p className="text-xs text-rose-700">{error}</p>}

          {/* Heatmap día×hora */}
          {heatmap && (
            <div className="border-t pt-3">
              <div className="text-xs font-bold uppercase tracking-wider text-black/45 mb-2">
                Hora pico / valle · últimos {heatmap.sinceDays} días ({heatmap.total} compras)
              </div>
              <div className="overflow-x-auto">
                <table className="text-[10px] border-separate" style={{ borderSpacing: 2 }}>
                  <thead>
                    <tr>
                      <th></th>
                      {Array.from({ length: 24 }).map((_, h) => (
                        <th key={h} className="text-black/40 font-normal w-5 text-center">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((label, d) => (
                      <tr key={d}>
                        <td className="text-black/55 pr-1 font-semibold">{label}</td>
                        {Array.from({ length: 24 }).map((_, h) => {
                          const v = heatmap.grid[d][h];
                          const intensity = heatmap.max > 0 ? v / heatmap.max : 0;
                          const bg = v === 0
                            ? "#F3F4F6"
                            : `rgba(236, 72, 153, ${0.15 + intensity * 0.85})`;
                          return (
                            <td
                              key={h}
                              className="w-5 h-5 rounded text-center"
                              style={{ background: bg }}
                              title={`${label} ${h}:00 → ${v} compras`}
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-black/45 mt-1">
                Cuanto más rosa, más compras. Las celdas grises son horas sin actividad — ahí mete tus pushes.
              </p>
            </div>
          )}

          {/* Cohortes */}
          {cohorts && cohorts.length > 0 && (
            <div className="border-t pt-3">
              <div className="text-xs font-bold uppercase tracking-wider text-black/45 mb-2">
                Cohortes y retención
              </div>
              <div className="overflow-x-auto">
                <table className="text-[11px]">
                  <thead>
                    <tr className="text-black/45">
                      <th className="pr-2 text-left">Mes</th>
                      <th className="px-2">Clientes</th>
                      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                        <th key={n} className="px-2">M+{n}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((c: any) => (
                      <tr key={c.cohort} className="border-t">
                        <td className="pr-2 py-1 font-semibold">{c.cohort}</td>
                        <td className="px-2 py-1 text-center">{c.size}</td>
                        {[0, 1, 2, 3, 4, 5, 6].map((n) => {
                          const b = c.buckets.find((x: any) => x.offset === n);
                          if (!b) return <td key={n} className="px-2 py-1 text-black/25 text-center">·</td>;
                          const pct = b.pct;
                          const bg = pct === 0 ? "#F3F4F6" : `rgba(236, 72, 153, ${0.15 + (pct / 100) * 0.85})`;
                          return (
                            <td key={n} className="px-2 py-1 text-center" style={{ background: bg }}>
                              {pct > 0 ? `${pct}%` : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-black/45 mt-1">
                Cada fila = clientes que entraron por primera vez ese mes. M+1 = % de ellos que volvió al mes siguiente.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ShareWidget({ slug, name, discountPct }: { slug: string; name: string; discountPct: number }) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const url = origin ? `${origin}/bubui/n/${slug}` : `/bubui/n/${slug}`;
  const shareText = `${discountPct}% en ${name} con la app Bubui 🎟\nEscanea, paga, y se te abren descuentos en otros negocios cerca.`;
  const fullMessage = `${shareText}\n${url}`;

  async function nativeShare() {
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: `${name} · Bubui`, text: shareText, url });
        return;
      } catch {
        // user cancelled
      }
    }
    // Fallback: copiar.
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const wa = `https://wa.me/?text=${encodeURIComponent(fullMessage)}`;
  const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;

  return (
    <section className="bubui-card p-5 space-y-3">
      <div>
        <h3 className="font-bold text-sm">📣 Comparte tu Bubui</h3>
        <p className="text-xs text-black/55 mt-0.5">
          Cada vez que un cliente entra por tu enlace, te ahorras anuncios y subes karma.
        </p>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-black/10 bg-pink-50/40">
        <span className="text-xs text-black/70 font-mono truncate flex-1">{url || "—"}</span>
        <button
          onClick={copy}
          className="px-3 py-1 rounded-full bg-black text-white text-xs font-bold hover:bg-pink-600 transition"
        >
          {copied ? "✓ Copiado" : "Copiar"}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button onClick={nativeShare} className="bubui-btn text-xs py-2">
          📲 Compartir
        </button>
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-xs py-2 px-3 rounded-full border-2 border-emerald-500 text-emerald-700 font-bold hover:bg-emerald-50 transition"
        >
          WhatsApp
        </a>
        <a
          href={tg}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-xs py-2 px-3 rounded-full border-2 border-sky-500 text-sky-700 font-bold hover:bg-sky-50 transition"
        >
          Telegram
        </a>
        <a
          href={fb}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-xs py-2 px-3 rounded-full border-2 border-blue-600 text-blue-700 font-bold hover:bg-blue-50 transition"
        >
          Facebook
        </a>
      </div>
      <p className="text-[11px] text-black/50">
        💡 Pégalo en tu bio de Instagram, en tu firma de email o en una historia. Cada visita es un cliente potencial.
      </p>
    </section>
  );
}

/** CTA muy llamativo para pedir la pegatina/cartel QR GRATIS: el equipo se
 *  la lleva al local sin coste. Usa POST /request-poster (avisa por email al
 *  equipo y aparece en el admin como "cartel por entregar"). */
function StickerRequest({ business, token, onChanged }: { business: any; token: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState<string>(business.address ?? "");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requested = sent || (!!business.posterDeliveryRequestedAt && !business.posterDeliveredAt);
  if (requested) {
    const waMsg = encodeURIComponent(
      "Hola, he solicitado mi cartel QR Bubui para mi negocio pero todavía no lo he recibido"
    );
    const waUrl = `https://wa.me/34680167881?text=${waMsg}`;
    return (
      <div className="mt-3 space-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
          ✅ Pegatina solicitada — te la llevaremos GRATIS a tu local.
        </div>
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-left text-xs font-semibold text-pink-700 bg-pink-50 border border-pink-200 rounded-xl px-3 py-2.5 hover:bg-pink-100 transition"
        >
          ¿Has solicitado que te llevemos el cartel y todavía no lo has recibido? Pincha aquí y solicítalo urgente al equipo de soporte
        </a>
      </div>
    );
  }

  async function send() {
    if (!address.trim()) {
      setError("Indica la dirección de entrega.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/request-poster`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ address: address.trim(), phone: phone.trim() || null, note: note.trim() || null })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setSent(true);
      onChanged();
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bubui-sticker-btn mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-pink-600 to-fuchsia-500 text-white text-sm font-extrabold px-5 py-3 shadow-lg"
      >
        <span className="text-lg" aria-hidden>🎁</span>
        ¡Pide tu pegatina QR GRATIS!
        <span className="font-semibold opacity-90">Te la llevamos al local</span>
      </button>
    );
  }

  return (
    <div className="mt-3 border-2 border-pink-200 bg-pink-50/60 rounded-xl p-4 space-y-2">
      <p className="text-sm font-bold">🎁 Pegatina QR gratis a domicilio</p>
      <p className="text-xs text-slate-600">
        Te llevamos la pegatina con tu QR impresa al local, sin coste. Confirma la dirección:
      </p>
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Dirección del local"
        className="w-full px-2 py-1.5 border rounded bg-white text-sm"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Teléfono de contacto (opcional)"
        className="w-full px-2 py-1.5 border rounded bg-white text-sm"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Horario o nota para la entrega (opcional)"
        className="w-full px-2 py-1.5 border rounded bg-white text-sm"
      />
      {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="px-4 py-2 rounded-full bg-pink-600 hover:bg-pink-700 text-white text-sm font-bold disabled:opacity-60"
        >
          {sending ? "Enviando…" : "Pedir mi pegatina gratis"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Editor de perfil del negocio. Permite cambiar descripción, dirección,
 *  geo coords, logo URL, brand color y los % de descuento. Lo que se
 *  cambie aquí impacta la página pública (/bubui/n/<slug>) y el cartel. */
function ProfileEditor({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    description: business.description ?? "",
    businessType: business.businessType ?? "servicios",
    address: business.address ?? "",
    phone: business.phone ?? "",
    latitude: business.latitude ?? "",
    longitude: business.longitude ?? "",
    logoUrl: business.logoUrl ?? "",
    brandColor: business.brandColor ?? "#FDF2E1",
    purchaseMode: business.purchaseMode ?? "express",
    requireTicket: business.requireTicket ?? false,
    googlePlaceId: business.googlePlaceId ?? "",
    reviewPushEnabled: business.reviewPushEnabled ?? true,
    shareOfferPct: business.shareOfferPct ?? 0,
    shareOfferFriends: business.shareOfferFriends ?? 5,
    shareOfferLabel: business.shareOfferLabel ?? ""
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  /** Sube la foto de portada y deja su URL en el campo (falta Guardar). */
  async function uploadCover(file: File) {
    setUploading(true);
    setStatus(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/bubui/business/${business.id}/upload-photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const j = await r.json();
      if (!r.ok) {
        setStatus({ kind: "err", msg: j?.error?.message ?? `Error ${r.status}` });
        return;
      }
      setForm((f: typeof form) => ({ ...f, logoUrl: j.url }));
      setStatus({ kind: "ok", msg: "Foto subida. Pulsa «Guardar cambios» para aplicarla." });
    } catch {
      setStatus({ kind: "err", msg: "No se pudo subir la foto. Reintenta." });
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const payload: any = {};
      if (form.description !== business.description) payload.description = form.description || null;
      if (form.businessType !== (business.businessType ?? "servicios")) payload.businessType = form.businessType;
      if (form.address !== business.address) payload.address = form.address || null;
      if (form.phone !== (business.phone ?? "")) payload.phone = form.phone || null;
      if (form.latitude !== "" && Number(form.latitude) !== business.latitude) payload.latitude = Number(form.latitude);
      if (form.longitude !== "" && Number(form.longitude) !== business.longitude) payload.longitude = Number(form.longitude);
      if (form.logoUrl !== business.logoUrl) payload.logoUrl = form.logoUrl || null;
      if (form.brandColor !== business.brandColor) payload.brandColor = form.brandColor || null;
      if (form.purchaseMode !== business.purchaseMode) payload.purchaseMode = form.purchaseMode;
      if (form.requireTicket !== (business.requireTicket ?? false)) payload.requireTicket = form.requireTicket;
      if ((form.googlePlaceId || null) !== (business.googlePlaceId || null)) payload.googlePlaceId = form.googlePlaceId.trim() || null;
      if (form.reviewPushEnabled !== (business.reviewPushEnabled ?? true)) payload.reviewPushEnabled = form.reviewPushEnabled;
      if (Number(form.shareOfferPct) !== (business.shareOfferPct ?? 0)) payload.shareOfferPct = Number(form.shareOfferPct);
      if (Number(form.shareOfferFriends) !== (business.shareOfferFriends ?? 5)) payload.shareOfferFriends = Number(form.shareOfferFriends);
      if ((form.shareOfferLabel || null) !== (business.shareOfferLabel || null)) payload.shareOfferLabel = form.shareOfferLabel.trim() || null;
      if (Object.keys(payload).length === 0) {
        setStatus({ kind: "ok", msg: "Sin cambios." });
        return;
      }
      const r = await fetch(`/api/bubui/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) {
        setStatus({ kind: "err", msg: j?.error?.message ?? `Error ${r.status}` });
        return;
      }
      setStatus({ kind: "ok", msg: "Guardado." });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <section className="bg-white border rounded-xl p-5 shadow-sm flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">✏️ Editar perfil</h3>
          <p className="text-xs text-slate-600">
            Tipo de negocio, logo, descripción, dirección, color de marca y % de descuento.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium"
        >
          Abrir editor
        </button>
      </section>
    );
  }

  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">✏️ Editar perfil</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">Cerrar</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 text-xs">
        <label>
          <span className="block font-medium mb-1">🏷️ Tipo de negocio</span>
          <select
            value={form.businessType}
            onChange={(e) => setForm({ ...form, businessType: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          >
            <option value="restaurante">Restaurante / hostelería</option>
            <option value="comercio_producto">Comercio (productos)</option>
            <option value="servicios">Servicios</option>
          </select>
          <span className="block text-[11px] text-black/50 mt-1">
            Personaliza tu panel (la Mesa Colectiva aparece en restaurantes).
          </span>
        </label>
        <label>
          <span className="block font-medium mb-1">Descripción</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">Imagen de portada / logo</span>
          <div className="flex items-center gap-2">
            <input
              value={form.logoUrl}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              placeholder="https://… (o sube una foto)"
              className="flex-1 min-w-0 px-2 py-1.5 border rounded bg-white"
            />
            <label
              className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer transition ${
                uploading ? "bg-pink-200 text-pink-500" : "bg-pink-600 text-white hover:bg-pink-700"
              }`}
            >
              {uploading ? "Subiendo…" : "📷 Subir foto"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadCover(f);
                }}
              />
            </label>
          </div>
          {form.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.logoUrl} alt="Portada" className="mt-2 w-full max-h-36 object-cover rounded border" />
          ) : null}
          <span className="block text-[11px] text-black/50 mt-1">
            Se muestra como portada de tu ficha pública. Recuerda pulsar «Guardar cambios».
          </span>
        </label>
        <label className="sm:col-span-2">
          <span className="block font-medium mb-1">Dirección</span>
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="block font-medium mb-1">Teléfono de contacto</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="+34 600 000 000"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
          <span className="block text-[11px] text-black/50 mt-1">
            Aparece como botón «Llamar» en la app. Déjalo vacío si no quieres mostrarlo.
          </span>
        </label>
        <label>
          <span className="block font-medium mb-1">Latitud</span>
          <input
            type="number"
            step="any"
            value={form.latitude}
            onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">Longitud</span>
          <input
            type="number"
            step="any"
            value={form.longitude}
            onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">Color de marca</span>
          <input
            type="color"
            value={form.brandColor}
            onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
            className="w-full h-9 border rounded bg-white"
          />
        </label>
        <label className="sm:col-span-2 flex items-start gap-2 rounded-lg border border-pink-200 bg-pink-50/60 p-3">
          <input
            type="checkbox"
            checked={!!form.requireTicket}
            onChange={(e) => setForm({ ...form, requireTicket: e.target.checked })}
            className="mt-0.5"
          />
          <span className="text-xs">
            <b>Requerir foto del ticket (anti-fraude).</b> El cliente tendrá que fotografiar el ticket
            al escanear y el importe lo lee la IA automáticamente (no se teclea). Evita que se inflen
            importes. Si la IA no puede leerlo, el cliente lo escribe pero el ticket queda guardado.
          </span>
        </label>
        <label className="sm:col-span-2">
          <span className="block font-medium mb-1">Google Place ID (Google My Business)</span>
          <input
            value={form.googlePlaceId}
            onChange={(e) => setForm({ ...form, googlePlaceId: e.target.value })}
            placeholder="Ej. ChIJN1t_tDeuEmsRUsoyG83frY4"
            className="w-full px-2 py-1.5 border rounded bg-white font-mono text-[11px]"
          />
          <span className="block text-[10px] text-slate-500 mt-0.5">
            Habilita el botón "Compártela también en Google" tras la reseña. Encuéntralo en{" "}
            <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer" className="text-pink-600 hover:underline">
              Place ID Finder
            </a>.
          </span>
        </label>
      </div>
      <p className="text-[11px] text-slate-500">
        Consejo: si no sabes lat/lng, búscalo en Google Maps (clic derecho → coordenadas). Sin coordenadas no se puede activar el geofencing ni el anti-fraude.
      </p>
      {status && (
        <p className={"text-xs " + (status.kind === "ok" ? "text-emerald-700" : "text-rose-700")}>
          {status.msg}
        </p>
      )}
      <button
        onClick={save}
        disabled={saving}
        className="w-full py-2 rounded-full bg-pink-500 hover:bg-pink-600 text-white text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Guardar cambios"}
      </button>
    </section>
  );
}

/** Panel "Cruces" — muestra a qué negocios el actual envía clientes y de
 *  cuáles recibe. Esto es el dato más valioso de Bubui: la red de tráfico
 *  cruzado que ningún Meta/Google sabe ver. */
function CrossShopperPanel({ businessId, token }: { businessId: string; token: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/bubui/business/${businessId}/cross-shopper`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [businessId, token]);
  if (loading) {
    return <div className="bg-white border rounded-xl p-5 shadow-sm text-sm text-slate-500">Calculando cruces…</div>;
  }
  if (!data) return null;
  const s = data.summary;
  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm">🔁 Red de cruces</h3>
          <p className="text-xs text-slate-600">A quién mandas clientes y quién te los manda a ti.</p>
        </div>
        <div className="text-xs text-slate-600">
          <span className="font-semibold text-pink-600">{s.conversionPct}%</span> de tus cupones se canjean
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <SmallStat label="Cupones generados" value={s.cuponesGenerados} />
        <SmallStat label="Canjeados (otros)" value={s.canjeadosPorOtros} />
        <SmallStat label="Recibidos canjeados" value={s.cuponesRecibidosCanjeados} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold text-slate-700 mb-2">📤 Mandas clientes a</h4>
          {data.sentTo.length === 0 ? (
            <p className="text-xs text-slate-500">Aún sin datos. Cuando un cliente que compre aquí canjee en otro negocio, aparecerá.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.sentTo.slice(0, 6).map((r: any) => (
                <li key={r.business.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">
                    <span className="font-medium">{r.business.name}</span>
                    <span className="text-slate-400 ml-1">{r.business.category}</span>
                  </span>
                  <span className="text-pink-600 font-semibold whitespace-nowrap ml-2">
                    {r.redeemed}/{r.total} · {r.conversionPct}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-700 mb-2">📥 Recibes clientes de</h4>
          {data.receivedFrom.length === 0 ? (
            <p className="text-xs text-slate-500">Aún sin datos. Cuando un cliente con cupón cruzado venga aquí, aparecerá.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.receivedFrom.slice(0, 6).map((r: any) => (
                <li key={r.business.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">
                    <span className="font-medium">{r.business.name}</span>
                    <span className="text-slate-400 ml-1">{r.business.category}</span>
                  </span>
                  <span className="text-emerald-700 font-semibold whitespace-nowrap ml-2">
                    +{r.redeemed}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function SmallStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-slate-50 border p-2 text-center">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

/** Lista de ventajas del plan Premium. La ficha de Google My Business es el
 *  producto estrella: para un negocio local es lo que más le mueve la aguja. */
function PremiumFeatures() {
  return (
    <div className="mt-2 space-y-2">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-amber-700">
          <span aria-hidden>🌟</span> Producto estrella
        </div>
        <div className="mt-0.5 text-sm font-bold text-slate-800">Crecimiento de tu ficha de Google My Business</div>
        <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
          <li className="flex gap-1.5"><span className="text-emerald-600">✔</span> Intensificamos la petición de reseñas a los clientes que compran en tu local</li>
          <li className="flex gap-1.5"><span className="text-emerald-600">✔</span> Gestionamos las respuestas a todas tus reseñas (positivas y negativas)</li>
          <li className="flex gap-1.5"><span className="text-emerald-600">✔</span> Trabajamos tu ficha para mejorar tu posicionamiento en Google</li>
        </ul>
      </div>
      <ul className="space-y-1 text-xs text-slate-700">
        <li className="flex gap-1.5"><span className="text-amber-500">⭐</span> <span><b>Referido prioritario</b> y destacado cuando un cliente compra en otro negocio Bubui</span></li>
        <li className="flex gap-1.5"><span className="text-emerald-600">✔</span> 4 push gratis al mes</li>
        <li className="flex gap-1.5"><span className="text-emerald-600">✔</span> -25% en push extra</li>
        <li className="flex gap-1.5"><span className="text-emerald-600">✔</span> AI Studio y analítica avanzada</li>
        <li className="flex gap-1.5"><span className="text-emerald-600">✔</span> Soporte prioritario</li>
      </ul>
    </div>
  );
}

function PlanCard({ business, token, onChanged }: { business: any; token: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const cancelAt: string | null = business.subscriptionCancelAt ?? null;
  const expiresAt: string | null = business.planExpiresAt ?? null;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

  async function upgrade(plan: "pro" | "premium") {
    setBusy(plan);
    try {
      const r = await fetch("/api/bubui/stripe/checkout-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: business.id, plan })
      });
      const j = await r.json();
      if (!r.ok || !j.url) {
        alert(j?.error?.message ?? "No se pudo crear el checkout");
        return;
      }
      window.location.href = j.url;
    } finally {
      setBusy(null);
    }
  }

  async function cancelSub(resume: boolean) {
    if (!resume && !confirm("¿Seguro que quieres cancelar tu suscripción? Conservarás las ventajas hasta el final del periodo ya pagado.")) {
      return;
    }
    setBusy(resume ? "resume" : "cancel");
    try {
      const r = await fetch(`/api/bubui/business/${business.id}/cancel-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ resume })
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j?.error?.message ?? "No se pudo procesar la solicitud");
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm">Tu plan: <span className="text-pink-600 capitalize">{business.plan}</span></h3>
          <p className="text-xs text-slate-600">
            {business.plan === "free"
              ? "Aparece en feed (según karma). Sube de plan para destacar y recibir más clientes."
              : cancelAt
                ? `Tu suscripción se cancelará el ${fmt(cancelAt)}. Hasta entonces conservas las ventajas.`
                : expiresAt
                  ? `Activa. Se renueva el ${fmt(expiresAt)}.`
                  : "Tienes ventajas Pro/Premium activas."}
          </p>
        </div>
      </div>
      {business.plan === "free" && (
        <div className="grid sm:grid-cols-2 gap-3 mt-3 items-start">
          <button
            onClick={() => upgrade("pro")}
            disabled={busy !== null}
            className="text-left p-3 rounded-lg border border-pink-300 hover:bg-pink-50 disabled:opacity-50"
          >
            <div className="font-semibold">⭐ Pro · 29€/mes</div>
            <div className="text-xs text-slate-600 mt-1">+ 1 push gratis/mes · AI Studio · analytics avanzado</div>
            <div className="mt-2 flex gap-1.5 text-xs text-slate-700">
              <span className="text-amber-500">⭐</span>
              <span><b>Referido prioritario:</b> tu negocio destaca sobre el resto cuando un cliente compra en otro negocio Bubui.</span>
            </div>
          </button>
          <button
            onClick={() => upgrade("premium")}
            disabled={busy !== null}
            className="relative text-left p-4 rounded-xl border-2 border-rose-400 bg-gradient-to-br from-rose-50 to-fuchsia-50 hover:from-rose-100 hover:to-fuchsia-100 disabled:opacity-50 shadow-sm"
          >
            <span className="absolute -top-2.5 right-3 text-[10px] font-extrabold uppercase tracking-wide text-white bg-rose-500 rounded-full px-2 py-0.5 shadow">Recomendado</span>
            <div className="font-bold text-rose-700">🔥 Premium · 99€/mes</div>
            <PremiumFeatures />
          </button>
        </div>
      )}
      {business.plan === "pro" && (
        <div className="mt-3">
          <button
            onClick={() => upgrade("premium")}
            disabled={busy !== null}
            className="relative w-full text-left p-4 rounded-xl border-2 border-rose-400 bg-gradient-to-br from-rose-50 to-fuchsia-50 hover:from-rose-100 hover:to-fuchsia-100 disabled:opacity-50 shadow-sm"
          >
            <span className="absolute -top-2.5 right-3 text-[10px] font-extrabold uppercase tracking-wide text-white bg-rose-500 rounded-full px-2 py-0.5 shadow">Subir a Premium</span>
            <div className="font-bold text-rose-700">🔥 Premium · 99€/mes</div>
            <PremiumFeatures />
          </button>
        </div>
      )}
      {business.plan !== "free" && (
        <div className="mt-3 border-t pt-3">
          {cancelAt ? (
            <button
              onClick={() => cancelSub(true)}
              disabled={busy !== null}
              className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
            >
              {busy === "resume" ? "Reactivando…" : "Reactivar suscripción"}
            </button>
          ) : (
            <button
              onClick={() => cancelSub(false)}
              disabled={busy !== null}
              className="text-xs text-slate-500 hover:text-rose-600 hover:underline disabled:opacity-50"
            >
              {busy === "cancel" ? "Cancelando…" : "Cancelar suscripción"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PushAdForm({ businessId, businessName, token, plan }: { businessId: string; businessName: string; token: string; plan: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);
  const [radiusKm, setRadiusKm] = useState(1);
  const [quote, setQuote] = useState<{ reach: number; priceEur: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // AI Studio state
  const [brief, setBrief] = useState("");
  const [vibe, setVibe] = useState<"cercano" | "directo" | "premium" | "divertido">("cercano");
  const [variantes, setVariantes] = useState<any[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  // Vivo Studio (copy IA) es premium: plan de pago O 5 comercios referidos.
  const paid = plan === "pro" || plan === "premium";
  const [referral, setReferral] = useState<{ qualified: number; needed: number } | null>(null);
  const studioUnlocked = paid || (!!referral && referral.qualified >= referral.needed);

  useEffect(() => {
    if (paid) return; // los de pago ya lo tienen, no hace falta consultar referidos
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/bubui/business/${businessId}/business-referral`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (cancelled || !r.ok) return;
      const j = await r.json();
      setReferral({ qualified: j.qualifiedReferrals ?? 0, needed: j.businessesPerReward ?? 5 });
    })();
    return () => { cancelled = true; };
  }, [businessId, token, paid]);

  async function generateCopy() {
    if (!brief.trim()) return;
    setGenerating(true);
    setVariantes(null);
    setLockMsg(null);
    try {
      const r = await fetch("/api/bubui/ai-studio/push-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, productOrOffer: brief.trim(), vibe })
      });
      const j = await r.json();
      if (r.status === 402) { setLockMsg(j?.error?.message ?? "Función premium."); return; }
      if (j.variantes) setVariantes(j.variantes);
    } finally {
      setGenerating(false);
    }
  }
  function pickVariante(v: any) {
    setTitle(v.titulo);
    setBody(v.body);
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch("/api/bubui/push-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, radiusKm })
      });
      if (cancelled) return;
      if (r.ok) setQuote(await r.json());
    })();
    return () => { cancelled = true; };
  }, [businessId, radiusKm]);

  async function uploadImage(file: File) {
    setUploadingImg(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/bubui/business/${businessId}/upload-photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const j = await r.json();
      if (r.ok && j.url) setImageUrl(j.url);
      else alert(j?.error?.message ?? "No se pudo subir la imagen.");
    } catch {
      alert("No se pudo subir la imagen. Reintenta.");
    } finally {
      setUploadingImg(false);
    }
  }

  async function pay() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/bubui/stripe/checkout-push-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, title, body, radiusKm, imageUrl: imageUrl.trim() || null })
      });
      const j = await r.json();
      if (!r.ok || !j.url) {
        alert(j?.error?.message ?? "No se pudo crear el pago");
        return;
      }
      window.location.href = j.url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
      <h3 className="font-semibold text-sm">📣 Push del Día</h3>
      <p className="text-xs text-slate-600">
        Envía una notificación push a clientes Bubui cerca de tu local. 24h activa.
      </p>

      {/* AI Studio — copy automático (premium: plan de pago o 5 referidos) */}
      <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-violet-900">✨ Vivo Studio · copy automático con IA</div>
          {!studioUnlocked && <span className="text-[10px] font-semibold text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">🔒 Premium</span>}
        </div>
        {!studioUnlocked ? (
          <div className="text-[11px] text-violet-900/80 leading-snug space-y-1">
            <p>El redactor con IA está disponible con <b>plan Pro/Premium</b> o trayendo <b>{referral?.needed ?? 5} comercios referidos</b> con actividad.</p>
            {referral && <p className="text-violet-700">Llevas <b>{referral.qualified}/{referral.needed}</b> comercios referidos. Comparte tu enlace de referido (abajo) para desbloquearlo gratis.</p>}
          </div>
        ) : (
        <>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="¿Qué quieres promocionar? (ej: 30% en cortes hasta las 20h, menú degustación esta noche…)"
          rows={2}
          className="w-full px-2 py-1.5 border rounded text-xs bg-white"
        />
        <div className="flex items-center gap-2">
          <select value={vibe} onChange={(e) => setVibe(e.target.value as any)} className="px-2 py-1 border rounded text-xs bg-white">
            <option value="cercano">Cercano</option>
            <option value="directo">Directo</option>
            <option value="premium">Premium</option>
            <option value="divertido">Divertido</option>
          </select>
          <button
            type="button"
            onClick={generateCopy}
            disabled={generating || !brief.trim()}
            className="px-3 py-1.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {generating ? "Generando…" : "Generar 3 variantes"}
          </button>
        </div>
        {lockMsg && <p className="text-[11px] text-rose-600">{lockMsg}</p>}
        {variantes && (
          <div className="space-y-2 mt-2">
            {variantes.map((v: any, i: number) => (
              <button
                key={i}
                type="button"
                onClick={() => pickVariante(v)}
                className="w-full text-left p-2 rounded-lg border border-violet-200 bg-white hover:bg-violet-50"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-violet-700 uppercase">{v.angulo}</span>
                  <span className="text-[10px] text-slate-500">{v.horarioSugerido}</span>
                </div>
                <div className="text-xs font-semibold text-slate-900">{v.titulo}</div>
                <div className="text-[11px] text-slate-600 mt-0.5">{v.body}</div>
              </button>
            ))}
            <p className="text-[10px] text-slate-500">Toca una variante para usarla.</p>
          </div>
        )}
        </>
        )}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título (ej: ¡Hoy 30% en cortes hasta las 20h!)"
        className="w-full px-3 py-2 border rounded-lg bg-white text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Mensaje del push (1-2 frases con gancho)"
        rows={2}
        className="w-full px-3 py-2 border rounded-lg bg-white text-sm"
      />

      {/* Imagen grande (rich push) — la foto que más llama la atención */}
      <div className="rounded-lg border border-pink-200 bg-pink-50/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-pink-900">🖼️ Imagen del anuncio <span className="font-normal text-pink-700/70">(opcional, recomendada)</span></div>
          {imageUrl && (
            <button type="button" onClick={() => setImageUrl("")} className="text-[10px] font-semibold text-rose-600 hover:underline">
              Quitar
            </button>
          )}
        </div>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Imagen del push" className="w-full max-h-40 object-cover rounded-md border border-black/10" />
        ) : (
          <p className="text-[11px] text-pink-900/70 leading-snug">
            Una foto grande hace que el push destaque mucho más. Se muestra dentro de la notificación.
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://… (o sube una foto)"
            className="flex-1 min-w-0 px-2 py-1.5 border rounded text-xs bg-white"
          />
          <label
            className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer transition ${
              uploadingImg ? "bg-pink-200 text-pink-500" : "bg-pink-600 text-white hover:bg-pink-700"
            }`}
          >
            {uploadingImg ? "Subiendo…" : "📷 Subir"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              disabled={uploadingImg}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadImage(f);
              }}
            />
          </label>
        </div>
      </div>

      {/* Preview en vivo del push */}
      <PushPreview businessName={businessName} title={title} body={body} image={imageUrl} />

      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2">
          Radio:
          <select value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="border rounded px-2 py-1">
            <option value={0.5}>500 m</option>
            <option value={1}>1 km</option>
            <option value={2}>2 km</option>
            <option value={3}>3 km</option>
            <option value={5}>5 km</option>
          </select>
        </label>
        {quote && (
          <div className="text-xs text-slate-600">
            ~{quote.reach} usuarios · <strong className="text-pink-600">{quote.priceEur}€</strong>
          </div>
        )}
      </div>
      <button
        onClick={pay}
        disabled={busy || !title.trim() || !body.trim()}
        className="w-full py-2.5 rounded-full bg-pink-500 hover:bg-pink-600 text-white font-medium disabled:opacity-50"
      >
        {busy ? "Procesando…" : `Pagar y lanzar (${quote?.priceEur ?? "—"} €)`}
      </button>
    </section>
  );
}

/** Mockup visual del push tal y como lo verá el cliente. Doble vista:
 *  iOS (lockscreen card) + Android (banner top). */
function PushPreview({ businessName, title, body, image }: { businessName: string; title: string; body: string; image?: string }) {
  const [mode, setMode] = useState<"ios" | "android">("ios");
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");

  const displayTitle = title.trim() || "Tu título aparecerá aquí";
  const displayBody = body.trim() || "Y tu mensaje justo debajo. Cuanto más concreto, más conversión.";

  return (
    <div className="rounded-xl border border-black/10 bg-gradient-to-br from-slate-50 to-pink-50/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-black/55">
          Preview · cómo lo ve el cliente
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold">
          <button
            type="button"
            onClick={() => setMode("ios")}
            className={"px-2 py-0.5 rounded-full " + (mode === "ios" ? "bg-black text-white" : "text-black/55")}
          >
            iOS
          </button>
          <button
            type="button"
            onClick={() => setMode("android")}
            className={"px-2 py-0.5 rounded-full " + (mode === "android" ? "bg-black text-white" : "text-black/55")}
          >
            Android
          </button>
        </div>
      </div>

      {mode === "ios" ? (
        <div className="bg-white/90 backdrop-blur rounded-2xl px-3.5 py-3 shadow-sm border border-black/5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500 to-pink-600 grid place-items-center text-white font-black text-sm shadow">
              B
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-black/75">BUBUI</div>
                <div className="text-[10px] text-black/45">ahora</div>
              </div>
              <div className="text-[13px] font-bold text-black truncate">{displayTitle}</div>
              <div className="text-[12px] text-black/70 leading-snug line-clamp-2">{displayBody}</div>
            </div>
          </div>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="mt-2.5 w-full h-32 object-cover rounded-xl" />
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg px-3.5 py-2.5 shadow-sm border border-black/5">
          <div className="flex items-center gap-2 text-[10px] text-black/55 font-semibold uppercase tracking-wider mb-1">
            <div className="w-3.5 h-3.5 rounded-sm bg-gradient-to-br from-pink-500 to-pink-600" />
            <span>Bubui · {businessName}</span>
            <span className="ml-auto">{hh}:{mm}</span>
          </div>
          <div className="text-[13px] font-bold text-black">{displayTitle}</div>
          <div className="text-[12px] text-black/70 leading-snug">{displayBody}</div>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="mt-2 w-full h-32 object-cover rounded-lg" />
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <Hint
          ok={displayTitle.length >= 6 && displayTitle.length <= 65 && !!title.trim()}
          label={`Título · ${title.trim().length}/65`}
        />
        <Hint
          ok={displayBody.length >= 20 && displayBody.length <= 140 && !!body.trim()}
          label={`Mensaje · ${body.trim().length}/140`}
        />
      </div>
    </div>
  );
}

function Hint({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={
        "px-2 py-1 rounded font-bold " +
        (ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200")
      }
    >
      {ok ? "✓" : "⚠"} {label}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

/** Gráfica de área SVG (ventas diarias) sobre la tarjeta oscura. */
function SalesChart({ data }: { data: { day: string; total: number }[] }) {
  const W = 320, H = 90, pad = 4;
  if (!data || data.length < 2) {
    return <div className="mt-4 h-[90px] grid place-items-center text-white/30 text-xs">Aún sin ventas para la gráfica</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.total));
  const stepX = (W - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = H - pad - (d.total / max) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="90" className="mt-4 overflow-visible">
      <defs>
        <linearGradient id="salesfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EC4899" stopOpacity="0.55" />
          <stop offset="1" stopColor="#EC4899" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#salesfill)" />
      <path d={line} fill="none" stroke="#F472B6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.5" fill="#fff" />
    </svg>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bubui-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-black/50 font-bold">{label}</div>
      <div className="text-xl font-black mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-black/45">{sub}</div>}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-pink-50/60 border border-pink-100 p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-black/55 font-bold">{label}</div>
      <div className="text-lg font-black mt-0.5">{value}</div>
    </div>
  );
}
