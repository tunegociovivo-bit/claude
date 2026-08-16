"use client";

/**
 * Centro de crecimiento SEO local (GMB Hub). Reúne, por ficha:
 *   - Presencia local (Local Presence Score 0–100 + desglose + oportunidades + evolución),
 *   - Citaciones (inventario NAP por directorio + paquete de alta),
 *   - Acciones (piloto automático) + AI Council (multimodelo, honesto).
 *
 * Estados vacíos útiles: si el workspace no tiene fichas, muestra una PREVIEW/DEMO claramente
 * etiquetada (datos de ejemplo, no reales) para que el primer viewport sea operativo. Reutiliza el
 * estilo del Hub (brand-*, tarjetas rounded-xl border). Todo pasa por las APIs tenant-scoped.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Gauge, MapPin, ListChecks, Sparkles, Check, X, ExternalLink, ChevronRight } from "lucide-react";

type Ficha = { id: string; name: string; category?: string };
type Breakdown = { profile: number; reviews: number; content: number; citations: number; ranking: number; web: number };
type Opportunity = { module: string; type: string; title: string; description: string; impact: number; effort: number; confidence: number; priority: number; external: boolean };
type Presence = { score: number; breakdown: Breakdown; weights: Breakdown; opportunities: Opportunity[]; history: { total: number; recordedAt: string }[] };

const BREAKDOWN_LABELS: Record<keyof Breakdown, string> = { profile: "Perfil", reviews: "Reseñas", content: "Contenido", citations: "Citaciones", ranking: "Ranking", web: "Web" };

// ── DEMO (datos de ejemplo, NO reales) para el estado vacío ──────────────────────────────────────
const DEMO_PRESENCE: Presence = {
  score: 62,
  breakdown: { profile: 80, reviews: 70, content: 45, citations: 40, ranking: 55, web: 60 },
  weights: { profile: 20, reviews: 25, content: 15, citations: 15, ranking: 15, web: 10 },
  opportunities: [
    { module: "citations", type: "fix_inconsistencies", title: "Corregir 3 NAP inconsistentes", description: "Hay directorios con teléfono antiguo. Unifica el NAP para no penalizar el SEO local.", impact: 70, effort: 35, confidence: 85, priority: 170, external: true },
    { module: "reviews", type: "reply_reviews", title: "Responder reseñas pendientes", description: "Tasa de respuesta 55%. Responder todas mejora ranking y confianza.", impact: 65, effort: 20, confidence: 90, priority: 292, external: true },
    { module: "content", type: "schedule_posts", title: "Programar publicaciones semanales", description: "Solo 1 post en 30 días. Programa 1 novedad/semana.", impact: 50, effort: 30, confidence: 80, priority: 133, external: true }
  ],
  history: []
};

function scoreColor(n: number): string {
  if (n >= 75) return "text-emerald-600";
  if (n >= 50) return "text-amber-600";
  return "text-rose-600";
}
function scoreStroke(n: number): string {
  if (n >= 75) return "#059669";
  if (n >= 50) return "#d97706";
  return "#e11d48";
}

function ScoreRing({ value }: { value: number }) {
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div className="relative h-32 w-32" role="img" aria-label={`Presencia local ${value} sobre 100`}>
      <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={scoreStroke(value)} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className={`text-3xl font-bold ${scoreColor(value)}`}>{value}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">/ 100</div>
        </div>
      </div>
    </div>
  );
}

function BreakdownBars({ breakdown }: { breakdown: Breakdown }) {
  return (
    <div className="space-y-1.5">
      {(Object.keys(BREAKDOWN_LABELS) as (keyof Breakdown)[]).map((k) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-20 text-slate-500">{BREAKDOWN_LABELS[k]}</span>
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${breakdown[k]}%` }} />
          </div>
          <span className="w-8 text-right font-medium text-slate-700">{breakdown[k]}</span>
        </div>
      ))}
    </div>
  );
}

const PILL = "px-3 py-1.5 rounded-lg text-sm transition-colors";
const CARD = "bg-white rounded-xl border p-4";

export default function GrowthCenter() {
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [sub, setSub] = useState<"presencia" | "citaciones" | "acciones">("presencia");
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/v1/gmb/clients");
        const d = await r.json().catch(() => ({}));
        const list: Ficha[] = (d.clients ?? []).map((c: any) => ({ id: c.id, name: c.name, category: c.category }));
        setFichas(list);
        if (list.length) setSelected(list[0].id);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="grid place-items-center py-20 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const hasFichas = fichas.length > 0;
  const showDemo = !hasFichas && demo;

  return (
    <div className="space-y-4">
      {/* Cabecera + selección de ficha / demo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(["presencia", "citaciones", "acciones"] as const).map((k) => (
            <button key={k} onClick={() => setSub(k)} aria-pressed={sub === k} className={`${PILL} ${sub === k ? "bg-white shadow-sm text-slate-900 border" : "text-slate-500 hover:text-slate-800"}`}>
              {k === "presencia" ? "Presencia local" : k === "citaciones" ? "Citaciones" : "Acciones"}
            </button>
          ))}
        </div>
        {hasFichas ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Ficha:</span>
            <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {fichas.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        ) : (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="accent-brand-600" />
            Ver demo (datos de ejemplo)
          </label>
        )}
      </div>

      {/* Estado vacío honesto */}
      {!hasFichas && !showDemo && (
        <div className={`${CARD} text-center py-12`}>
          <Gauge className="h-10 w-10 mx-auto text-brand-500" />
          <h3 className="mt-3 font-semibold text-slate-800">Aún no tienes fichas conectadas</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">Crea o importa una ficha de Google Business para calcular su Presencia local, auditar citaciones y activar el piloto de crecimiento.</p>
          <button onClick={() => setDemo(true)} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm">Ver una demo realista</button>
        </div>
      )}

      {showDemo && <DemoBanner />}

      {(hasFichas || showDemo) && sub === "presencia" && <PresencePanel clientId={showDemo ? null : selected} onGoActions={() => setSub("acciones")} />}
      {(hasFichas || showDemo) && sub === "citaciones" && <CitationsPanel clientId={showDemo ? null : selected} />}
      {(hasFichas || showDemo) && sub === "acciones" && <ActionsPanel clientId={showDemo ? null : selected} />}
    </div>
  );
}

function DemoBanner() {
  return <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Estás viendo una <strong>DEMO</strong> con datos de ejemplo. No son datos reales ni se guardan en tu cuenta.</div>;
}

// ── Presencia ─────────────────────────────────────────────────────────────────────────────────
function PresencePanel({ clientId, onGoActions }: { clientId: string | null; onGoActions: () => void }) {
  const [data, setData] = useState<Presence | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!clientId) { setData(DEMO_PRESENCE); return; }
    setLoading(true);
    fetch(`/api/v1/gmb/clients/${clientId}/presence?snapshot=1`).then((r) => r.json()).then((d) => setData(d.ok ? d : null)).finally(() => setLoading(false));
  }, [clientId]);

  if (loading || !data) return <div className="py-10 grid place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className={`${CARD} flex flex-col items-center justify-center gap-2`}>
        <ScoreRing value={data.score} />
        <div className="text-sm font-medium text-slate-700">Local Presence Score</div>
        {data.history.length > 1 && <div className="text-xs text-slate-400">{data.history.length} mediciones</div>}
      </div>
      <div className={`${CARD} md:col-span-2`}>
        <div className="text-sm font-semibold text-slate-800 mb-3">Desglose por dimensión</div>
        <BreakdownBars breakdown={data.breakdown} />
      </div>
      <div className={`${CARD} md:col-span-3`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-800">Oportunidades priorizadas</div>
          {clientId && <button onClick={onGoActions} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">Generar plan en Acciones <ChevronRight className="h-3 w-3" /></button>}
        </div>
        {data.opportunities.length === 0 ? (
          <div className="text-sm text-slate-500">Sin oportunidades pendientes: la ficha está bien optimizada. 🎉</div>
        ) : (
          <ul className="space-y-2">
            {data.opportunities.map((o) => (
              <li key={o.type} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">{o.title}{o.external && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">requiere aprobación</span>}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{o.description}</div>
                </div>
                <div className="shrink-0 text-right text-[11px] text-slate-500">
                  <div>impacto <b className="text-slate-700">{o.impact}</b></div>
                  <div>esfuerzo <b className="text-slate-700">{o.effort}</b></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Citaciones ────────────────────────────────────────────────────────────────────────────────
const CITATION_STATUS_META: Record<string, { label: string; cls: string }> = {
  not_found: { label: "No encontrada", cls: "bg-slate-100 text-slate-600" },
  pending: { label: "Pendiente", cls: "bg-amber-50 text-amber-700" },
  prepared: { label: "Preparada", cls: "bg-blue-50 text-blue-700" },
  submitted: { label: "Enviada", cls: "bg-indigo-50 text-indigo-700" },
  published: { label: "Publicada", cls: "bg-emerald-50 text-emerald-700" },
  inconsistent: { label: "Inconsistente", cls: "bg-rose-50 text-rose-700" },
  duplicate: { label: "Duplicada", cls: "bg-fuchsia-50 text-fuchsia-700" },
  error: { label: "Error", cls: "bg-rose-100 text-rose-700" }
};

const DEMO_CITATIONS = {
  citations: [
    { id: "d1", directoryName: "Google Business Profile", authority: 100, status: "published", diffs: null },
    { id: "d2", directoryName: "Páginas Amarillas", authority: 70, status: "inconsistent", diffs: { phone: true } },
    { id: "d3", directoryName: "Yelp España", authority: 74, status: "not_found", diffs: null }
  ],
  summary: { total: 3, actionable: 2, byStatus: { published: 1, inconsistent: 1, not_found: 1 } },
  recommendations: [{ slug: "bing-places", name: "Bing Places", authority: 80, submitUrl: "#" }]
};

function CitationsPanel({ clientId }: { clientId: string | null }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!clientId) { setData(DEMO_CITATIONS); return; }
    const r = await fetch(`/api/v1/gmb/clients/${clientId}/citations`);
    setData(await r.json().catch(() => null));
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  async function seed() {
    if (!clientId) return;
    setBusy(true);
    try { await fetch(`/api/v1/gmb/clients/${clientId}/citations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seed" }) }); await load(); } finally { setBusy(false); }
  }
  async function transition(id: string, command: string) {
    if (!clientId) return;
    await fetch(`/api/v1/gmb/citations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) });
    await load();
  }

  if (!data) return <div className="py-10 grid place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const citations: any[] = data.citations ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-600">Total <b>{data.summary?.total ?? 0}</b></span>
        <span className="text-rose-600">Accionables <b>{data.summary?.actionable ?? 0}</b></span>
        {clientId && <button onClick={seed} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "＋"} Generar inventario</button>}
      </div>
      {citations.length === 0 ? (
        <div className={`${CARD} text-sm text-slate-500`}>Sin citaciones catalogadas. Pulsa «Generar inventario» para crear las de los directorios recomendados por sector.</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="text-left px-3 py-2.5">Directorio</th><th className="text-left px-3 py-2.5">Aut.</th><th className="text-left px-3 py-2.5">Estado</th><th className="text-left px-3 py-2.5">NAP</th><th className="text-left px-3 py-2.5">Acción</th></tr>
            </thead>
            <tbody className="divide-y">
              {citations.map((c) => {
                const meta = CITATION_STATUS_META[c.status] ?? CITATION_STATUS_META.not_found;
                const diffFields = c.diffs ? Object.entries(c.diffs).filter(([, v]) => v).map(([k]) => k) : [];
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{c.directoryName}</td>
                    <td className="px-3 py-2 text-slate-500">{c.authority}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-[10px] ${meta.cls}`}>{meta.label}</span></td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{diffFields.length ? <span className="text-rose-600">difiere: {diffFields.join(", ")}</span> : c.status === "published" ? "consistente" : "—"}</td>
                    <td className="px-3 py-2">
                      {clientId ? (
                        <div className="flex gap-1">
                          {c.status === "not_found" && <button onClick={() => transition(c.id, "prepare")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Preparar alta</button>}
                          {c.status === "prepared" && <button onClick={() => transition(c.id, "submit")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Marcar enviada</button>}
                          {c.status === "submitted" && <button onClick={() => transition(c.id, "publish")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Marcar publicada</button>}
                          {c.status === "inconsistent" && <button onClick={() => transition(c.id, "prepare")} className="text-[11px] px-2 py-0.5 rounded border border-rose-200 text-rose-700 hover:bg-rose-50">Corregir</button>}
                        </div>
                      ) : <span className="text-[11px] text-slate-400">demo</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(data.recommendations?.length ?? 0) > 0 && (
        <div className="text-xs text-slate-500">Recomendados sin catalogar: {data.recommendations.map((r: any) => r.name).join(" · ")}</div>
      )}
    </div>
  );
}

// ── Acciones + AI Council ───────────────────────────────────────────────────────────────────────
const ACTION_STATUS_META: Record<string, { label: string; cls: string }> = {
  suggested: { label: "Sugerida", cls: "bg-slate-100 text-slate-600" },
  prepared: { label: "Preparada", cls: "bg-blue-50 text-blue-700" },
  needs_approval: { label: "Requiere aprobación", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "Aprobada", cls: "bg-indigo-50 text-indigo-700" },
  executing: { label: "Ejecutando", cls: "bg-violet-50 text-violet-700" },
  done: { label: "Hecha", cls: "bg-emerald-50 text-emerald-700" },
  dismissed: { label: "Descartada", cls: "bg-slate-100 text-slate-400" },
  error: { label: "Error", cls: "bg-rose-100 text-rose-700" }
};

const DEMO_ACTIONS = {
  actions: [
    { id: "a1", title: "Responder reseñas pendientes", module: "reviews", impact: 65, effort: 20, confidence: 90, status: "needs_approval", external: true, source: "rule" },
    { id: "a2", title: "Añadir descripción del negocio", module: "presence", impact: 60, effort: 20, confidence: 90, status: "suggested", external: false, source: "rule" }
  ],
  summary: { total: 2, open: 2 }, autopilotMode: "suggest_only"
};

function ActionsPanel({ clientId }: { clientId: string | null }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [council, setCouncil] = useState<any>(null);
  const [consent, setConsent] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) { setData(DEMO_ACTIONS); return; }
    const [a, c] = await Promise.all([
      fetch(`/api/v1/gmb/clients/${clientId}/actions`).then((r) => r.json()).catch(() => null),
      fetch(`/api/v1/gmb/clients/${clientId}/ai-council`).then((r) => r.json()).catch(() => null)
    ]);
    setData(a); setCouncil(c);
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  async function generate(useAiCouncil: boolean) {
    if (!clientId) return;
    setBusy(true);
    try { await fetch(`/api/v1/gmb/clients/${clientId}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useAiCouncil, consent }) }); await load(); } finally { setBusy(false); }
  }
  async function transition(id: string, command: string) {
    if (!clientId) return;
    await fetch(`/api/v1/gmb/actions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) });
    await load();
  }

  if (!data) return <div className="py-10 grid place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const actions: any[] = data.actions ?? [];
  const connectedCount = council?.connectedCount ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-600">Cola: <b>{data.summary?.open ?? 0}</b> abiertas</span>
          {clientId && <button onClick={() => generate(false)} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />} Generar plan</button>}
        </div>
        {actions.length === 0 ? (
          <div className={`${CARD} text-sm text-slate-500`}>Cola vacía. Pulsa «Generar plan» para crear acciones priorizadas a partir de la presencia y las citaciones.</div>
        ) : (
          <ul className="space-y-2">
            {actions.map((a) => {
              const meta = ACTION_STATUS_META[a.status] ?? ACTION_STATUS_META.suggested;
              return (
                <li key={a.id} className={`${CARD} flex items-start justify-between gap-3`}>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{a.title}
                      <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                      {a.external && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">externa</span>}
                      {a.source === "ai_council" && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">AI Council</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{a.module} · impacto {a.impact} · esfuerzo {a.effort} · confianza {a.confidence}</div>
                  </div>
                  {clientId && (
                    <div className="shrink-0 flex flex-wrap gap-1 justify-end">
                      {(a.status === "suggested" || a.status === "prepared") && a.external && <button onClick={() => transition(a.id, "request_approval")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Pedir aprobación</button>}
                      {(a.status === "needs_approval" || (!a.external && a.status !== "done" && a.status !== "approved")) && <button onClick={() => transition(a.id, a.external ? "approve" : "prepare")} className="text-[11px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 inline-flex items-center gap-1"><Check className="h-3 w-3" />{a.external ? "Aprobar" : "Preparar"}</button>}
                      {a.status !== "done" && a.status !== "dismissed" && <button onClick={() => transition(a.id, "dismiss")} className="text-[11px] px-2 py-0.5 rounded border text-slate-500 hover:bg-slate-50 inline-flex items-center gap-1"><X className="h-3 w-3" /></button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* AI Council */}
      <div className={`${CARD} space-y-3`}>
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" /><span className="text-sm font-semibold text-slate-800">AI Council</span></div>
        <div className="text-xs text-slate-500">Consulta varios modelos (Claude, Gemini, OpenAI, Perplexity), normaliza y muestra consenso y discrepancias.</div>
        <div className="flex flex-wrap gap-1">
          {(council?.providers ?? [{ provider: "anthropic", connected: false }, { provider: "openai", connected: false }, { provider: "gemini", connected: false }, { provider: "perplexity", connected: false }]).map((p: any) => (
            <span key={p.provider} className={`text-[10px] px-1.5 py-0.5 rounded ${p.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{p.provider}{p.connected ? " ✓" : " · sin conectar"}</span>
          ))}
        </div>
        {connectedCount === 0 && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">No hay modelos conectados. Configura claves en Ajustes para activar el consejo. No se consulta ningún modelo sin claves ni consentimiento.</div>}
        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="accent-brand-600" />
          Autorizo enviar señales (sin PII) de esta ficha a los modelos
        </label>
        {clientId && <button onClick={() => generate(true)} disabled={busy || connectedCount === 0 || !consent} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Consultar consejo</button>}
        {council?.runs?.length > 0 && (
          <div className="text-[11px] text-slate-500 space-y-1">
            <div className="font-medium text-slate-600">Últimas consultas</div>
            {council.runs.slice(0, 3).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between"><span>{r.purpose} · {r.status}</span><span>${(r.costUsd ?? 0).toFixed(4)}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
