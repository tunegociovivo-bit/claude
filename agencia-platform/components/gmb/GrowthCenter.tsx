"use client";

/**
 * Centro de crecimiento SEO local (GMB Hub) — fase 2. Por ficha:
 *   Presencia · AI Council · Rank & Competencia · Contenido · Reseñas IA · Web local · Informes ·
 *   Citaciones · Acciones.
 * Datos reales vía APIs tenant-scoped; si el workspace no tiene fichas, DEMO claramente etiquetada
 * (fixtures de ejemplo, nunca reales ni guardados). Sin botones muertos ni acciones externas sin
 * aprobación. El AI Council nunca finge llamadas: sin claves/consentimiento → "no conectado".
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Gauge, Sparkles, MapPin, Megaphone, MessageSquare, Globe, FileText, ListChecks, Check, X, ChevronRight, ExternalLink, Plug, BarChart2, QrCode } from "lucide-react";
import { GROWTH_DEMO } from "@/lib/gmb/growth-demo";

type Ficha = { id: string; name: string; category?: string };
type Breakdown = { profile: number; reviews: number; content: number; citations: number; ranking: number; web: number };

const BREAKDOWN_LABELS: Record<keyof Breakdown, string> = { profile: "Perfil", reviews: "Reseñas", content: "Contenido", citations: "Citaciones", ranking: "Ranking", web: "Web" };
const CARD = "bg-white rounded-xl border p-4";

type TabKey = "presencia" | "aicouncil" | "rank" | "contenido" | "reseñas" | "web" | "informes" | "citaciones" | "acciones" | "conexiones" | "attribution" | "captacion";
const TABS: [TabKey, string, any][] = [
  ["presencia", "Presencia", Gauge], ["aicouncil", "AI Council", Sparkles], ["rank", "Rank & Competencia", MapPin],
  ["contenido", "Contenido", Megaphone], ["reseñas", "Reseñas IA", MessageSquare], ["web", "Web local", Globe],
  ["informes", "Informes", FileText], ["citaciones", "Citaciones", MapPin], ["acciones", "Acciones", ListChecks],
  ["conexiones", "Conexiones", Plug], ["attribution", "Attribution/ROI", BarChart2], ["captacion", "Captación reseñas", QrCode]
];

const scoreColor = (n: number) => (n >= 75 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-rose-600");
const scoreStroke = (n: number) => (n >= 75 ? "#059669" : n >= 50 ? "#d97706" : "#e11d48");

function ScoreRing({ value }: { value: number }) {
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div className="relative h-32 w-32" role="img" aria-label={`Presencia local ${value} sobre 100`}>
      <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={scoreStroke(value)} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 grid place-items-center"><div className="text-center"><div className={`text-3xl font-bold ${scoreColor(value)}`}>{value}</div><div className="text-[10px] uppercase tracking-wide text-slate-400">/ 100</div></div></div>
    </div>
  );
}
function BreakdownBars({ breakdown }: { breakdown: Breakdown }) {
  return (
    <div className="space-y-1.5">
      {(Object.keys(BREAKDOWN_LABELS) as (keyof Breakdown)[]).map((k) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-20 text-slate-500">{BREAKDOWN_LABELS[k]}</span>
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-brand-500" style={{ width: `${breakdown[k]}%` }} /></div>
          <span className="w-8 text-right font-medium text-slate-700">{breakdown[k]}</span>
        </div>
      ))}
    </div>
  );
}
function Spinner() { return <div className="py-10 grid place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>; }
function DemoBanner({ text }: { text?: string }) { return <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{text ?? <>Estás viendo una <strong>DEMO</strong> con datos de ejemplo. No son reales ni se guardan.</>}</div>; }

export default function GrowthCenter() {
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("presencia");
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/v1/gmb/clients");
        const d = await r.json().catch(() => ({}));
        const list: Ficha[] = (d.clients ?? []).map((c: any) => ({ id: c.id, name: c.name, category: c.category }));
        setFichas(list);
        if (list.length) setSelected(list[0].id);
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <Spinner />;
  const hasFichas = fichas.length > 0;
  const showDemo = !hasFichas && demo;
  const clientId = showDemo ? null : selected;
  const active = hasFichas || showDemo;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto max-w-full pb-1">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${tab === k ? "bg-white shadow-sm text-slate-900 border" : "text-slate-500 hover:text-slate-800"}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
        {hasFichas ? (
          <label className="flex items-center gap-2 text-sm"><span className="text-slate-500">Ficha:</span>
            <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {fichas.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        ) : (
          <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="accent-brand-600" />Ver demo (datos de ejemplo)</label>
        )}
      </div>

      {!hasFichas && !showDemo && (
        <div className={`${CARD} text-center py-12`}>
          <Gauge className="h-10 w-10 mx-auto text-brand-500" />
          <h3 className="mt-3 font-semibold text-slate-800">Aún no tienes fichas conectadas</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">Crea o importa una ficha de Google Business para calcular su Presencia local, auditar citaciones y activar el piloto de crecimiento.</p>
          <button onClick={() => setDemo(true)} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm">Ver una demo realista</button>
        </div>
      )}

      {active && (
        <>
          {showDemo && <DemoBanner />}
          {tab === "presencia" && <PresencePanel clientId={clientId} onGoActions={() => setTab("acciones")} />}
          {tab === "aicouncil" && <AiCouncilPanel clientId={clientId} />}
          {tab === "rank" && <RankPanel clientId={clientId} />}
          {tab === "contenido" && <ContentPanel clientId={clientId} />}
          {tab === "reseñas" && <ReviewsPanel clientId={clientId} />}
          {tab === "web" && <WebPanel clientId={clientId} />}
          {tab === "informes" && <ReportPanel clientId={clientId} />}
          {tab === "citaciones" && <CitationsPanel clientId={clientId} />}
          {tab === "acciones" && <ActionsPanel clientId={clientId} />}
          {tab === "conexiones" && <ConnectionsPanel demo={showDemo} />}
          {tab === "attribution" && <AttributionPanel clientId={clientId} />}
          {tab === "captacion" && <AcquisitionPanel clientId={clientId} />}
        </>
      )}
    </div>
  );
}

// ── Presencia ─────────────────────────────────────────────────────────────────────────────────
function PresencePanel({ clientId, onGoActions }: { clientId: string | null; onGoActions: () => void }) {
  const isDemo = !clientId;
  const [fetched, setFetched] = useState<any>(null);
  useEffect(() => {
    if (isDemo) return;
    setFetched(null);
    fetch(`/api/v1/gmb/clients/${clientId}/presence?snapshot=1`).then((r) => r.json()).then((d) => setFetched(d.ok ? d : null));
  }, [clientId, isDemo]);
  const data = isDemo ? GROWTH_DEMO.presence : fetched;
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className={`${CARD} flex flex-col items-center justify-center gap-2`}><ScoreRing value={data.score} /><div className="text-sm font-medium text-slate-700">Local Presence Score</div></div>
      <div className={`${CARD} md:col-span-2`}><div className="text-sm font-semibold text-slate-800 mb-3">Desglose por dimensión</div><BreakdownBars breakdown={data.breakdown} /></div>
      <div className={`${CARD} md:col-span-3`}>
        <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold text-slate-800">Oportunidades priorizadas</div>{clientId && <button onClick={onGoActions} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">Generar plan en Acciones <ChevronRight className="h-3 w-3" /></button>}</div>
        {data.opportunities.length === 0 ? <div className="text-sm text-slate-500">Sin oportunidades pendientes. 🎉</div> : (
          <ul className="space-y-2">{data.opportunities.map((o: any) => (
            <li key={o.type} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div><div className="text-sm font-medium text-slate-800">{o.title}{o.external && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">requiere aprobación</span>}</div><div className="text-xs text-slate-500 mt-0.5">{o.description}</div></div>
              <div className="shrink-0 text-right text-[11px] text-slate-500"><div>impacto <b className="text-slate-700">{o.impact}</b></div><div>esfuerzo <b className="text-slate-700">{o.effort}</b></div></div>
            </li>))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── AI Council (superficie propia) ──────────────────────────────────────────────────────────────
function AiCouncilPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [fetched, setFetched] = useState<any>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ranResult, setRanResult] = useState<any>(null);
  const load = useCallback(async () => {
    if (isDemo) return;
    const r = await fetch(`/api/v1/gmb/clients/${clientId}/ai-council`);
    setFetched(await r.json().catch(() => null));
  }, [clientId, isDemo]);
  useEffect(() => { void load(); }, [load]);
  async function run() {
    if (!clientId) return;
    setBusy(true);
    try { const r = await fetch(`/api/v1/gmb/clients/${clientId}/ai-council`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose: "opportunities", consent }) }); const d = await r.json().catch(() => ({})); setRanResult(d.run ?? null); await load(); } finally { setBusy(false); }
  }
  // Demo: datos SÍNCRONOS (sin ventana null) → el panel nunca aparece vacío.
  const data = isDemo ? GROWTH_DEMO.aiCouncil : fetched;
  const lastRun = isDemo ? GROWTH_DEMO.aiCouncil.exampleRun : ranResult;
  if (!data) return <Spinner />;
  const connectedCount = data.connectedCount ?? 0;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className={`${CARD} space-y-3 lg:col-span-1`}>
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" /><span className="text-sm font-semibold text-slate-800">Consejo multimodelo</span></div>
        <div className="text-xs text-slate-500">Consulta varios modelos, normaliza propuestas y muestra consenso y discrepancias. Sin claves ni consentimiento no se consulta ningún modelo.</div>
        <div className="flex flex-wrap gap-1">{(data.providers ?? []).map((p: any) => <span key={p.provider} className={`text-[10px] px-1.5 py-0.5 rounded ${p.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{p.provider}{p.connected ? " ✓" : " · sin conectar"}</span>)}</div>
        {connectedCount === 0 && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">No hay modelos conectados. Configura claves en Ajustes. {isDemo && "En demo se muestra un resultado de EJEMPLO; no se llama a ningún modelo."}</div>}
        <label className="flex items-center gap-2 text-[11px] text-slate-600"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="accent-brand-600" />Autorizo enviar señales (sin PII) de esta ficha</label>
        {clientId && <button onClick={run} disabled={busy || connectedCount === 0 || !consent} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Consultar consejo</button>}
      </div>
      <div className="lg:col-span-2 space-y-3">
        {isDemo && <DemoBanner text="Resultado de AI Council de EJEMPLO. No se ha consultado ningún modelo real." />}
        {lastRun ? (
          <>
            <div className={`${CARD}`}>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-2"><span>Estado: <b className="text-slate-700">{lastRun.status}</b></span><span>coste ${(lastRun.costUsd ?? 0).toFixed(4)} · {lastRun.latencyMs ?? 0}ms</span></div>
              <div className="flex flex-wrap gap-1 mb-3">{(lastRun.models ?? []).map((m: any, i: number) => <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${m.status === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{m.provider} · {m.status} · {m.latencyMs}ms</span>)}</div>
              <div className="text-sm font-semibold text-slate-800 mb-1">Consenso</div>
              <ul className="space-y-1.5">{(lastRun.proposals ?? []).map((p: any, i: number) => (
                <li key={i} className="rounded-lg border p-2.5"><div className="text-sm font-medium text-slate-800">{p.title} <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">{p.agreement} modelos</span></div><div className="text-xs text-slate-500">{p.description}</div><div className="text-[11px] text-slate-400 mt-0.5">impacto {p.impact} · esfuerzo {p.effort} · confianza {p.confidence}</div></li>))}
              </ul>
              {(lastRun.discrepancies ?? []).length > 0 && <><div className="text-sm font-semibold text-slate-800 mt-3 mb-1">Discrepancias</div><ul className="space-y-1">{lastRun.discrepancies.map((p: any, i: number) => <li key={i} className="text-xs text-slate-500">• {p.title} <span className="text-amber-600">(solo {p.providers?.join(", ")})</span></li>)}</ul></>}
            </div>
          </>
        ) : <div className={`${CARD} text-sm text-slate-500`}>Aún no hay consultas. Marca el consentimiento y pulsa «Consultar consejo» (requiere modelos conectados).</div>}
        {(data.runs?.length ?? 0) > 0 && <div className={`${CARD} text-[11px] text-slate-500`}><div className="font-medium text-slate-600 mb-1">Historial</div>{data.runs.slice(0, 5).map((r: any) => <div key={r.id} className="flex items-center justify-between"><span>{r.purpose} · {r.status}</span><span>${(r.costUsd ?? 0).toFixed(4)} · {r.latencyMs}ms</span></div>)}</div>}
      </div>
    </div>
  );
}

// ── Rank & Competencia ──────────────────────────────────────────────────────────────────────────
function RankPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [fetched, setFetched] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    if (isDemo) return;
    fetch(`/api/v1/gmb/clients/${clientId}/rank`).then((r) => r.json()).then((d) => setFetched(d.ok ? d : null));
  }, [clientId, isDemo]);
  useEffect(() => { setFetched(null); load(); }, [load]);
  async function measure() {
    if (!clientId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${clientId}/rank/measure`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      setMsg(d.note ?? (d.blocked ? "Bloqueado." : "Encolado."));
      // Sondeo de progreso.
      for (let i = 0; i < 20 && !d.blocked; i++) { await new Promise((res) => setTimeout(res, 6000)); const jr = await fetch(`/api/v1/gmb/clients/${clientId}/rank/measure`).then((x) => x.json()).catch(() => ({})); if ((jr.running ?? 0) === 0) { load(); break; } }
      load();
    } finally { setBusy(false); }
  }
  const data = isDemo ? GROWTH_DEMO.rank : fetched;
  if (!data) return <Spinner />;
  const connected = data.provider?.connected;
  const cfg = data.config ?? {};
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!connected
          ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex-1">Proveedor de rank (Google Maps) <b>sin conectar</b>. Se muestran las últimas mediciones guardadas; no se fabrican posiciones. Configura la clave de Maps en Ajustes para medir en vivo.</div>
          : <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex-1">Google Maps <b>conectado</b>. Centro {cfg.centerLat != null ? `${Number(cfg.centerLat).toFixed(3)}, ${Number(cfg.centerLng).toFixed(3)}` : "sin fijar"} · radio {cfg.radiusKm ?? 3}km · cuadrícula {cfg.gridSize ?? 5}×{cfg.gridSize ?? 5}.</div>}
        {clientId && <button onClick={measure} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Medir ahora</button>}
      </div>
      {msg && <div className="text-[11px] text-slate-500">{msg}</div>}
      {data.keywords?.length === 0 ? <div className={`${CARD} text-sm text-slate-500`}>No hay keywords rastreadas. Añádelas desde la ficha (pestaña Ranking) para medir el rank grid.</div> : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="text-left px-3 py-2.5">Keyword</th><th className="text-left px-3 py-2.5">Pos. media</th><th className="text-left px-3 py-2.5">Δ</th><th className="text-left px-3 py-2.5">Top3</th><th className="text-left px-3 py-2.5">Cobertura</th><th className="text-left px-3 py-2.5">Última</th></tr></thead>
            <tbody className="divide-y">{data.keywords.map((k: any) => (
              <tr key={k.keyword} className="hover:bg-slate-50"><td className="px-3 py-2 font-medium">{k.keyword}{k.isPrimary && <span className="ml-1 text-[10px] px-1 rounded bg-brand-50 text-brand-700">principal</span>}{k.running && <span className="ml-1 text-[10px] px-1 rounded bg-amber-50 text-amber-700">midiendo…</span>}</td><td className="px-3 py-2">{k.avgPosition ?? "—"}</td><td className="px-3 py-2">{k.deltaAvgPosition == null ? "—" : k.deltaAvgPosition < 0 ? <span className="text-emerald-600">▲ {Math.abs(k.deltaAvgPosition)}</span> : k.deltaAvgPosition > 0 ? <span className="text-rose-600">▼ {k.deltaAvgPosition}</span> : <span className="text-slate-400">=</span>}</td><td className="px-3 py-2">{k.top3Count ?? "—"}</td><td className="px-3 py-2">{k.visibilityShare != null ? `${k.visibilityShare}%` : "—"}</td><td className="px-3 py-2 text-[11px] text-slate-400">{k.lastCheckedAt ? new Date(k.lastCheckedAt).toLocaleDateString("es-ES") : "sin medir"}</td></tr>))}
            </tbody>
          </table>
        </div>
      )}
      {data.gap && (
        <div className={`${CARD}`}>
          <div className="text-sm font-semibold text-slate-800 mb-2">Competencia</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
            <div><div className="text-lg font-bold text-slate-800">{data.gap.you.rating}</div><div className="text-slate-400">tu nota</div></div>
            <div><div className="text-lg font-bold text-slate-800">{data.gap.market.avgRating}</div><div className="text-slate-400">media zona</div></div>
            <div><div className="text-lg font-bold text-slate-800">{data.gap.you.reviewCount}</div><div className="text-slate-400">tus reseñas</div></div>
            <div><div className={`text-lg font-bold ${data.gap.reviewGap > 0 ? "text-rose-600" : "text-emerald-600"}`}>{data.gap.reviewGap > 0 ? `-${data.gap.reviewGap}` : `+${-data.gap.reviewGap}`}</div><div className="text-slate-400">gap reseñas</div></div>
          </div>
          {data.gap.categoryGaps?.length > 0 && <div className="text-xs text-slate-500 mt-2">Categorías que tienen competidores y tú no: <b>{data.gap.categoryGaps.join(", ")}</b></div>}
        </div>
      )}
    </div>
  );
}

// ── Contenido ─────────────────────────────────────────────────────────────────────────────────
const POST_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Borrador", cls: "bg-slate-100 text-slate-600" }, pending_approval: { label: "Pend. aprobación", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "Aprobada", cls: "bg-indigo-50 text-indigo-700" }, scheduled: { label: "Programada", cls: "bg-blue-50 text-blue-700" },
  published: { label: "Publicada", cls: "bg-emerald-50 text-emerald-700" }, failed: { label: "Error", cls: "bg-rose-100 text-rose-700" }
};
function ContentPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [ideas, setIdeas] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const load = useCallback(() => {
    if (isDemo) return;
    fetch(`/api/v1/gmb/clients/${clientId}/content-ideas`).then((r) => r.json()).then((d) => setIdeas(d.ok ? d : null));
    fetch(`/api/v1/gmb/clients/${clientId}/posts`).then((r) => r.json()).then((d) => setPosts(d.posts ?? []));
    fetch(`/api/v1/gmb/clients/${clientId}/photos`).then((r) => r.json()).then((d) => setPhotos(d.photos ?? []));
  }, [clientId, isDemo]);
  useEffect(() => { setIdeas(null); setPosts([]); setPhotos([]); load(); }, [load]);
  async function addPhoto() {
    if (!clientId) return;
    const url = window.prompt("URL de la imagen (https://…)"); if (!url) return;
    const r = await fetch(`/api/v1/gmb/clients/${clientId}/photos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const j = await r.json().catch(() => ({})); if (j.duplicate) alert("Imagen duplicada (mismo hash): no se añade."); load();
  }
  async function delPhoto(id: string) { if (!clientId) return; await fetch(`/api/v1/gmb/clients/${clientId}/photos?photoId=${id}`, { method: "DELETE" }); load(); }
  async function createDraft(idea: any) {
    if (!clientId) return;
    await fetch(`/api/v1/gmb/clients/${clientId}/posts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: idea.title, content: idea.content, cta: idea.cta }) });
    load();
  }
  async function transition(postId: string, command: string, scheduledAt?: string) {
    if (!clientId) return;
    if (command === "schedule") { const when = window.prompt("Fecha/hora de programación (YYYY-MM-DDTHH:mm)", new Date(Date.now() + 86400000).toISOString().slice(0, 16)); if (!when) return; scheduledAt = new Date(when).toISOString(); await fetch(`/api/v1/gmb/clients/${clientId}/posts/${postId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scheduledAt }) }); }
    await fetch(`/api/v1/gmb/clients/${clientId}/posts/${postId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, ...(scheduledAt ? { scheduledAt } : {}) }) });
    load();
  }
  async function del(postId: string) { if (!clientId || !window.confirm("¿Eliminar el borrador?")) return; await fetch(`/api/v1/gmb/clients/${clientId}/posts/${postId}`, { method: "DELETE" }); load(); }

  const data = isDemo ? GROWTH_DEMO.content : ideas;
  if (!data) return <Spinner />;
  const cadenceCls = data.cadence?.status === "good" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : data.cadence?.status === "low" ? "text-amber-700 bg-amber-50 border-amber-200" : "text-rose-700 bg-rose-50 border-rose-200";
  const list = isDemo ? (GROWTH_DEMO.content.recent ?? []).map((p: any) => ({ ...p, content: "" })) : posts;
  return (
    <div className="space-y-4">
      <div className={`rounded-lg border px-3 py-2 text-xs ${cadenceCls}`}>{data.cadence?.message}</div>

      <div>
        <div className="text-sm font-semibold text-slate-800 mb-2">Ideas de contenido (borradores)</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.ideas.map((idea: any, i: number) => (
            <div key={i} className={`${CARD}`}>
              <div className="flex items-center gap-2 mb-1"><span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase">{idea.type === "update" ? "novedad" : idea.type === "offer" ? "oferta" : "evento"}</span><span className="text-sm font-medium text-slate-800">{idea.title}</span></div>
              <div className="text-xs text-slate-500">{idea.content}</div>
              <div className="mt-2 flex items-center justify-between"><span className="text-[11px] text-slate-400">CTA: {idea.cta}</span>{clientId && <button onClick={() => createDraft(idea)} className="text-[11px] px-2 py-0.5 rounded border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100">Crear borrador</button>}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-800 mb-2">Calendario y cola de publicaciones</div>
        {list.length === 0 ? <div className={`${CARD} text-sm text-slate-500`}>Sin publicaciones. Crea un borrador desde una idea. La publicación externa nunca ocurre sin aprobación.</div> : (
          <ul className="space-y-2">
            {list.map((p: any) => { const meta = POST_STATUS_META[p.status] ?? POST_STATUS_META.draft; return (
              <li key={p.id} className={`${CARD} flex items-start justify-between gap-3`}>
                <div className="min-w-0"><div className="text-sm font-medium text-slate-800">{p.title || "(sin título)"} <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span></div>{p.scheduledAt && <div className="text-[11px] text-slate-500">Programada: {new Date(p.scheduledAt).toLocaleString("es-ES")}</div>}</div>
                {clientId && (
                  <div className="shrink-0 flex flex-wrap gap-1 justify-end">
                    {p.status === "draft" && <button onClick={() => transition(p.id, "submit")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Enviar a aprobación</button>}
                    {p.status === "pending_approval" && <button onClick={() => transition(p.id, "approve")} className="text-[11px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50">Aprobar</button>}
                    {p.status === "approved" && <button onClick={() => transition(p.id, "schedule")} className="text-[11px] px-2 py-0.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-50">Programar</button>}
                    {(p.status === "draft" || p.status === "pending_approval") && <button onClick={() => del(p.id)} title="Eliminar" className="text-[11px] px-2 py-0.5 rounded border text-slate-500 hover:bg-slate-50"><X className="h-3 w-3" /></button>}
                  </div>
                )}
              </li>); })}
          </ul>
        )}
        <div className="text-[11px] text-slate-400 mt-1">La publicación en Google es adapter-gated: solo se publica lo programado y aprobado, nunca automáticamente sin aprobación.</div>
      </div>

      {(() => {
        const mediaList = isDemo ? ((GROWTH_DEMO.content as any).photos ?? []) : photos;
        return (
        <div>
          <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold text-slate-800">Biblioteca multimedia{isDemo && <span className="ml-1 text-[10px] text-amber-600">(demo)</span>}</span><button onClick={addPhoto} disabled={isDemo} className="text-[11px] px-2 py-0.5 rounded border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50">＋ Añadir por URL</button></div>
          {mediaList.length === 0 ? <div className={`${CARD} text-sm text-slate-500`}>Sin imágenes. Añade por URL; se deduplican por hash y quedan en cola (envío solo con GBP conectado + aprobación).</div> : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {mediaList.map((p: any) => (
                <div key={p.id} className="relative group rounded-lg overflow-hidden border bg-slate-50 aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption || "foto"} className="w-full h-full object-cover" />
                  {p.isDuplicate && <span className="absolute top-1 left-1 text-[9px] px-1 rounded bg-fuchsia-100 text-fuchsia-700">dup</span>}
                  <span className="absolute bottom-1 left-1 text-[9px] px-1 rounded bg-white/80 text-slate-600">{p.status ?? "library"}</span>
                  <button onClick={() => delPhoto(p.id)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-[10px] bg-white/90 rounded px-1 text-rose-600">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}

// ── Reseñas IA ──────────────────────────────────────────────────────────────────────────────────
const SENT_CLS: Record<string, string> = { positive: "bg-emerald-50 text-emerald-700", neutral: "bg-slate-100 text-slate-600", negative: "bg-rose-50 text-rose-700" };
const LEVEL_CLS: Record<string, string> = { high: "bg-rose-50 text-rose-700", medium: "bg-amber-50 text-amber-700", low: "bg-slate-100 text-slate-500" };
function ReviewsPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [fetched, setFetched] = useState<any>(null);
  useEffect(() => {
    if (isDemo) return;
    setFetched(null);
    fetch(`/api/v1/gmb/clients/${clientId}/review-intel`).then((r) => r.json()).then((d) => setFetched(d.ok ? d : null));
  }, [clientId, isDemo]);
  const data = isDemo ? GROWTH_DEMO.reviews : fetched;
  const [drafts, setDrafts] = useState<Record<string, { draft: string; requiresApproval: boolean; busy?: boolean }>>({});
  async function genDraft(reviewId: string, tone?: string) {
    if (!clientId) return;
    setDrafts((d) => ({ ...d, [reviewId]: { ...(d[reviewId] ?? { draft: "", requiresApproval: true }), busy: true } }));
    try {
      const r = await fetch(`/api/v1/gmb/clients/${clientId}/reviews/${reviewId}/reply-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tone ? { tone } : {}) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setDrafts((d) => ({ ...d, [reviewId]: { draft: j.draft, requiresApproval: j.decision?.requiresApproval ?? true } }));
      else setDrafts((d) => ({ ...d, [reviewId]: { draft: `Error: ${j?.error?.message ?? r.status}`, requiresApproval: true } }));
    } catch (e: any) { setDrafts((d) => ({ ...d, [reviewId]: { draft: e?.message ?? "error", requiresApproval: true } })); }
  }
  if (!data) return <Spinner />;
  const s = data.summary;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[["Reseñas", s.total], ["Positivas", s.sentiment.positive], ["Negativas", s.sentiment.negative], ["Urgentes", s.highUrgency], ["Pendientes", s.pendingResponse]].map(([l, v]) => (
          <div key={l as string} className={`${CARD} text-center py-3`}><div className="text-xl font-bold text-slate-800">{v as number}</div><div className="text-[11px] text-slate-400">{l as string}</div></div>
        ))}
      </div>
      {s.topTopics?.length > 0 && <div className="text-xs text-slate-500">Temas: {s.topTopics.map((t: any) => `${t.topic} (${t.count})`).join(" · ")}</div>}
      {!data.rules?.autoReplyEnabled && <div className="text-[11px] text-slate-500">Auto-respuesta <b>desactivada</b>: todas las respuestas requieren aprobación humana (nunca se publican solas).</div>}
      <ul className="space-y-2">
        {(data.items ?? []).slice(0, 20).map((it: any) => {
          const d = drafts[it.id];
          return (
          <li key={it.id} className={`${CARD}`}>
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="font-medium text-slate-800 text-sm">{it.authorName || "Anónimo"}</span>
              <span className="text-amber-500">{"★".repeat(it.rating)}</span>
              <span className={`px-1.5 py-0.5 rounded ${SENT_CLS[it.analysis.sentiment]}`}>{it.analysis.sentiment}</span>
              <span className={`px-1.5 py-0.5 rounded ${LEVEL_CLS[it.analysis.urgency]}`}>urgencia {it.analysis.urgency}</span>
              {it.analysis.risk === "high" && <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">riesgo</span>}
              {it.analysis.topics.map((t: string) => <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t}</span>)}
            </div>
            {it.comment && <div className="text-xs text-slate-600 mt-1">{it.comment}</div>}
            <div className="flex items-center justify-between gap-2 mt-1">
              <div className="text-[11px] text-slate-400">Tono sugerido: {it.analysis.suggestedTone} · {it.reply?.requiresApproval ? "requiere aprobación" : "auto-sugerible (borrador)"}</div>
              {clientId && <button onClick={() => genDraft(it.id)} disabled={d?.busy} className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50">{d?.busy ? "…" : "Generar borrador"}</button>}
            </div>
            {d && !d.busy && (
              <div className="mt-2 rounded-lg border bg-slate-50 p-2 text-xs">
                <div className="flex items-center justify-between mb-1"><span className="font-medium text-slate-600">Borrador (no publica)</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${d.requiresApproval ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{d.requiresApproval ? "requiere aprobación" : "auto-sugerible"}</span></div>
                <div className="text-slate-700 whitespace-pre-wrap">{d.draft}</div>
                <button onClick={() => { void navigator.clipboard?.writeText(d.draft); }} className="mt-1 text-[11px] text-brand-600 hover:underline">Copiar</button>
              </div>
            )}
          </li>);
        })}
      </ul>
    </div>
  );
}

// ── Web local ─────────────────────────────────────────────────────────────────────────────────
function WebPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [fetched, setFetched] = useState<any>(null);
  useEffect(() => {
    if (isDemo) return;
    setFetched(null);
    fetch(`/api/v1/gmb/clients/${clientId}/web-local`).then((r) => r.json()).then((d) => setFetched(d.ok ? d : null));
  }, [clientId, isDemo]);
  const data = isDemo ? GROWTH_DEMO.web : fetched;
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        {data.recommendations.map((r: any, i: number) => (
          <div key={i} className={`${CARD} flex items-start justify-between gap-2`}><div><div className="text-sm font-medium text-slate-800">{r.title} <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{r.type}</span></div><div className="text-xs text-slate-500">{r.detail}</div></div><span className="text-[11px] text-slate-400 shrink-0">impacto {r.impact}</span></div>
        ))}
      </div>
      <div className={`${CARD}`}>
        <div className="text-sm font-semibold text-slate-800 mb-2">Borrador schema.org (JSON-LD)</div>
        <pre className="text-[11px] bg-slate-50 rounded-lg p-3 overflow-x-auto text-slate-700">{JSON.stringify(data.schema, null, 2)}</pre>
        <div className="text-[11px] text-slate-400 mt-1">Borrador auditable. No se aplica a ninguna web automáticamente.</div>
      </div>
    </div>
  );
}

// ── Informes ──────────────────────────────────────────────────────────────────────────────────
function currentMonth(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function ReportPanel({ clientId }: { clientId: string | null }) {
  const [month, setMonth] = useState<string>(currentMonth());
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    if (!clientId) { setReport(null); return; }
    setLoading(true);
    fetch(`/api/v1/gmb/clients/${clientId}/growth-report?month=${month}`).then((r) => r.json()).then((d) => setReport(d.ok ? d.report : null)).finally(() => setLoading(false));
  }, [clientId, month]);
  useEffect(() => { load(); }, [load]);
  const [share, setShare] = useState<{ url: string; expiresAt: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  async function createShare() {
    if (!clientId) return;
    setSharing(true);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${clientId}/report-share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, expiryDays: 30, includePII: false }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setShare({ url: d.url, expiresAt: d.expiresAt });
    } finally { setSharing(false); }
  }

  if (!clientId) {
    return <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">En demo no hay informe real. Con una ficha conectada verás el informe mensual con datos reales, imprimible/exportable a PDF, y podrás generar un enlace white-label compartible (token revocable, con caducidad y sin PII).</div>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 no-print">
        <FileText className="h-4 w-4 text-brand-600" /><span className="text-sm font-semibold text-slate-800">Informe mensual</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <button onClick={createShare} disabled={sharing || !report} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 text-sm disabled:opacity-50">{sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Compartir (white-label)</button>
        <button onClick={() => window.print()} disabled={!report} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50">Imprimir / PDF</button>
      </div>
      {share && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs no-print flex items-center gap-2">
          <span className="text-emerald-800">Enlace compartible (caduca {new Date(share.expiresAt).toLocaleDateString("es-ES")}, sin PII):</span>
          <input readOnly value={share.url} className="flex-1 min-w-0 rounded border px-2 py-1 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
          <button onClick={() => { void navigator.clipboard?.writeText(share.url); }} className="px-2 py-1 rounded border bg-white hover:bg-slate-50">Copiar</button>
        </div>
      )}
      {loading || !report ? <Spinner /> : (
        <div id="gmb-report" className={`${CARD} space-y-4`}>
          <div className="border-b pb-2"><h2 className="text-lg font-bold text-slate-900">{report.client.name}</h2><div className="text-xs text-slate-500">Informe de crecimiento local · {report.period.label}</div></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div><div className="text-2xl font-bold text-brand-600">{report.presence.score}</div><div className="text-[11px] text-slate-400">Presencia /100</div></div>
            <div><div className="text-2xl font-bold text-slate-800">{report.citations.published}/{report.citations.total}</div><div className="text-[11px] text-slate-400">Citaciones ok</div></div>
            <div><div className="text-2xl font-bold text-slate-800">{report.reviews.total}</div><div className="text-[11px] text-slate-400">Reseñas</div></div>
            <div><div className="text-2xl font-bold text-slate-800">{report.actions.done}</div><div className="text-[11px] text-slate-400">Acciones hechas</div></div>
          </div>
          <div><div className="text-sm font-semibold text-slate-800 mb-1">Resumen</div><ul className="text-xs text-slate-600 space-y-0.5">{report.highlights.map((h: string, i: number) => <li key={i}>• {h}</li>)}</ul></div>
          {report.rank.length > 0 && <div><div className="text-sm font-semibold text-slate-800 mb-1">Rankings</div><ul className="text-xs text-slate-600 space-y-0.5">{report.rank.map((r: any, i: number) => <li key={i}>• {r.keyword}: pos. {r.avgPosition ?? "—"}, cobertura {r.visibilityShare ?? "—"}%</li>)}</ul></div>}
          <div className="text-[10px] text-slate-400 pt-2 border-t">Generado {new Date(report.generatedAtIso).toLocaleString("es-ES")} · datos reales de la ficha.</div>
        </div>
      )}
    </div>
  );
}

// ── Citaciones ────────────────────────────────────────────────────────────────────────────────
const CITATION_STATUS_META: Record<string, { label: string; cls: string }> = {
  not_found: { label: "No encontrada", cls: "bg-slate-100 text-slate-600" }, pending: { label: "Pendiente", cls: "bg-amber-50 text-amber-700" },
  prepared: { label: "Preparada", cls: "bg-blue-50 text-blue-700" }, submitted: { label: "Enviada", cls: "bg-indigo-50 text-indigo-700" },
  published: { label: "Publicada", cls: "bg-emerald-50 text-emerald-700" }, inconsistent: { label: "Inconsistente", cls: "bg-rose-50 text-rose-700" },
  duplicate: { label: "Duplicada", cls: "bg-fuchsia-50 text-fuchsia-700" }, error: { label: "Error", cls: "bg-rose-100 text-rose-700" }
};
function CitationsPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [fetched, setFetched] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (isDemo) return;
    const r = await fetch(`/api/v1/gmb/clients/${clientId}/citations`);
    setFetched(await r.json().catch(() => null));
  }, [clientId, isDemo]);
  useEffect(() => { void load(); }, [load]);
  async function seed() { if (!clientId) return; setBusy(true); try { await fetch(`/api/v1/gmb/clients/${clientId}/citations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seed" }) }); await load(); } finally { setBusy(false); } }
  async function transition(id: string, command: string) { if (!clientId) return; await fetch(`/api/v1/gmb/citations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) }); await load(); }
  const [packet, setPacket] = useState<any>(null);
  async function showPacket(id: string, directoryName: string) {
    if (!clientId) return;
    const r = await fetch(`/api/v1/gmb/citations/${id}`);
    const j = await r.json().catch(() => ({}));
    setPacket(j.packet ? { ...j.packet, directoryName } : null);
  }
  function downloadPacket() {
    if (!packet) return;
    const text = `Paquete de alta — ${packet.directoryName}\nURL de alta: ${packet.submitUrl}\n\nNombre: ${packet.fields.name}\nDirección: ${packet.fields.address}\nTeléfono: ${packet.fields.phone}\nWeb: ${packet.fields.website}\n\nChecklist:\n- ${packet.checklist.join("\n- ")}\n\n${packet.note}`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `alta-${packet.directory}.txt`; a.click(); URL.revokeObjectURL(url);
  }
  const [filter, setFilter] = useState<string>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  async function importCsv() {
    if (!clientId || !csvText.trim()) return;
    const r = await fetch(`/api/v1/gmb/clients/${clientId}/citations/csv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: csvText }) });
    const j = await r.json().catch(() => ({}));
    alert(r.ok ? `Importadas ${j.imported}${j.errors?.length ? `, ${j.errors.length} avisos` : ""}.` : `Error: ${j?.error?.message ?? r.status}`);
    setImportOpen(false); setCsvText(""); load();
  }
  async function downloadPackets() {
    if (!clientId) return;
    const j = await fetch(`/api/v1/gmb/clients/${clientId}/citations/packets`).then((r) => r.json()).catch(() => ({}));
    const text = (j.packets ?? []).map((p: any) => `— ${p.directoryName} (${p.status})\nAlta: ${p.submitUrl}\nNombre: ${p.fields.name}\nDirección: ${p.fields.address}\nTeléfono: ${p.fields.phone}\nWeb: ${p.fields.website}\n`).join("\n");
    const blob = new Blob([text || "Sin paquetes accionables."], { type: "text/plain" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "paquetes-alta.txt"; a.click(); URL.revokeObjectURL(url);
  }
  const data = isDemo ? GROWTH_DEMO.citations : fetched;
  if (!data) return <Spinner />;
  const allCitations: any[] = data.citations ?? [];
  const citations = filter === "all" ? allCitations : filter === "actionable" ? allCitations.filter((c) => !["published", "duplicate"].includes(c.status)) : allCitations.filter((c) => c.status === filter);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-600">Total <b>{data.summary?.total ?? 0}</b></span><span className="text-rose-600">Accionables <b>{data.summary?.actionable ?? 0}</b></span>
        {(clientId || isDemo) && <button onClick={seed} disabled={busy || isDemo} title={isDemo ? "demo" : ""} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "＋"} Generar inventario</button>}
        {(clientId || isDemo) && <button onClick={() => setImportOpen((v) => !v)} disabled={isDemo} className="px-2.5 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50">Importar CSV</button>}
        {clientId ? <a href={`/api/v1/gmb/clients/${clientId}/citations/csv`} className="px-2.5 py-1.5 rounded-lg border hover:bg-slate-50">Exportar CSV</a> : isDemo && <button disabled className="px-2.5 py-1.5 rounded-lg border opacity-50">Exportar CSV</button>}
        {(clientId || isDemo) && <button onClick={downloadPackets} disabled={isDemo} className="px-2.5 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50">Paquetes (todos)</button>}
        <span className="ml-auto flex items-center gap-1">Filtro:
          {(["all", "actionable", "inconsistent", "not_found", "published"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`px-2 py-0.5 rounded-full border ${filter === f ? "bg-brand-600 text-white border-brand-600" : "bg-white hover:bg-slate-50"}`}>{f === "all" ? "todos" : f === "actionable" ? "accionables" : CITATION_STATUS_META[f]?.label ?? f}</button>
          ))}
        </span>
      </div>
      {importOpen && clientId && (
        <div className={`${CARD} space-y-2`}>
          <div className="text-xs text-slate-500">Pega un CSV con cabecera <code>directory,url,status,name,address,phone,website</code>. Importar registra lo declarado; no inventa presencia.</div>
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={4} className="w-full rounded-lg border px-2 py-1 text-xs font-mono" placeholder="directory,url,status,name,address,phone,website" />
          <button onClick={importCsv} className="text-[11px] px-3 py-1 rounded bg-brand-600 text-white hover:bg-brand-700">Importar</button>
        </div>
      )}
      {packet && (
        <div className={`${CARD} text-xs space-y-1`}>
          <div className="flex items-center justify-between"><span className="font-semibold text-slate-800">Paquete de alta — {packet.directoryName}</span><button onClick={() => setPacket(null)} className="text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button></div>
          <div>Nombre: <b>{packet.fields.name}</b></div><div>Dirección: <b>{packet.fields.address}</b></div><div>Teléfono: <b>{packet.fields.phone}</b></div><div>Web: <b>{packet.fields.website}</b></div>
          <a href={packet.submitUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1">Abrir alta del directorio <ExternalLink className="h-3 w-3" /></a>
          <div className="flex gap-2 pt-1">
            <button onClick={() => { void navigator.clipboard?.writeText(`${packet.fields.name}\n${packet.fields.address}\n${packet.fields.phone}\n${packet.fields.website}`); }} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Copiar NAP</button>
            <button onClick={downloadPacket} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Descargar .txt</button>
          </div>
          <div className="text-slate-400">{packet.note}</div>
        </div>
      )}
      {citations.length === 0 ? <div className={`${CARD} text-sm text-slate-500`}>Sin citaciones catalogadas. Pulsa «Generar inventario».</div> : (
        <div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="text-left px-3 py-2.5">Directorio</th><th className="text-left px-3 py-2.5">Aut.</th><th className="text-left px-3 py-2.5">Estado</th><th className="text-left px-3 py-2.5">NAP</th><th className="text-left px-3 py-2.5">Acción</th></tr></thead>
          <tbody className="divide-y">{citations.map((c) => { const meta = CITATION_STATUS_META[c.status] ?? CITATION_STATUS_META.not_found; const diffFields = c.diffs ? Object.entries(c.diffs).filter(([, v]) => v).map(([k]) => k) : []; return (
            <tr key={c.id} className="hover:bg-slate-50"><td className="px-3 py-2 font-medium">{c.directoryName}</td><td className="px-3 py-2 text-slate-500">{c.authority}</td><td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-[10px] ${meta.cls}`}>{meta.label}</span></td><td className="px-3 py-2 text-[11px] text-slate-500">{diffFields.length ? <span className="text-rose-600">difiere: {diffFields.join(", ")}</span> : c.status === "published" ? "consistente" : "—"}</td>
              <td className="px-3 py-2">{clientId ? <div className="flex gap-1 flex-wrap">{c.status === "not_found" && <button onClick={() => transition(c.id, "prepare")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Preparar alta</button>}{c.status === "prepared" && <button onClick={() => transition(c.id, "submit")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Marcar enviada</button>}{c.status === "submitted" && <button onClick={() => transition(c.id, "publish")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Marcar publicada</button>}{c.status === "inconsistent" && <button onClick={() => transition(c.id, "prepare")} className="text-[11px] px-2 py-0.5 rounded border border-rose-200 text-rose-700 hover:bg-rose-50">Corregir</button>}<button onClick={() => showPacket(c.id, c.directoryName)} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Paquete</button></div> : <span className="text-[11px] text-slate-400">demo</span>}</td>
            </tr>); })}
          </tbody></table></div>
      )}
      {(data.recommendations?.length ?? 0) > 0 && <div className="text-xs text-slate-500">Recomendados sin catalogar: {data.recommendations.map((r: any) => r.name).join(" · ")}</div>}
    </div>
  );
}

// ── Acciones ──────────────────────────────────────────────────────────────────────────────────
const ACTION_STATUS_META: Record<string, { label: string; cls: string }> = {
  suggested: { label: "Sugerida", cls: "bg-slate-100 text-slate-600" }, prepared: { label: "Preparada", cls: "bg-blue-50 text-blue-700" },
  needs_approval: { label: "Requiere aprobación", cls: "bg-amber-50 text-amber-700" }, approved: { label: "Aprobada", cls: "bg-indigo-50 text-indigo-700" },
  executing: { label: "Ejecutando", cls: "bg-violet-50 text-violet-700" }, done: { label: "Hecha", cls: "bg-emerald-50 text-emerald-700" },
  dismissed: { label: "Descartada", cls: "bg-slate-100 text-slate-400" }, error: { label: "Error", cls: "bg-rose-100 text-rose-700" }
};
function ActionsPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [fetched, setFetched] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<any>(null);
  const [pilotMsg, setPilotMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (isDemo) return;
    const [a, p] = await Promise.all([
      fetch(`/api/v1/gmb/clients/${clientId}/actions`).then((r) => r.json()).catch(() => null),
      fetch(`/api/v1/gmb/clients/${clientId}/autopilot`).then((r) => r.json()).catch(() => null)
    ]);
    setFetched(a); setPolicy(p?.policy ?? null);
  }, [clientId, isDemo]);
  useEffect(() => { void load(); }, [load]);
  async function generate() { if (!clientId) return; setBusy(true); try { await fetch(`/api/v1/gmb/clients/${clientId}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useAiCouncil: false }) }); await load(); } finally { setBusy(false); } }
  async function transition(id: string, command: string) {
    if (!clientId) return;
    if (command === "execute" && !window.confirm("Ejecutar el efecto interno seguro (crea borradores; no publica nada externo). ¿Continuar?")) return;
    await fetch(`/api/v1/gmb/actions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) });
    await load();
  }
  async function savePolicy(patch: any) {
    if (!clientId) return;
    const next = { ...(policy ?? {}), ...patch }; setPolicy(next);
    await fetch(`/api/v1/gmb/clients/${clientId}/autopilot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  }
  async function runPilot() {
    if (!clientId) return; setBusy(true); setPilotMsg(null);
    try { const r = await fetch(`/api/v1/gmb/clients/${clientId}/autopilot/run`, { method: "POST" }); const d = await r.json().catch(() => ({})); setPilotMsg(d.note ?? null); await load(); } finally { setBusy(false); }
  }
  const data = isDemo ? GROWTH_DEMO.actions : fetched;
  if (!data) return <Spinner />;
  const actions: any[] = data.actions ?? [];
  const pol = policy ?? { mode: data.autopilotMode ?? "suggest_only", dailyLimit: 3, minConfidence: 70, killSwitch: false, quietStart: null, quietEnd: null };
  return (
    <div className="space-y-3">
      {/* Piloto automático (visible también en demo, controles desactivados) */}
      {(clientId || isDemo) && (
        <div className={`${CARD} space-y-2`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">Piloto automático{isDemo && <span className="ml-1 text-[10px] text-amber-600">(demo)</span>}</span>
            <select disabled={isDemo} value={pol.mode} onChange={(e) => savePolicy({ mode: e.target.value })} className="rounded-lg border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60">
              <option value="suggest_only">Solo sugerir</option><option value="prepare_drafts">Preparar borradores</option><option value="execute_safe">Ejecutar seguros</option>
            </select>
            <label className="text-[11px] text-slate-600 flex items-center gap-1">Límite/día <input type="number" min={0} max={50} value={pol.dailyLimit} onChange={(e) => savePolicy({ dailyLimit: Number(e.target.value) })} className="w-14 rounded border px-1 py-0.5" /></label>
            <label className="text-[11px] text-slate-600 flex items-center gap-1">Confianza mín. <input type="number" min={0} max={100} value={pol.minConfidence} onChange={(e) => savePolicy({ minConfidence: Number(e.target.value) })} className="w-14 rounded border px-1 py-0.5" /></label>
            <label className={`text-[11px] flex items-center gap-1 ${pol.killSwitch ? "text-rose-600 font-medium" : "text-slate-600"}`}><input type="checkbox" checked={!!pol.killSwitch} onChange={(e) => savePolicy({ killSwitch: e.target.checked })} className="accent-rose-600" />Kill switch</label>
            <button onClick={runPilot} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs disabled:opacity-50">Ejecutar piloto ahora</button>
          </div>
          <div className="text-[11px] text-slate-400">Las acciones externas siempre requieren aprobación. El piloto solo ejecuta efectos internos reversibles, respetando límite diario, confianza mínima y quiet hours.{pilotMsg ? ` · ${pilotMsg}` : ""}</div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-slate-600">Cola: <b>{data.summary?.open ?? 0}</b> abiertas</span><span className="text-slate-400">modo: {data.autopilotMode ?? "suggest_only"}</span>{clientId && <button onClick={generate} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />} Generar plan</button>}</div>
      {actions.length === 0 ? (
        <div className={`${CARD} text-sm text-slate-500`}>Cola vacía. {clientId ? "Pulsa «Generar plan» para crear acciones priorizadas a partir de la presencia y las citaciones." : "En demo verías acciones de ejemplo."}</div>
      ) : (
        <ul className="space-y-2">{actions.map((a) => { const meta = ACTION_STATUS_META[a.status] ?? ACTION_STATUS_META.suggested; return (
          <li key={a.id} className={`${CARD} flex items-start justify-between gap-3`}>
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800">{a.title}<span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>{a.external && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">externa</span>}{a.source === "ai_council" && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">AI Council</span>}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{a.module} · impacto {a.impact} · esfuerzo {a.effort} · confianza {a.confidence}</div>
              {a.result?.note && <div className="text-[11px] text-emerald-700 mt-1">✓ {a.result.note}</div>}
              {a.lastError && <div className="text-[11px] text-rose-600 mt-1">⚠ {a.lastError}</div>}
            </div>
            {clientId && (
              <div className="shrink-0 flex flex-wrap gap-1 justify-end">
                {/* Externas: solo pedir/otorgar aprobación; nunca se ejecutan como efecto interno. */}
                {a.external && (a.status === "suggested" || a.status === "prepared") && <button onClick={() => transition(a.id, "request_approval")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Pedir aprobación</button>}
                {a.external && a.status === "needs_approval" && <button onClick={() => transition(a.id, "approve")} className="text-[11px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 inline-flex items-center gap-1"><Check className="h-3 w-3" />Aprobar</button>}
                {/* Internas: aprobar y luego ejecutar el efecto seguro reversible. */}
                {!a.external && (a.status === "suggested" || a.status === "prepared" || a.status === "needs_approval") && <button onClick={() => transition(a.id, "approve")} className="text-[11px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 inline-flex items-center gap-1"><Check className="h-3 w-3" />Aprobar</button>}
                {!a.external && a.status === "approved" && <button onClick={() => transition(a.id, "execute")} className="text-[11px] px-2 py-0.5 rounded bg-brand-600 text-white hover:bg-brand-700">Ejecutar (seguro)</button>}
                {a.status !== "done" && a.status !== "dismissed" && <button onClick={() => transition(a.id, "dismiss")} title="Descartar" className="text-[11px] px-2 py-0.5 rounded border text-slate-500 hover:bg-slate-50 inline-flex items-center gap-1"><X className="h-3 w-3" /></button>}
              </div>
            )}
          </li>); })}
        </ul>
      )}
    </div>
  );
}

// ── Conexión guiada con Google (OAuth, estilo Make) ──────────────────────────────────────────────
function GoogleConnectionCard({ demo }: { demo: boolean }) {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (demo) { setSt({ demo: true }); return; }
    fetch("/api/v1/gmb/google/status", { cache: "no-store" }).then((r) => r.json()).then(setSt).catch(() => setSt({ ok: false }));
  }, [demo]);
  useEffect(() => { load(); }, [load]);

  async function disconnect() {
    if (demo) return;
    if (!confirm("¿Desconectar la cuenta de Google? Las fichas ya creadas se conservan, pero dejarán de sincronizar hasta que vuelvas a conectar.")) return;
    setBusy(true);
    try {
      await fetch("/api/v1/gmb/google/disconnect", { method: "POST" });
      load();
    } finally { setBusy(false); }
  }

  const connected = !demo && st?.connection?.connected;
  const noScope = connected && st?.connection?.hasBusinessScope === false;
  const configured = demo ? true : st?.configured !== false;

  return (
    <div className={`${CARD} border-brand-200`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold">G</span>
            Google Business Profile
            {connected && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">conectado</span>}
            {!connected && !demo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">sin conectar</span>}
          </div>
          {connected ? (
            <div className="text-[12px] text-slate-500 mt-0.5">
              {st.connection.email ? <>Cuenta: <b className="text-slate-700">{st.connection.email}</b>. </> : null}
              {noScope ? "Falta el permiso para gestionar fichas — reconecta y acéptalo." : "Puedes elegir y sincronizar tus fichas."}
            </div>
          ) : (
            <div className="text-[12px] text-slate-500 mt-0.5">
              Conéctate con Google y elige tus fichas. Sin IDs ni claves; el consentimiento es de Google.
            </div>
          )}
          {!configured && !demo && (
            <div className="text-[11px] text-amber-700 mt-1">
              {st?.setup?.isAdmin
                ? "Falta configuración del servidor (credenciales OAuth). Revisa la guía en el asistente de conexión."
                : "La conexión con Google aún no está disponible en tu espacio. Avisa a un administrador."}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {connected ? (
            <button onClick={disconnect} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50">
              {busy ? "…" : "Desconectar"}
            </button>
          ) : (
            <a
              href="/api/integrations/gmb-google/connect"
              className={`text-xs px-3 py-1.5 rounded-lg text-white ${demo || !configured ? "bg-slate-300 pointer-events-none" : "bg-brand-600 hover:bg-brand-700"}`}
              aria-disabled={demo || !configured}
            >
              Conectar con Google
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Conexiones ──────────────────────────────────────────────────────────────────────────────────
function ConnectionsPanel({ demo }: { demo: boolean }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/v1/gmb/connections").then((r) => r.json()).then((d) => setData(d.ok ? d : GROWTH_DEMO.connections)).catch(() => setData(GROWTH_DEMO.connections));
  }, []);
  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      {demo && <DemoBanner text="Estado de conexiones de ejemplo. Con tu cuenta verás el estado real (nunca se muestran claves)." />}
      <GoogleConnectionCard demo={demo} />
      <div className="text-xs text-slate-500">Conectadas <b className="text-slate-700">{data.summary?.connected ?? 0}</b> de {data.summary?.total ?? 0}. Nunca se muestran claves, solo el estado.</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(data.connections ?? []).map((c: any) => (
          <div key={c.id} className={`${CARD} flex items-start justify-between gap-2`}>
            <div><div className="text-sm font-medium text-slate-800">{c.name} <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${c.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{c.connected ? "conectado" : "sin conectar"}</span></div><div className="text-[11px] text-slate-500 mt-0.5">{c.scope}</div><div className="text-[11px] text-slate-400 mt-0.5">{c.note}</div>{c.envVar && <div className="text-[10px] text-slate-300 mt-0.5">Config: {c.envVar}</div>}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-800 mb-2">Checklist de puesta en marcha</div>
        <ul className="space-y-1">
          {(data.checklist ?? []).map((it: any, i: number) => (
            <li key={i} className="flex items-start gap-2 text-xs"><span className={it.done ? "text-emerald-600" : "text-slate-300"}>{it.done ? "✓" : "○"}</span><span className={it.done ? "text-slate-500 line-through" : "text-slate-700"}>{it.label}</span><span className="text-slate-400">— {it.hint}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Attribution / ROI ──────────────────────────────────────────────────────────────────────────
const EVENT_LABEL: Record<string, string> = { click: "Clicks", call: "Llamadas", directions: "Cómo llegar", request: "Solicitudes" };
function AttributionPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState({ name: "", landingUrl: "", utmSource: "", utmMedium: "", utmCampaign: "" });
  const [builtUrl, setBuiltUrl] = useState<string | null>(null);
  const load = useCallback(() => { if (isDemo) return; fetch(`/api/v1/gmb/clients/${clientId}/attribution`).then((r) => r.json()).then((d) => setData(d.ok ? d : null)); }, [clientId, isDemo]);
  useEffect(() => { load(); }, [load]);
  async function createCampaign() {
    if (!clientId) return;
    const r = await fetch(`/api/v1/gmb/clients/${clientId}/campaigns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setBuiltUrl(d.campaign?.utmUrl ?? null); load(); } else alert(d?.error?.message ?? "Error");
  }
  const d = isDemo ? (GROWTH_DEMO as any).attribution : data;
  if (!d) return <Spinner />;
  const agg = d.aggregate;
  return (
    <div className="space-y-4">
      {!d.hasData && !isDemo && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Aún no hay eventos de atribución. Usa el <b>enlace de tracking</b> de una campaña (UTM) para registrar clicks reales — nunca se inventan conversiones.</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["click", "call", "directions", "request"] as const).map((t) => (
          <div key={t} className={`${CARD} text-center py-3`}><div className="text-xl font-bold text-slate-800">{agg.current[t]}</div><div className="text-[11px] text-slate-400">{EVENT_LABEL[t]}</div>{agg.deltaPct[t] != null && <div className={`text-[10px] ${agg.deltaPct[t] > 0 ? "text-emerald-600" : agg.deltaPct[t] < 0 ? "text-rose-600" : "text-slate-400"}`}>{agg.deltaPct[t] > 0 ? "▲" : agg.deltaPct[t] < 0 ? "▼" : ""}{Math.abs(agg.deltaPct[t])}% vs mes ant.</div>}</div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className={`${CARD}`}><div className="text-sm font-semibold text-slate-800 mb-1">Objetivos</div>{(d.goals ?? []).length === 0 ? <div className="text-xs text-slate-500">Sin objetivos definidos.</div> : (d.goals ?? []).map((g: any) => (<div key={g.metric} className="text-xs mb-1"><div className="flex justify-between"><span>{g.metric}</span><span>{g.actual}/{g.target}</span></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${g.pct}%` }} /></div></div>))}</div>
        <div className={`${CARD}`}><div className="text-sm font-semibold text-slate-800 mb-1">Por fuente / campaña</div><div className="text-xs text-slate-600">{(agg.bySource ?? []).map((s: any) => `${s.source} (${s.count})`).join(" · ") || "—"}</div><div className="text-[11px] text-slate-400 mt-1">Campañas: {(agg.byCampaign ?? []).map((c: any) => `${c.campaign} (${c.count})`).join(" · ") || "—"}</div></div>
      </div>
      <div className={`${CARD}`}>
        <div className="text-sm font-semibold text-slate-800 mb-2">UTM builder</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {(["name", "landingUrl", "utmSource", "utmMedium", "utmCampaign"] as const).map((f) => (
            <input key={f} disabled={isDemo} value={(form as any)[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} placeholder={f} className="rounded-lg border px-2 py-1 text-xs disabled:opacity-60" />
          ))}
          <button onClick={createCampaign} disabled={isDemo} className="text-xs px-3 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Crear campaña</button>
        </div>
        {builtUrl && <div className="mt-2 text-[11px] break-all"><span className="text-slate-500">URL con UTMs: </span><span className="font-mono">{builtUrl}</span></div>}
      </div>
      {(d.campaigns ?? []).length > 0 && <div className="text-xs text-slate-500">Campañas: {(d.campaigns ?? []).map((c: any) => c.name).join(" · ")}</div>}
    </div>
  );
}

// ── Captación de reseñas ────────────────────────────────────────────────────────────────────────
function AcquisitionPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("link");
  const load = useCallback(() => { if (isDemo) return; fetch(`/api/v1/gmb/clients/${clientId}/review-campaigns`).then((r) => r.json()).then((d) => setCampaigns(d.campaigns ?? [])); }, [clientId, isDemo]);
  useEffect(() => { load(); }, [load]);
  async function create() {
    if (!clientId || !name.trim()) return;
    const r = await fetch(`/api/v1/gmb/clients/${clientId}/review-campaigns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, channel }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setName(""); load(); } else alert(d?.error?.message ?? "Error (¿incentivo o review gating?)");
  }
  const list = isDemo ? (GROWTH_DEMO as any).acquisition.campaigns : campaigns;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">Compliance: la reseña va a Google para <b>todos</b> (sin filtrar por sentimiento), <b>sin incentivos</b> y <b>sin review gating</b>. Consentimiento obligatorio, opt-out y suppression list. Envíos solo con adapter (WhatsApp) conectado.</div>
      <div className={`${CARD} flex flex-wrap items-end gap-2`}>
        <div><label className="text-[11px] text-slate-500 block">Nombre</label><input disabled={isDemo} value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border px-2 py-1 text-sm disabled:opacity-60" /></div>
        <div><label className="text-[11px] text-slate-500 block">Canal</label><select disabled={isDemo} value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border px-2 py-1 text-sm disabled:opacity-60"><option value="link">Enlace</option><option value="qr">QR</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option></select></div>
        <button onClick={create} disabled={isDemo} className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700 disabled:opacity-50">Crear campaña</button>
      </div>
      {list.length === 0 ? (
        <div className={`${CARD} text-sm text-slate-500`}>Sin campañas de captación. Crea una para generar enlace/QR y métricas reales.</div>
      ) : (
        <ul className="space-y-2">
          {list.map((c: any) => (
            <li key={c.id} className={`${CARD} flex items-start justify-between gap-3`}>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800">{c.name} <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{c.channel}</span></div>
                <div className="text-[11px] text-slate-500 mt-0.5">Contactos {c.metrics?.contacts ?? 0} · enviados {c.metrics?.sent ?? 0} · clicks {c.metrics?.clicked ?? 0}</div>
                {c.publicUrl && c.publicUrl !== "#" && <a href={c.publicUrl} target="_blank" rel="noreferrer" className="text-[11px] text-brand-600 hover:underline inline-flex items-center gap-1 mt-0.5">Landing pública <ExternalLink className="h-3 w-3" /></a>}
              </div>
              {c.qrUrl && c.qrUrl !== "#" ? <img src={c.qrUrl} alt="QR" className="h-16 w-16 rounded border bg-white" /> : <div className="h-16 w-16 rounded border bg-slate-50 grid place-items-center text-[10px] text-slate-400">QR</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
