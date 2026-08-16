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
import { Loader2, Gauge, Sparkles, MapPin, Megaphone, MessageSquare, Globe, FileText, ListChecks, Check, X, ChevronRight, ExternalLink } from "lucide-react";
import { GROWTH_DEMO } from "@/lib/gmb/growth-demo";

type Ficha = { id: string; name: string; category?: string };
type Breakdown = { profile: number; reviews: number; content: number; citations: number; ranking: number; web: number };

const BREAKDOWN_LABELS: Record<keyof Breakdown, string> = { profile: "Perfil", reviews: "Reseñas", content: "Contenido", citations: "Citaciones", ranking: "Ranking", web: "Web" };
const CARD = "bg-white rounded-xl border p-4";

type TabKey = "presencia" | "aicouncil" | "rank" | "contenido" | "reseñas" | "web" | "informes" | "citaciones" | "acciones";
const TABS: [TabKey, string, any][] = [
  ["presencia", "Presencia", Gauge], ["aicouncil", "AI Council", Sparkles], ["rank", "Rank & Competencia", MapPin],
  ["contenido", "Contenido", Megaphone], ["reseñas", "Reseñas IA", MessageSquare], ["web", "Web local", Globe],
  ["informes", "Informes", FileText], ["citaciones", "Citaciones", MapPin], ["acciones", "Acciones", ListChecks]
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
  useEffect(() => {
    if (isDemo) return;
    setFetched(null);
    fetch(`/api/v1/gmb/clients/${clientId}/rank`).then((r) => r.json()).then((d) => setFetched(d.ok ? d : null));
  }, [clientId, isDemo]);
  const data = isDemo ? GROWTH_DEMO.rank : fetched;
  if (!data) return <Spinner />;
  const connected = data.provider?.connected;
  return (
    <div className="space-y-3">
      {!connected && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Proveedor de rank (Google Maps) <b>sin conectar</b>. Se muestran las últimas mediciones guardadas; no se fabrican posiciones. Configura la clave de Maps para medir en vivo.</div>}
      {data.keywords?.length === 0 ? <div className={`${CARD} text-sm text-slate-500`}>No hay keywords rastreadas. Añádelas desde la ficha (pestaña Ranking) para medir el rank grid.</div> : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="text-left px-3 py-2.5">Keyword</th><th className="text-left px-3 py-2.5">Pos. media</th><th className="text-left px-3 py-2.5">Top3</th><th className="text-left px-3 py-2.5">Cobertura</th><th className="text-left px-3 py-2.5">Última</th></tr></thead>
            <tbody className="divide-y">{data.keywords.map((k: any) => (
              <tr key={k.keyword} className="hover:bg-slate-50"><td className="px-3 py-2 font-medium">{k.keyword}{k.isPrimary && <span className="ml-1 text-[10px] px-1 rounded bg-brand-50 text-brand-700">principal</span>}</td><td className="px-3 py-2">{k.avgPosition ?? "—"}</td><td className="px-3 py-2">{k.top3Count ?? "—"}</td><td className="px-3 py-2">{k.visibilityShare != null ? `${k.visibilityShare}%` : "—"}</td><td className="px-3 py-2 text-[11px] text-slate-400">{k.lastCheckedAt ? new Date(k.lastCheckedAt).toLocaleDateString("es-ES") : "sin medir"}</td></tr>))}
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
function ContentPanel({ clientId }: { clientId: string | null }) {
  const isDemo = !clientId;
  const [fetched, setFetched] = useState<any>(null);
  useEffect(() => {
    if (isDemo) return;
    setFetched(null);
    fetch(`/api/v1/gmb/clients/${clientId}/content-ideas`).then((r) => r.json()).then((d) => setFetched(d.ok ? d : null));
  }, [clientId, isDemo]);
  const data = isDemo ? GROWTH_DEMO.content : fetched;
  if (!data) return <Spinner />;
  const cadenceCls = data.cadence?.status === "good" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : data.cadence?.status === "low" ? "text-amber-700 bg-amber-50 border-amber-200" : "text-rose-700 bg-rose-50 border-rose-200";
  return (
    <div className="space-y-3">
      <div className={`rounded-lg border px-3 py-2 text-xs ${cadenceCls}`}>{data.cadence?.message}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.ideas.map((idea: any, i: number) => (
          <div key={i} className={`${CARD}`}>
            <div className="flex items-center gap-2 mb-1"><span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase">{idea.type === "update" ? "novedad" : idea.type === "offer" ? "oferta" : "evento"}</span><span className="text-sm font-medium text-slate-800">{idea.title}</span></div>
            <div className="text-xs text-slate-500">{idea.content}</div>
            <div className="mt-2 text-[11px] text-slate-400">CTA sugerido: {idea.cta} · <span className="text-slate-500">borrador (no publica)</span></div>
          </div>
        ))}
      </div>
      {(data.recent?.length ?? 0) > 0 && <div className="text-xs text-slate-500">Últimas publicaciones: {data.recent.map((p: any) => `${p.title} (${p.status})`).join(" · ")}</div>}
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
function ReportPanel({ clientId }: { clientId: string | null }) {
  return (
    <div className={`${CARD} space-y-2`}>
      <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-600" /><span className="text-sm font-semibold text-slate-800">Informe mensual del cliente</span></div>
      <p className="text-xs text-slate-500">Resumen con evolución, reseñas, tareas y recomendaciones, en formato imprimible/exportable.</p>
      {clientId ? (
        <a href={`/gmb-hub/report/${clientId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm w-fit">Abrir informe imprimible <ChevronRight className="h-3.5 w-3.5" /></a>
      ) : (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">En demo no hay informe real. Con una ficha conectada podrás abrir el informe mensual imprimible.</div>
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
  const data = isDemo ? GROWTH_DEMO.citations : fetched;
  if (!data) return <Spinner />;
  const citations: any[] = data.citations ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-slate-600">Total <b>{data.summary?.total ?? 0}</b></span><span className="text-rose-600">Accionables <b>{data.summary?.actionable ?? 0}</b></span>{clientId && <button onClick={seed} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "＋"} Generar inventario</button>}</div>
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
  const load = useCallback(async () => {
    if (isDemo) return;
    const a = await fetch(`/api/v1/gmb/clients/${clientId}/actions`).then((r) => r.json()).catch(() => null);
    setFetched(a);
  }, [clientId, isDemo]);
  useEffect(() => { void load(); }, [load]);
  async function generate() { if (!clientId) return; setBusy(true); try { await fetch(`/api/v1/gmb/clients/${clientId}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useAiCouncil: false }) }); await load(); } finally { setBusy(false); } }
  async function transition(id: string, command: string) {
    if (!clientId) return;
    if (command === "execute" && !window.confirm("Ejecutar el efecto interno seguro (crea borradores; no publica nada externo). ¿Continuar?")) return;
    await fetch(`/api/v1/gmb/actions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) });
    await load();
  }
  const data = isDemo ? GROWTH_DEMO.actions : fetched;
  if (!data) return <Spinner />;
  const actions: any[] = data.actions ?? [];
  return (
    <div className="space-y-3">
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
