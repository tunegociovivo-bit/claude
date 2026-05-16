"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Search, Sparkles } from "lucide-react";

type Counts = { TASK: number; CLIENT: number; PROJECT: number; DOCUMENT: number };

export default function BusquedaClient({
  indexed,
  totals
}: {
  indexed: Counts;
  totals: Counts;
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  async function reindex(type?: keyof Counts) {
    setRunning(type ?? "ALL");
    const tag = type ?? "todo";
    try {
      const r = await fetch("/api/v1/admin/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type ? { entityTypes: [type], limit: 500 } : { limit: 500 })
      });
      const data = await r.json();
      const summary = Object.entries(data.counts ?? {})
        .map(([k, v]: any) => `${k}: ${v.indexed} indexados, ${v.skipped} saltados`)
        .join(" · ");
      setLog((prev) => [`[${new Date().toLocaleTimeString("es-ES")}] ${tag} → ${summary}`, ...prev]);
    } catch (e: any) {
      setLog((prev) => [`[${new Date().toLocaleTimeString("es-ES")}] error: ${e?.message ?? e}`, ...prev]);
    } finally {
      setRunning(null);
    }
  }

  async function trySearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/v1/search/semantic?q=${encodeURIComponent(query)}&topK=10`);
      const data = await r.json();
      setResults(data.items ?? []);
    } finally {
      setSearching(false);
    }
  }

  const types: (keyof Counts)[] = ["TASK", "CLIENT", "PROJECT", "DOCUMENT"];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3 text-slate-900 inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" />
          Cobertura del índice
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {types.map((t) => {
            const ratio = totals[t] === 0 ? 0 : indexed[t] / totals[t];
            const pct = Math.round(ratio * 100);
            return (
              <div key={t} className="rounded-lg border p-3">
                <div className="text-xs text-slate-500 uppercase tracking-wide">{t}</div>
                <div className="text-xl font-semibold mt-0.5">
                  {indexed[t]} <span className="text-sm text-slate-400">/ {totals[t]}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded mt-2 overflow-hidden">
                  <div
                    className={
                      "h-full " + (pct === 100 ? "bg-emerald-500" : pct > 50 ? "bg-amber-500" : "bg-rose-500")
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <button
                  onClick={() => reindex(t)}
                  disabled={running !== null}
                  className="mt-3 inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline disabled:opacity-50"
                >
                  {running === t ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Indexar
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            "Indexar" sólo gasta tokens en lo que ha cambiado desde el último embedding. Llamadas posteriores son baratas.
          </p>
          <button
            onClick={() => reindex()}
            disabled={running !== null}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs disabled:opacity-50"
          >
            {running === "ALL" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reindexar todo
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="bg-white rounded-xl border p-4 text-xs font-mono text-slate-700 space-y-1 max-h-48 overflow-auto">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3 text-slate-900 inline-flex items-center gap-2">
          <Search className="h-4 w-4 text-brand-600" />
          Probar búsqueda semántica
        </h2>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && trySearch()}
            placeholder="¿Qué decidimos sobre el rebranding de Acme?"
            className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={trySearch}
            disabled={searching || !query.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </button>
        </div>
        {results.length > 0 && (
          <ul className="mt-3 divide-y">
            {results.map((r, i) => (
              <li key={`${r.kind}-${r.id}-${i}`} className="py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono uppercase tracking-wide text-slate-400">{r.kind}</span>
                  <span className="font-medium text-slate-900">{r.title}</span>
                  <span className="text-slate-400 ml-auto">score {r.score?.toFixed(3) ?? "-"}</span>
                </div>
                {r.snippet && <p className="text-xs text-slate-600 mt-0.5">{r.snippet}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
