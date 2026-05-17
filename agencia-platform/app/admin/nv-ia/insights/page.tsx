"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { BarChart3, AlertCircle, Loader2, RefreshCw, TrendingUp, DollarSign, Clock, CheckCircle2 } from "lucide-react";

type Insights = {
  windowDays: number;
  since: string;
  totals: {
    runs: number;
    drafts: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    avgRunDurationSec: number | null;
  };
  runs: { byStatus: Record<string, number>; byTrigger: Record<string, number> };
  drafts: { byStatus: Record<string, number>; byKind: Record<string, number>; approvalRate: number | null };
  topTools: { name: string; count: number }[];
  recentFailed: { id: string; taskId: string; trigger: string; error: string | null; createdAt: string }[];
  recentRequiresHuman: { id: string; taskId: string; trigger: string; summary: string | null; createdAt: string }[];
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-slate-200",
  RUNNING: "bg-sky-300",
  SUCCEEDED: "bg-emerald-400",
  FAILED: "bg-rose-400",
  REQUIRES_HUMAN: "bg-amber-300"
};

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: "Manual (proyecto buzón)",
  MENTION: "@mention",
  PROACTIVE_DEADLINE: "Cron — deadline",
  PROACTIVE_STALE: "Cron — estancada",
  SCHEDULED: "Cron — programado",
  WHATSAPP_INBOUND: "WhatsApp entrante",
  EMAIL_INBOUND: "Email entrante"
};

export default function NvIaInsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/ai-agent/insights?days=${days}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [days]);

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <PageHeader
        title="NV IA — Métricas y salud"
        description="Cómo se está comportando la IA: qué dispara los runs, qué tools usa, cuánto cuesta, qué decisiones requieren tu intervención."
      />

      <div className="mt-6 flex items-center justify-between">
        <div className="inline-flex rounded-lg border bg-white text-xs overflow-hidden">
          {[1, 7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={"px-3 py-1.5 " + (days === d ? "bg-brand-600 text-white font-medium" : "text-slate-600 hover:bg-slate-50")}
            >
              {d === 1 ? "Hoy" : `${d}d`}
            </button>
          ))}
        </div>
        <button onClick={load} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
          <RefreshCw className="h-3.5 w-3.5" /> Refrescar
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading || !data ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          {/* KPIs grandes */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Runs" value={data.totals.runs} hint={`${days} días`} />
            <Kpi
              icon={<DollarSign className="h-4 w-4" />}
              label="Coste estimado"
              value={`$${data.totals.estimatedCostUsd}`}
              hint={`${formatNum(data.totals.inputTokens + data.totals.outputTokens)} tokens`}
            />
            <Kpi
              icon={<Clock className="h-4 w-4" />}
              label="Duración media"
              value={data.totals.avgRunDurationSec === null ? "—" : `${data.totals.avgRunDurationSec}s`}
              hint="por run completado"
            />
            <Kpi
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Aprobación drafts"
              value={data.drafts.approvalRate === null ? "—" : `${data.drafts.approvalRate}%`}
              hint={`${data.totals.drafts} drafts creados`}
            />
          </div>

          {/* Runs por status / trigger */}
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <Card title="Runs por estado">
              <BarList
                items={Object.entries(data.runs.byStatus).map(([k, v]) => ({ label: k, value: v, color: STATUS_COLORS[k] }))}
              />
            </Card>
            <Card title="Runs por trigger (cómo se invocó)">
              <BarList
                items={Object.entries(data.runs.byTrigger).map(([k, v]) => ({ label: TRIGGER_LABEL[k] ?? k, value: v }))}
              />
            </Card>
          </div>

          {/* Drafts */}
          <div className="mt-4 grid md:grid-cols-2 gap-4">
            <Card title="Drafts por estado">
              <BarList items={Object.entries(data.drafts.byStatus).map(([k, v]) => ({ label: k, value: v }))} />
            </Card>
            <Card title="Drafts por tipo">
              <BarList items={Object.entries(data.drafts.byKind).map(([k, v]) => ({ label: k, value: v }))} />
            </Card>
          </div>

          {/* Top tools */}
          <Card title={`Top tools (${data.topTools.length})`} className="mt-4">
            {data.topTools.length === 0 ? (
              <p className="text-xs text-slate-500">Sin uso registrado en esta ventana.</p>
            ) : (
              <BarList items={data.topTools.map((t) => ({ label: t.name, value: t.count }))} />
            )}
          </Card>

          {/* FAILED y REQUIRES_HUMAN */}
          <div className="mt-4 grid md:grid-cols-2 gap-4">
            <Card title={`Últimos FAILED (${data.recentFailed.length})`}>
              {data.recentFailed.length === 0 ? (
                <p className="text-xs text-emerald-700">✓ Cero fallos en esta ventana.</p>
              ) : (
                <ul className="space-y-2">
                  {data.recentFailed.map((r) => (
                    <li key={r.id} className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <AlertCircle className="h-3 w-3 text-rose-600 shrink-0" />
                        <a href={`/tasks/${r.taskId}`} className="font-mono text-brand-600 hover:underline truncate">
                          task:{r.taskId.slice(0, 10)}
                        </a>
                        <span className="text-slate-400">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>
                      </div>
                      <div className="ml-4 text-rose-700 leading-tight mt-0.5">{r.error}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={`Últimos REQUIRES_HUMAN (${data.recentRequiresHuman.length})`}>
              {data.recentRequiresHuman.length === 0 ? (
                <p className="text-xs text-slate-500">Ninguno — la IA resolvió todo o lo dejó SUCCEEDED.</p>
              ) : (
                <ul className="space-y-2">
                  {data.recentRequiresHuman.map((r) => (
                    <li key={r.id} className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-700">⚠</span>
                        <a href={`/tasks/${r.taskId}`} className="font-mono text-brand-600 hover:underline truncate">
                          task:{r.taskId.slice(0, 10)}
                        </a>
                      </div>
                      <div className="ml-4 text-slate-600 leading-tight mt-0.5">{r.summary ?? "(sin resumen)"}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <p className="mt-6 text-xs text-slate-500">
            <strong>Cómo leer esto:</strong> tasa de aprobación de drafts {">"}80% es señal sana — la IA acierta el
            tono. {"<"}50% indica que el system prompt o la memoria del cliente necesitan tunning. FAILED
            recurrentes con el mismo error suelen significar que falta una integración (Drive, WAHA, etc) o
            que un cliente no existe en BD.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${className ?? ""}`}>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function BarList({ items }: { items: { label: string; value: number; color?: string }[] }) {
  if (items.length === 0) return <p className="text-xs text-slate-500">Sin datos.</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map((i, idx) => (
        <li key={idx} className="text-xs">
          <div className="flex items-center justify-between mb-0.5">
            <span className="truncate text-slate-700">{i.label}</span>
            <span className="font-mono text-slate-500 shrink-0 ml-2">{i.value}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${i.color ?? "bg-brand-500"}`}
              style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}K`;
  return `${Math.round(n / 100_000) / 10}M`;
}
