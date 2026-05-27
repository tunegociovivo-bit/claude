"use client";

/**
 * Panel del negocio Bipi. Vive en /bipi/negocio.
 *
 * Si no hay sesión guardada (localStorage `bipi.business`), muestra el
 * login. Si la hay, muestra el dashboard con compras pendientes a
 * confirmar y métricas básicas.
 */

import { useEffect, useState } from "react";

type Session = { businessId: string; name: string; token: string };

export default function NegocioPanel() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("bipi.business");
      if (raw) setSession(JSON.parse(raw));
    } catch {}
  }, []);

  if (!session) {
    return <LoginForm onLogin={(s) => { setSession(s); localStorage.setItem("bipi.business", JSON.stringify(s)); }} />;
  }
  return (
    <Dashboard
      session={session}
      onLogout={() => { setSession(null); localStorage.removeItem("bipi.business"); }}
    />
  );
}

function LoginForm({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/bipi/business/login", {
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
      <h1 className="text-2xl font-bold mb-2">Panel del negocio</h1>
      <p className="text-slate-600 mb-6 text-sm">Entra con tu email y contraseña.</p>
      <form onSubmit={submit} className="space-y-3 bg-white border rounded-xl p-5 shadow-sm">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-3 py-2 border rounded-lg bg-white"
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full px-3 py-2 border rounded-lg bg-white"
        />
        {error && <p className="text-rose-700 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-medium disabled:opacity-50"
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <p className="text-xs text-slate-500 text-center">
          ¿Aún no tienes cuenta? <a href="/bipi/registro" className="text-amber-700 underline">Crea tu negocio</a>
        </p>
      </form>
    </main>
  );
}

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/bipi/business/${session.businessId}/dashboard`);
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // Auto-refresh pendientes cada 10s
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(purchaseId: string, action: "confirm" | "reject") {
    setConfirming(purchaseId);
    try {
      const r = await fetch("/api/bipi/purchase/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId, businessId: session.businessId, action })
      });
      if (!r.ok) {
        const j = await r.json();
        alert(j?.error?.message ?? `Error ${r.status}`);
      }
      await load();
    } finally {
      setConfirming(null);
    }
  }

  if (loading || !data) return <main className="max-w-3xl mx-auto px-4 py-12">Cargando…</main>;
  const b = data.business;
  const m = data.metrics;

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{b.name}</h1>
          <p className="text-xs text-slate-500">
            {b.category} · {b.city} · Plan {b.plan} · Karma {b.visibilityScore}/100
          </p>
        </div>
        <button onClick={onLogout} className="text-xs text-slate-500 hover:underline">Cerrar sesión</button>
      </div>

      {/* Métricas */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Escaneos 7d" value={m.scans7} />
        <Metric label="Escaneos 30d" value={m.scans30} />
        <Metric label="Ventas Bipi 7d" value={`${(m.revenue7 ?? 0).toFixed(0)} €`} />
        <Metric label="Cupones recibidos 7d" value={m.redeemedFromOthers7} sub="desde otros negocios" />
      </section>

      {/* QR descargable */}
      <section className="bg-white border rounded-xl p-5 shadow-sm flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={b.qrPngUrl} alt="QR" className="w-32 h-32 border rounded" />
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Tu QR</h3>
          <p className="text-xs text-slate-600 mb-2">Imprímelo y ponlo en la caja. Cada escaneo sube tu karma y te hace más visible.</p>
          <a href={b.qrPngUrl} download className="text-sm text-amber-700 hover:underline">Descargar PNG →</a>
        </div>
      </section>

      {/* Pendientes */}
      <section>
        <h3 className="font-semibold mb-2">Compras pendientes ({data.pending.length})</h3>
        {data.pending.length === 0 ? (
          <div className="bg-white border rounded-xl p-6 text-center text-sm text-slate-500">
            Sin compras pendientes. Cuando un cliente escanee, aparecerá aquí.
          </div>
        ) : (
          <div className="space-y-2">
            {data.pending.map((p: any) => (
              <div key={p.id} className="bg-white border rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{p.amount.toFixed(2)} € · {p.discountPct}% off</div>
                  <div className="text-xs text-slate-500">
                    {p.customer.name ?? p.customer.email} · {new Date(p.scannedAt).toLocaleTimeString("es-ES")}
                    {p.offerRedeemed && <span className="ml-2 text-emerald-700">🎟 cupón cruzado</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => act(p.id, "reject")}
                    disabled={confirming === p.id}
                    className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                  <button
                    onClick={() => act(p.id, "confirm")}
                    disabled={confirming === p.id}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
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
