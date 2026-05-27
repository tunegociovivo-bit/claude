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
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Bipi Admin</h1>
          <p className="text-xs text-slate-500">
            Vista global de la red ({data?.scope.city ?? "—"})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Filtrar por ciudad"
            className="px-3 py-1.5 border rounded-lg text-sm bg-white"
          />
          <button
            onClick={() => { localStorage.removeItem("bipi.adminToken"); setToken(null); }}
            className="text-xs text-slate-500 hover:underline"
          >
            Salir
          </button>
        </div>
      </header>

      {error && <div className="text-rose-700 text-sm">{error}</div>}
      {loading && !data && <div className="text-sm text-slate-500">Cargando…</div>}

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Negocios" value={data.summary.businesses} />
            <Stat label="Clientes" value={data.summary.customers} />
            <Stat label="Compras 30d" value={data.summary.purchases30} />
            <Stat label="Cupones 30d" value={data.summary.offers30} />
            <Stat label="Canjes 30d" value={data.summary.offersRedeemed30} />
            <Stat label="Conversion %" value={`${data.summary.conversionPct}%`} />
            <Stat label="Ventas 30d" value={`${(data.summary.revenue30 ?? 0).toFixed(0)} €`} />
            <Stat
              label="Plan distribution"
              value={data.plansBreakdown.map((p) => `${p.plan} ${p.count}`).join(" · ") || "—"}
            />
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">🔥 Top escaneos (7 días)</h2>
            <table className="w-full text-sm bg-white border rounded-xl overflow-hidden">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Negocio</th>
                  <th className="text-left px-3 py-2">Categoría</th>
                  <th className="text-left px-3 py-2">Ciudad</th>
                  <th className="text-left px-3 py-2">Karma</th>
                  <th className="text-right px-3 py-2">Escaneos</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.topByScanning.map((r) => (
                  <tr key={r.business.id}>
                    <td className="px-3 py-2">
                      <a href={`/bipi/n/${r.business.slug ?? r.business.id}`} className="text-amber-700 hover:underline">
                        {r.business.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.business.category}</td>
                    <td className="px-3 py-2 text-slate-500">{r.business.city}</td>
                    <td className="px-3 py-2 text-slate-500">{r.business.visibilityScore}</td>
                    <td className="px-3 py-2 text-right font-semibold">{r.scans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">🎟 Top cupones canjeados recibidos (30 días)</h2>
            <table className="w-full text-sm bg-white border rounded-xl overflow-hidden">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Negocio</th>
                  <th className="text-left px-3 py-2">Categoría</th>
                  <th className="text-left px-3 py-2">Ciudad</th>
                  <th className="text-right px-3 py-2">Canjes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.topByCross.map((r) => (
                  <tr key={r.business.id}>
                    <td className="px-3 py-2">
                      <a href={`/bipi/n/${r.business.slug ?? r.business.id}`} className="text-amber-700 hover:underline">
                        {r.business.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.business.category}</td>
                    <td className="px-3 py-2 text-slate-500">{r.business.city}</td>
                    <td className="px-3 py-2 text-right font-semibold">{r.redeemed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white border rounded-xl p-3 shadow-sm">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}

function TokenForm({ onSet }: { onSet: (t: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-2">Bipi Admin</h1>
      <p className="text-sm text-slate-600 mb-4">
        Introduce el <code>BIPI_ADMIN_TOKEN</code> configurado en Railway.
      </p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Bearer token"
        className="w-full px-3 py-2 border rounded-lg bg-white mb-3"
      />
      <button
        onClick={() => token && onSet(token)}
        className="w-full py-2.5 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-medium"
      >
        Entrar
      </button>
    </main>
  );
}
