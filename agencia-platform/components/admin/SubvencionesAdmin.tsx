"use client";

/**
 * Cazador de Subvenciones: actualiza el catálogo de convocatorias abiertas
 * (BDNS) y cruza cada cliente con las que le encajan (IA).
 */
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, RefreshCw, Landmark, Search, ExternalLink } from "lucide-react";

type Convo = { id: string; titulo: string; organo: string | null; regiones: string | null; importeTotal: number | null; fechaFin: string | null; urlBases: string | null };
type Match = Convo & { fitScore: number; motivo: string; requisitos: string; estado?: string | null };
type Status = { abiertas: number; total: number; ultimaActualizacion: string | null; convocatorias: Convo[]; clients: { id: string; name: string }[]; webhookUrl?: string };

const ESTADOS = [
  { v: "", t: "— Estado —" },
  { v: "interesa", t: "Interesa" },
  { v: "en_proceso", t: "En proceso" },
  { v: "presentada", t: "Presentada" },
  { v: "descartada", t: "Descartada" }
];
function diasRestantes(s: string | null): number | null {
  if (!s) return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000);
}

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
  const [webhook, setWebhook] = useState("");
  const [savingHook, setSavingHook] = useState(false);
  const [scanRows, setScanRows] = useState<{ clientId: string; clientName: string; count: number; topTitulo: string | null; topScore: number | null; topFechaFin: string | null }[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [borrador, setBorrador] = useState<{ titulo: string; text: string } | null>(null);
  const [borradorLoading, setBorradorLoading] = useState<string | null>(null);

  async function scanAll() {
    setScanning(true);
    setScanRows(null);
    try {
      const r = await fetch("/api/v1/admin/subvenciones/match-all?limit=40");
      const j = await r.json().catch(() => ({}));
      if (r.ok) setScanRows(j.rows ?? []);
    } finally {
      setScanning(false);
    }
  }
  async function verBorrador(convocatoriaId: string, titulo: string) {
    if (!clientId) return;
    setBorradorLoading(convocatoriaId);
    try {
      const r = await fetch("/api/v1/admin/subvenciones/borrador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, convocatoriaId })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setBorrador({ titulo, text: j.borrador ?? "" });
      else setMsg(`❌ ${j?.error?.message ?? "No se pudo generar el borrador"}`);
    } finally {
      setBorradorLoading(null);
    }
  }

  async function saveWebhook() {
    setSavingHook(true);
    try {
      await fetch("/api/v1/admin/subvenciones", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webhookUrl: webhook }) });
    } finally {
      setSavingHook(false);
    }
  }
  async function setEstado(convocatoriaId: string, estado: string) {
    if (!clientId) return;
    setMatches((ms) => ms?.map((m) => (m.id === convocatoriaId ? { ...m, estado: estado || null } : m)) ?? ms);
    if (!estado) return;
    await fetch("/api/v1/admin/subvenciones/estado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, convocatoriaId, estado })
    }).catch(() => {});
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/subvenciones");
      if (r.ok) { const d = await r.json(); setS(d); setWebhook(d.webhookUrl ?? ""); }
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
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(() => { const d = diasRestantes(m.fechaFin); return d != null ? <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${d <= 7 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>⏰ cierra en {d} día{d === 1 ? "" : "s"}</span> : null; })()}
                        <select value={m.estado ?? ""} onChange={(e) => setEstado(m.id, e.target.value)} className="text-xs border rounded px-1.5 py-1 bg-white">
                          {ESTADOS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                        </select>
                        {m.urlBases && <a href={m.urlBases} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><ExternalLink className="h-3 w-3" /> Bases / sede</a>}
                        <button onClick={() => verBorrador(m.id, m.titulo)} disabled={borradorLoading === m.id} className="inline-flex items-center gap-1 text-xs rounded border border-brand-300 bg-brand-50 text-brand-700 px-2 py-0.5 hover:bg-brand-100 disabled:opacity-50">
                          {borradorLoading === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "📝"} Borrador IA
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          {/* Avisos de cierre (Make) */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Avisos de cierre de plazo</h2>
            <p className="text-[11px] text-slate-500 mt-0.5 mb-2">Cada noche se avisa de las convocatorias marcadas como <strong>Interesa/En proceso</strong> que cierran en ≤7 días, enviando un webhook a Make (que enrutas a WhatsApp/email).</p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hook.eu2.make.com/…" className="flex-1 min-w-[240px] px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
              <button onClick={saveWebhook} disabled={savingHook} className="rounded-lg border bg-white hover:bg-slate-50 text-sm px-3 py-2 disabled:opacity-50">{savingHook ? "Guardando…" : "Guardar webhook"}</button>
            </div>
          </div>

          {/* Escaneo masivo de clientes */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Oportunidades por cliente</h2>
              <button onClick={scanAll} disabled={scanning} className="inline-flex items-center gap-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm px-3 py-1.5 disabled:opacity-50">
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Escanear todos los clientes
              </button>
            </div>
            {scanRows && (
              scanRows.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Sin clientes activos.</p>
              ) : (
                <div className="mt-3 space-y-1">
                  {scanRows.map((r) => (
                    <button key={r.clientId} onClick={() => { setClientId(r.clientId); setTimeout(() => buscar(false), 0); }} className="w-full flex items-center justify-between gap-2 rounded-lg border bg-white hover:bg-emerald-50 px-3 py-2 text-left">
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-slate-800">{r.clientName}</span>
                        {r.topTitulo && <span className="block text-[11px] text-slate-500 truncate">Mejor: {r.topTitulo}</span>}
                      </span>
                      <span className="shrink-0 text-xs">
                        {r.count > 0 ? <span className="font-bold text-emerald-700">{r.count} oportunidad{r.count === 1 ? "" : "es"}</span> : <span className="text-slate-400">—</span>}
                        {r.topScore != null && <span className="ml-2 text-slate-400">({r.topScore})</span>}
                      </span>
                    </button>
                  ))}
                </div>
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

      {borrador && (
        <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={() => setBorrador(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 p-4 border-b">
              <h3 className="font-bold text-slate-900 text-sm">📝 Borrador de solicitud — {borrador.titulo}</h3>
              <button onClick={() => setBorrador(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <textarea readOnly value={borrador.text} className="flex-1 overflow-auto m-4 p-3 rounded-lg border bg-slate-50 text-sm font-mono leading-relaxed" rows={18} />
            <div className="flex justify-end gap-2 p-4 pt-0">
              <button onClick={() => { void navigator.clipboard?.writeText(borrador.text); }} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-2">Copiar</button>
            </div>
          </div>
        </div>
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
