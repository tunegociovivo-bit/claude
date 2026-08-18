"use client";

/**
 * Portfolio multi-ficha (vista de agencia): todas las ubicaciones con score, reseñas sin responder,
 * citaciones rotas, caída de ranking, contenido vencido, conexión y alertas. Búsqueda/orden/filtros
 * y drill-down. Tenant-scoped (la API filtra por workspace). Estado vacío honesto.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, AlertTriangle } from "lucide-react";

type Row = { clientId: string; name: string; category: string; score: number | null; unreplied: number; brokenCitations: number; rankingDrop: number; contentStaleDays: number | null; connectionOk: boolean; openAlerts: number; criticalAlerts: number };
const CARD = "bg-white rounded-xl border p-4";

const scoreCls = (n: number | null) => n == null ? "text-slate-400" : n >= 75 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-rose-600";

export default function PortfolioView() {
  const [data, setData] = useState<{ totals: any; rows: Row[] } | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("alerts");
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const load = useCallback(() => {
    const p = new URLSearchParams({ sort, dir: sort === "name" ? "asc" : "desc" });
    if (q.trim()) p.set("search", q.trim());
    if (onlyAlerts) p.set("onlyAlerts", "1");
    fetch(`/api/v1/gmb/portfolio?${p}`).then((r) => r.json()).then((d) => setData(d.ok ? d : { totals: {}, rows: [] }));
  }, [q, sort, onlyAlerts]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  if (!data) return <div className="py-16 grid place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const t = data.totals ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        {[["Ubicaciones", t.clients ?? 0], ["Score medio", t.avgScore ?? 0], ["Alertas", t.openAlerts ?? 0], ["Críticas", t.critical ?? 0], ["Sin responder", t.unreplied ?? 0], ["Citaciones rotas", t.brokenCitations ?? 0]].map(([l, v]) => (
          <div key={l as string} className={`${CARD} text-center py-3`}><div className="text-xl font-bold text-slate-800">{v as number}</div><div className="text-[11px] text-slate-400">{l as string}</div></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Search className="h-4 w-4 absolute left-2 top-2.5 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ficha…" className="pl-8 pr-3 py-1.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" /></div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm">
          <option value="alerts">Orden: alertas</option><option value="score">Score</option><option value="unreplied">Sin responder</option><option value="citations">Citaciones rotas</option><option value="name">Nombre</option>
        </select>
        <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} className="accent-brand-600" />Solo con alertas</label>
      </div>

      {data.rows.length === 0 ? (
        <div className={`${CARD} text-center py-12 text-sm text-slate-500`}>No hay fichas que mostrar. Crea o importa fichas para ver el portfolio de la agencia.</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>
              <th className="text-left px-3 py-2.5">Ficha</th><th className="text-left px-3 py-2.5">Score</th><th className="text-left px-3 py-2.5">Sin resp.</th><th className="text-left px-3 py-2.5">Citac.</th><th className="text-left px-3 py-2.5">Rank↓</th><th className="text-left px-3 py-2.5">Contenido</th><th className="text-left px-3 py-2.5">Conexión</th><th className="text-left px-3 py-2.5">Alertas</th>
            </tr></thead>
            <tbody className="divide-y">
              {data.rows.map((r) => (
                <tr key={r.clientId} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium max-w-xs truncate" title={r.name}>{r.name}{r.category ? <span className="ml-1 text-[10px] text-slate-400">{r.category}</span> : null}</td>
                  <td className={`px-3 py-2 font-bold ${scoreCls(r.score)}`}>{r.score ?? "—"}</td>
                  <td className={`px-3 py-2 ${r.unreplied > 0 ? "text-amber-700" : "text-slate-400"}`}>{r.unreplied || "—"}</td>
                  <td className={`px-3 py-2 ${r.brokenCitations > 0 ? "text-rose-700" : "text-slate-400"}`}>{r.brokenCitations || "—"}</td>
                  <td className={`px-3 py-2 ${r.rankingDrop > 0 ? "text-rose-700" : "text-slate-400"}`}>{r.rankingDrop || "—"}</td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">{r.contentStaleDays == null ? "sin posts" : r.contentStaleDays >= 30 ? <span className="text-amber-700">{r.contentStaleDays}d</span> : `${r.contentStaleDays}d`}</td>
                  <td className="px-3 py-2">{r.connectionOk ? <span className="text-emerald-600 text-xs">ok</span> : <span className="text-rose-600 text-xs">caída</span>}</td>
                  <td className="px-3 py-2">{r.openAlerts > 0 ? <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${r.criticalAlerts > 0 ? "bg-rose-100 text-rose-700" : "bg-amber-50 text-amber-700"}`}><AlertTriangle className="h-3 w-3" />{r.openAlerts}</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
