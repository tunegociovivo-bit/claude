"use client";

/**
 * Cazador de Subvenciones: actualiza el catálogo de convocatorias abiertas
 * (BDNS) y cruza cada cliente con las que le encajan (IA).
 */
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, RefreshCw, Landmark, Search, ExternalLink } from "lucide-react";

type Convo = { id: string; titulo: string; organo: string | null; regiones: string | null; importeTotal: number | null; fechaFin: string | null; urlBases: string | null };
type Match = Convo & { fitScore: number; motivo: string; requisitos: string };
type Status = { abiertas: number; total: number; ultimaActualizacion: string | null; convocatorias: Convo[]; clients: { id: string; name: string }[] };

const eur = (n: number | null) => (n ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n) : "—");
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-ES") : "Sin plazo fijo");

export default function SubvencionesAdmin() {
  const [s, setS] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [clientId, setClientId] = useState("");
  const [matching, setMatching] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/subvenciones");
      if (r.ok) setS(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function ingest() {
    setIngesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/subvenciones/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`❌ ${j?.error?.message ?? "Error"}`);
      else if (j.skipped) setMsg(`⏳ ${j.message}`);
      else setMsg(`✅ ${j.upserted} convocatorias actualizadas${typeof j.fueraDeFoco === "number" ? ` · ${j.fueraDeFoco} descartadas por foco regional` : ""}.`);
      await load();
    } finally {
      setIngesting(false);
    }
  }

  async function buscar(force = false) {
    if (!clientId) return;
    setMatching(true);
    setMatches(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/admin/subvenciones/match?clientId=${encodeURIComponent(clientId)}${force ? "&refresh=1" : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`❌ ${j?.error?.message ?? "Error"}`);
      else setMatches(j.matches ?? []);
    } finally {
      setMatching(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Cazador de Subvenciones IA"
        description="Convocatorias públicas abiertas (BDNS) cruzadas con cada cliente: qué le encaja, por qué y qué necesita."
        actions={
          <button onClick={ingest} disabled={ingesting} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm px-3 py-2">
            {ingesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualizar convocatorias
          </button>
        }
      />

      {loading ? (
        <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !s ? (
        <p className="text-sm text-rose-600">No se pudo cargar.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="Convocatorias abiertas" value={s.abiertas} icon={<Landmark className="h-4 w-4" />} />
            <Stat label="En catálogo" value={s.total} />
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Última actualización</div>
              <div className="mt-1 text-sm font-semibold text-slate-800">{s.ultimaActualizacion ? new Date(s.ultimaActualizacion).toLocaleString("es-ES") : "Nunca — pulsa Actualizar"}</div>
            </div>
          </div>

          {/* Cruce por cliente */}
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800 mb-2">Buscar subvenciones para un cliente</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border bg-white text-sm">
                <option value="">— Elige un cliente —</option>
                {s.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={() => buscar(false)} disabled={!clientId || matching} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2">
                {matching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar subvenciones
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">El resultado se cachea 12 h para no repetir el análisis IA. {matches && !matching && <button onClick={() => buscar(true)} className="text-brand-600 hover:underline">↻ volver a analizar</button>}</p>
            {msg && <p className="mt-2 text-sm text-slate-700">{msg}</p>}

            {matches && (
              matches.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No se encontraron convocatorias que encajen claramente. Prueba a actualizar el catálogo o revisa el sector/ubicación del cliente.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {matches.map((m) => (
                    <li key={m.id} className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{m.titulo}</p>
                          <p className="text-xs text-slate-500">{m.organo || "—"} · {eur(m.importeTotal)} · cierra {fecha(m.fechaFin)}</p>
                        </div>
                        <span className="shrink-0 text-xs font-black text-emerald-700 bg-white border border-emerald-200 rounded-full px-2 py-0.5">{m.fitScore}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-slate-700"><strong>Encaja porque:</strong> {m.motivo}</p>
                      <p className="text-sm text-slate-600"><strong>Necesita:</strong> {m.requisitos}</p>
                      {m.urlBases && <a href={m.urlBases} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><ExternalLink className="h-3 w-3" /> Bases / sede</a>}
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          {/* Catálogo */}
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Convocatorias abiertas ({s.convocatorias.length})</h2>
            {s.convocatorias.length === 0 ? (
              <p className="text-sm text-slate-500">Catálogo vacío. Pulsa <strong>Actualizar convocatorias</strong> para traerlas de la BDNS.</p>
            ) : (
              <div className="space-y-1.5">
                {s.convocatorias.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-slate-800 truncate">{c.titulo}</p>
                      <p className="text-[11px] text-slate-400">{c.organo || "—"} · {c.regiones || "ámbito no indicado"} · {eur(c.importeTotal)}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500">cierra {fecha(c.fechaFin)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">{icon}{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
    </div>
  );
}
