"use client";

/**
 * Dashboard admin de Bipi — para Negocio Vivo (operador de la red).
 *
 * Auth simple: el token va en localStorage. Se introduce 1 vez y se queda.
 * Para producción seria conviene migrar a NextAuth con un rol "bipi-admin".
 */

import { useEffect, useState } from "react";

type Overview = {
  scope: { city: string };
  summary: {
    businesses: number;
    customers: number;
    purchases30: number;
    offers30: number;
    offersRedeemed30: number;
    conversionPct: number;
    revenue30: number;
  };
  plansBreakdown: Array<{ plan: string; count: number }>;
  topByScanning: Array<{ business: any; scans: number }>;
  topByCross: Array<{ business: any; redeemed: number }>;
};

export default function BipiAdmin() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem("bipi.adminToken");
      if (t) setToken(t);
    } catch {}
  }, []);

  async function load(t: string, cityFilter: string) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/bipi/admin/overview", window.location.origin);
      if (cityFilter) url.searchParams.set("city", cityFilter);
      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${t}` }
      });
      if (r.status === 401) {
        localStorage.removeItem("bipi.adminToken");
        setToken(null);
        setError("Token no válido.");
        return;
      }
      if (!r.ok) {
        setError(`Error ${r.status}`);
        return;
      }
      setData(await r.json());
    } catch (e: any) {
      setError(e?.message ?? "Error de red");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) load(token, city);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, city]);

  if (!token) {
    return <TokenForm onSet={(t) => { localStorage.setItem("bipi.adminToken", t); setToken(t); }} />;
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <header className="flex items-center justify-between gap-2 flex-wrap bipi-fade-up">
        <div className="flex items-center gap-3">
          <span className="bipi-wordmark" style={{ fontSize: 32 }}>bipi</span>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-black/55">Admin</div>
            <p className="text-[11px] text-black/45">
              Vista global de la red · {data?.scope.city ?? "todas las ciudades"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Filtrar por ciudad"
            className="bipi-input text-sm py-1.5"
            style={{ width: 180 }}
          />
          <button
            onClick={() => { localStorage.removeItem("bipi.adminToken"); setToken(null); }}
            className="text-xs text-black/45 hover:text-black/70 font-semibold"
          >
            Salir
          </button>
        </div>
      </header>

      {error && <div className="text-rose-700 text-sm">{error}</div>}
      {loading && !data && (
        <div className="space-y-3">
          <div className="bipi-skeleton h-28" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="bipi-skeleton h-20" />)}
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Stat hero — ventas de la red */}
          <section className="bipi-card p-6 bipi-fade-up bipi-fade-up-1">
            <div className="flex items-end justify-between flex-wrap gap-4">
              <div className="bipi-stat-hero">
                <div className="label">Ventas de la red · 30d</div>
                <div className="value">{(data.summary.revenue30 ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €</div>
                <div className="sub">
                  {data.summary.conversionPct}% de cupones canjeados · {data.summary.offersRedeemed30}/{data.summary.offers30}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 min-w-[280px]">
                <MiniStat label="Negocios" value={data.summary.businesses} />
                <MiniStat label="Clientes" value={data.summary.customers} />
                <MiniStat label="Compras 30d" value={data.summary.purchases30} />
              </div>
            </div>
            {data.plansBreakdown.length > 0 && (
              <div className="mt-4 pt-4 border-t border-black/5 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-black/45">Planes:</span>
                {data.plansBreakdown.map((p) => (
                  <span key={p.plan} className="bipi-chip" style={{ cursor: "default" }}>
                    {p.plan} · {p.count}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="bipi-card p-5 bipi-fade-up bipi-fade-up-2">
            <h2 className="text-sm font-bold mb-3">🔥 Top escaneos · 7 días</h2>
            <RankTable
              rows={data.topByScanning.map((r) => ({
                business: r.business,
                extra: `Karma ${r.business.visibilityScore}`,
                value: r.scans
              }))}
              valueLabel="escaneos"
              empty="Aún sin escaneos en este periodo."
            />
          </section>

          <section className="bipi-card p-5 bipi-fade-up bipi-fade-up-3">
            <h2 className="text-sm font-bold mb-3">🎟 Top cupones canjeados recibidos · 30 días</h2>
            <RankTable
              rows={data.topByCross.map((r) => ({
                business: r.business,
                extra: r.business.city,
                value: r.redeemed
              }))}
              valueLabel="canjes"
              empty="Aún sin canjes cruzados en este periodo."
            />
          </section>
        </>
      )}
    </main>
  );
}

function RankTable({
  rows,
  valueLabel,
  empty
}: {
  rows: Array<{ business: any; extra: string; value: number }>;
  valueLabel: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-black/50">{empty}</div>;
  }
  return (
    <div className="bipi-table">
      {rows.map((r, i) => (
        <div key={r.business.id} className="row">
          <div className="left min-w-0">
            <div className="avatar">{i + 1}</div>
            <div className="min-w-0">
              <a
                href={`/bipi/n/${r.business.slug ?? r.business.id}`}
                className="name truncate hover:text-pink-600"
              >
                {r.business.name}
              </a>
              <div className="sub truncate">{r.business.category} · {r.extra}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="amount">{r.value}</div>
            <div className="sub">{valueLabel}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-pink-50/60 border border-pink-100 p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-black/55 font-bold">{label}</div>
      <div className="text-lg font-black mt-0.5">{value}</div>
    </div>
  );
}

function TokenForm({ onSet }: { onSet: (t: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-6 bipi-fade-up">
        <span className="bipi-wordmark mx-auto justify-center" style={{ fontSize: 48 }}>bipi</span>
        <div className="text-xs font-bold uppercase tracking-wider text-black/55 mt-2">Admin</div>
      </div>
      <div className="bipi-card p-6 bipi-fade-up bipi-fade-up-1">
        <p className="text-sm text-black/60 mb-4">
          Introduce el <code className="text-pink-600 font-mono text-xs">BIPI_ADMIN_TOKEN</code> configurado en Railway.
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Bearer token"
          className="bipi-input mb-3"
          onKeyDown={(e) => { if (e.key === "Enter" && token) onSet(token); }}
        />
        <button onClick={() => token && onSet(token)} className="bipi-btn w-full">
          Entrar
        </button>
      </div>
    </main>
  );
}
