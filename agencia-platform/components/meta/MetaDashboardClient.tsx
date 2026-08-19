"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Bot, Loader2, Megaphone, MessageSquare, RefreshCw, Sparkles, Target } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import MetaSuiteNav from "@/components/meta/MetaSuiteNav";
import MetaAttributionPanel from "@/components/meta/MetaAttributionPanel";
import MetaDirectorPanel from "@/components/meta/MetaDirectorPanel";
import MetaIntelligencePanel from "@/components/meta/MetaIntelligencePanel";
import MetaCreativeLab from "@/components/meta/MetaCreativeLab";

type Account = { id: string; name: string; currency: string; connectionId: string; connectionName: string };
type Campaign = { id: string; name: string; objective?: string | null; leads: number; spend: number; cpl: number | null; ctr: number; impressions: number };
type Bucket = { label: string; leads: number; spend: number; cpl: number | null };
type Recommendation = { severity: "high" | "medium" | "low"; title: string; detail: string };
type AiRecommendation = { priority: string; title: string; rationale: string; action: string; confidence: number };
type Monitoring = { campaigns: Campaign[]; buckets: Bucket[]; summary: { activeCampaigns: number; leads: number; spend: number; cpl: number | null; leadChangePct: number | null }; recommendations: Recommendation[]; generatedAt: string };

const euro = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
const number = (value: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value);

function LeadsChart({ buckets }: { buckets: Bucket[] }) {
  const max = Math.max(1, ...buckets.map((item) => item.leads));
  return <div className="grid h-64 grid-cols-6 items-end gap-2" role="img" aria-label="Evolución de leads en bloques de 15 días">
    {buckets.map((bucket) => <div key={bucket.label} className="flex h-full min-w-0 flex-col justify-end gap-2 text-center">
      <div className="text-sm font-bold text-slate-800">{number(bucket.leads)}</div>
      <div className="group relative mx-auto w-full max-w-20 rounded-t-lg bg-gradient-to-t from-indigo-600 to-violet-400 transition hover:from-indigo-700" style={{ height: `${Math.max(5, bucket.leads / max * 170)}px` }} title={`${bucket.leads} leads · ${euro(bucket.spend)} · CPL ${euro(bucket.cpl)}`} />
      <div className="truncate text-[10px] text-slate-500 sm:text-xs">{bucket.label}</div>
    </div>)}
  </div>;
}

export default function MetaDashboardClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<Monitoring | null>(null);
  const [ai, setAi] = useState<AiRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = useMemo(() => accounts.find((item) => `${item.connectionId}:${item.id}` === selected), [accounts, selected]);

  const loadAccounts = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/v1/meta-comments?catalog=accounts", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "No se pudieron cargar las cuentas de Meta");
      const items: Account[] = body.items ?? [];
      setAccounts(items);
      if (items.length) setSelected((current) => current || `${items[0].connectionId}:${items[0].id}`);
      else setLoading(false);
    } catch (cause: any) { setError(String(cause?.message ?? cause)); setLoading(false); }
  }, []);

  const loadMonitoring = useCallback(async (chosen: Account) => {
    setLoading(true); setError(null); setAi([]);
    try {
      const params = new URLSearchParams({ accountId: chosen.id, connectionId: chosen.connectionId });
      const response = await fetch(`/api/v1/meta-monitoring?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "No se pudo analizar la cuenta");
      setData(body);
    } catch (cause: any) { setError(String(cause?.message ?? cause)); setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { if (account) void loadMonitoring(account); }, [account, loadMonitoring]);

  async function analyzeWithAi() {
    if (!account || !data) return;
    setAiLoading(true); setError(null);
    try {
      const response = await fetch("/api/v1/meta-monitoring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: account.id, connectionId: account.connectionId, summary: data.summary, campaigns: data.campaigns }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "No se pudo generar el análisis");
      setAi(body.recommendations ?? []);
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setAiLoading(false); }
  }

  const trend = data?.summary.leadChangePct ?? null;
  return <div className="p-4 sm:p-6">
    <MetaSuiteNav />
    <PageHeader title="META" description="Supervisión, recomendaciones y creación de campañas de Meta desde un único centro." actions={<div className="flex gap-2"><Link href="/admin/meta-comments" className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold"><MessageSquare className="h-4 w-4" /> Comentarios</Link><Link href="/campanas-meta" className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"><Sparkles className="h-4 w-4" /> Crear campaña con IA</Link></div>} />

    <section className="mb-5 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-64 flex-1 text-sm font-semibold text-slate-700">Cuenta publicitaria<select value={selected} onChange={(event) => setSelected(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"><option value="">Selecciona una cuenta…</option>{accounts.map((item) => <option key={`${item.connectionId}:${item.id}`} value={`${item.connectionId}:${item.id}`}>{item.name} · {item.connectionName} · {item.id}</option>)}</select></label><button disabled={!account || loading} onClick={() => account && void loadMonitoring(account)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar análisis</button></div>
      {!accounts.length && !loading && <p className="mt-3 text-sm text-amber-700">No hay cuentas publicitarias conectadas. Vincula Meta desde Comentarios Meta para comenzar.</p>}
    </section>

    {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {loading && <div className="flex items-center justify-center gap-2 rounded-xl border bg-white p-12 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Analizando campañas activas y últimos 90 días…</div>}

    {!loading && data && <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[{ label: "Campañas activas", value: number(data.summary.activeCampaigns), icon: Megaphone }, { label: "Leads · 30 días", value: number(data.summary.leads), icon: Target }, { label: "Inversión · 30 días", value: euro(data.summary.spend), icon: null }, { label: "CPL medio", value: euro(data.summary.cpl), icon: null }].map((card) => <div key={card.label} className="rounded-xl border bg-white p-4"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{card.icon && <card.icon className="h-4 w-4" />}{card.label}</div><div className="mt-2 text-2xl font-bold text-slate-900">{card.value}</div></div>)}
        <div className={`rounded-xl border p-4 ${trend !== null && trend < 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cambio últimos 15 días</div><div className="mt-2 flex items-center gap-1 text-2xl font-bold">{trend === null ? "Sin comparación" : <>{trend >= 0 ? <ArrowUpRight className="h-6 w-6 text-emerald-600" /> : <ArrowDownRight className="h-6 w-6 text-red-600" />}{Math.abs(trend).toFixed(0)}%</>}</div></div>
      </div>

      {account && <MetaAttributionPanel accountId={account.id} accountName={account.name} connectionId={account.connectionId} campaigns={data.campaigns} spend={data.summary.spend} />}
      {account && <MetaDirectorPanel accountId={account.id} monitoring={data.summary} campaigns={data.campaigns} />}
      {account && <MetaIntelligencePanel accountId={account.id} accountName={account.name} monitoring={data.summary} />}
      {account && <MetaCreativeLab accountId={account.id} campaigns={data.campaigns} monitoring={data.summary} />}

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border bg-white p-5"><div className="mb-2"><h2 className="text-lg font-bold">Evolución de leads</h2><p className="text-sm text-slate-500">Últimos 90 días agrupados en periodos reales de 15 días. Pasa el cursor para ver inversión y CPL.</p></div><LeadsChart buckets={data.buckets} /></section>
        <section className="rounded-xl border bg-white p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Recomendaciones</h2><p className="text-sm text-slate-500">Alertas calculadas con datos reales.</p></div><button onClick={() => void analyzeWithAi()} disabled={aiLoading} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} Analizar con IA</button></div><div className="space-y-3">{data.recommendations.map((item) => <div key={item.title} className={`rounded-lg border p-3 ${item.severity === "high" ? "border-red-200 bg-red-50" : item.severity === "medium" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{item.title}</div><p className="mt-1 text-sm text-slate-600">{item.detail}</p></div>)}</div></section>
      </div>

      {ai.length > 0 && <section className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 p-5"><h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Bot className="h-5 w-5" /> Plan recomendado por IA</h2><div className="grid gap-3 lg:grid-cols-3">{ai.map((item, index) => <div key={`${item.title}-${index}`} className="rounded-lg bg-white p-4 shadow-sm"><div className="mb-1 text-xs font-bold uppercase text-indigo-600">Prioridad {item.priority} · Confianza {Math.round(Math.min(100, item.confidence <= 1 ? item.confidence * 100 : item.confidence))}%</div><div className="font-bold">{item.title}</div><p className="mt-1 text-sm text-slate-600">{item.rationale}</p><div className="mt-3 rounded bg-slate-50 p-2 text-sm font-medium">Acción: {item.action}</div></div>)}</div><p className="mt-3 text-xs text-slate-500">Las recomendaciones no modifican campañas automáticamente: requieren tu revisión y aprobación.</p></section>}

      <section className="overflow-hidden rounded-xl border bg-white"><div className="border-b p-5"><h2 className="text-lg font-bold">Rendimiento por campaña activa</h2><p className="text-sm text-slate-500">Métricas atribuidas de los últimos 30 días.</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Campaña</th><th className="p-3 text-right">Leads</th><th className="p-3 text-right">Inversión</th><th className="p-3 text-right">CPL</th><th className="p-3 text-right">CTR</th></tr></thead><tbody className="divide-y">{data.campaigns.map((campaign) => <tr key={campaign.id}><td className="p-3"><div className="font-semibold">{campaign.name}</div><div className="text-xs text-slate-500">{campaign.objective ?? campaign.id}</div></td><td className="p-3 text-right font-semibold">{number(campaign.leads)}</td><td className="p-3 text-right">{euro(campaign.spend)}</td><td className="p-3 text-right">{euro(campaign.cpl)}</td><td className="p-3 text-right">{number(campaign.ctr)}%</td></tr>)}</tbody></table>{!data.campaigns.length && <div className="p-8 text-center text-sm text-slate-500">No hay campañas activas en esta cuenta.</div>}</div></section>
      <p className="mt-3 text-right text-xs text-slate-400">Último análisis: {new Date(data.generatedAt).toLocaleString("es-ES")}</p>
    </>}
  </div>;
}
