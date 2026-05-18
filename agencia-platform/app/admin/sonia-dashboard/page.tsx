"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, TrendingUp, AlertTriangle, CheckCircle2, Clock, DollarSign, Activity } from "lucide-react";

type Dashboard = {
  days: number;
  since: string;
  totals: {
    total: number;
    succeeded: number;
    requiresHuman: number;
    failed: number;
    running: number;
    pending: number;
  };
  successRate: number;
  cost: {
    totalUsd: number;
    avgPerRunUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  topTools: Array<{ name: string; count: number }>;
  topClients: Array<{ id: string; name: string; count: number; cost: number }>;
  topErrors: Array<{ msg: string; count: number }>;
  daily: Array<{ date: string; runs: number; cost: number; succeeded: number }>;
  recent: Array<{
    runId: string;
    taskId: string;
    taskTitle: string;
    clientName: string | null;
    status: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    steps: number;
    durationSec: number | null;
    createdAt: string;
  }>;
};

const STATUS_COLORS: Record<string, string> = {
  SUCCEEDED: "bg-emerald-100 text-emerald-700",
  REQUIRES_HUMAN: "bg-amber-100 text-amber-700",
  FAILED: "bg-rose-100 text-rose-700",
  RUNNING: "bg-violet-100 text-violet-700",
  PENDING: "bg-slate-100 text-slate-600"
};

export default function SoniaDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routing, setRouting] = useState<"always_opus" | "auto" | "cost_saver">("always_opus");
  const [budgetUsd, setBudgetUsd] = useState<number | null>(null);
  const [budgetSpent, setBudgetSpent] = useState<number>(0);
  const [budgetInput, setBudgetInput] = useState<string>("");
  const [savingBudget, setSavingBudget] = useState(false);

  async function loadRouting() {
    try {
      const r = await fetch("/api/v1/admin/sonia-model-routing");
      if (r.ok) {
        const d = await r.json();
        if (d.routing) setRouting(d.routing);
      }
    } catch {}
  }
  async function saveRouting(next: "always_opus" | "auto" | "cost_saver") {
    setRouting(next);
    await fetch("/api/v1/admin/sonia-model-routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routing: next })
    });
  }
  async function loadBudget() {
    try {
      const r = await fetch("/api/v1/admin/sonia-budget");
      if (r.ok) {
        const d = await r.json();
        setBudgetUsd(d.budgetUsd);
        setBudgetSpent(d.spentUsd ?? 0);
        setBudgetInput(d.budgetUsd ? String(d.budgetUsd) : "");
      }
    } catch {}
  }
  async function saveBudget() {
    setSavingBudget(true);
    try {
      const v = budgetInput.trim();
      const budget = v === "" ? null : Number(v);
      await fetch("/api/v1/admin/sonia-budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetUsd: budget })
      });
      await loadBudget();
    } finally {
      setSavingBudget(false);
    }
  }
  useEffect(() => {
    loadRouting();
    loadBudget();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/sonia-dashboard?days=${days}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [days]);

  const maxDailyRuns = Math.max(1, ...(data?.daily.map((d) => d.runs) ?? [1]));

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Dashboard de Sonia"
        description="Qué hace, cuánto cuesta, dónde está fallando. Para que sepas si vale la pena."
        actions={
          <div className="flex gap-1 bg-white border rounded-lg p-0.5">
            {[1, 7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={
                  "px-2.5 py-1 rounded text-xs font-medium " +
                  (days === d
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-100")
                }
              >
                {d === 1 ? "Hoy" : `${d} días`}
              </button>
            ))}
          </div>
        }
      />

      {loading && !data && (
        <div className="text-center py-12 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin inline mr-2" /> Cargando…
        </div>
      )}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard
              icon={<Activity className="h-4 w-4" />}
              label="Runs totales"
              value={data.totals.total.toString()}
              hint={`${data.totals.running + data.totals.pending} activos`}
            />
            <KpiCard
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              label="Tasa éxito"
              value={`${(data.successRate * 100).toFixed(0)}%`}
              hint={`${data.totals.succeeded} OK / ${data.totals.failed + data.totals.requiresHuman} no`}
            />
            <KpiCard
              icon={<DollarSign className="h-4 w-4 text-amber-600" />}
              label="Coste total"
              value={`$${data.cost.totalUsd.toFixed(2)}`}
              hint={`$${data.cost.avgPerRunUsd.toFixed(3)} / run`}
            />
            <KpiCard
              icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              label="Necesita humano"
              value={data.totals.requiresHuman.toString()}
              hint={`${data.totals.failed} fallaron`}
            />
          </div>

          {/* Budget control */}
          <div className="bg-white rounded-xl border p-4 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  💰 Presupuesto mensual del workspace
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tope $USD. Al 80% Sonia avisa. Al 100% bloquea nuevos runs y
                  los marca como necesitan-humano hasta que aumentes el tope o
                  arranque el siguiente mes.
                </p>
                {budgetUsd !== null && (
                  <div className="mt-2 max-w-md">
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="font-medium">
                        ${budgetSpent.toFixed(2)} / ${budgetUsd.toFixed(2)}
                      </span>
                      <span className="text-slate-500">
                        {Math.min(100, Math.round((budgetSpent / budgetUsd) * 100))}%
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={
                          "h-full rounded-full " +
                          (budgetSpent >= budgetUsd
                            ? "bg-rose-500"
                            : budgetSpent >= budgetUsd * 0.8
                              ? "bg-amber-500"
                              : "bg-emerald-500")
                        }
                        style={{
                          width: `${Math.min(100, (budgetSpent / budgetUsd) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">$</span>
                <input
                  type="number"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  placeholder="sin tope"
                  className="w-28 rounded-lg border border-slate-300 p-1.5 text-sm"
                />
                <button
                  onClick={saveBudget}
                  disabled={savingBudget}
                  className="text-xs bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white px-3 py-1.5 rounded-lg"
                >
                  {savingBudget ? "..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>

          {/* Model routing control */}
          <div className="bg-white rounded-xl border p-4 mb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  ⚡ Multi-LLM routing
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tareas simples con modelos más baratos. Opus = $75/M output;
                  Sonnet = $15/M (5× más barato); Haiku = $4/M (15×). Ahorro
                  estimado en modo auto: 30-50%.
                </p>
              </div>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                {([
                  { v: "always_opus", label: "Siempre Opus", hint: "Sin ahorro" },
                  { v: "auto", label: "Auto", hint: "Heurística conservadora" },
                  { v: "cost_saver", label: "Cost saver", hint: "Agresivo" }
                ] as const).map((opt) => (
                  <button
                    key={opt.v}
                    onClick={() => saveRouting(opt.v)}
                    title={opt.hint}
                    className={
                      "px-2.5 py-1 rounded text-xs font-medium transition-colors " +
                      (routing === opt.v
                        ? "bg-brand-600 text-white shadow"
                        : "text-slate-600 hover:bg-slate-200")
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mt-2">
              Override puntual por task: añade <code>[model:opus]</code>,{" "}
              <code>[model:sonnet]</code> o <code>[model:haiku]</code> en la
              descripción.
            </div>
          </div>

          {/* Daily chart */}
          <div className="bg-white rounded-xl border p-5 mb-4">
            <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Actividad diaria
            </h2>
            <div className="flex items-end gap-1 h-32">
              {data.daily.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                  <div
                    className="w-full bg-brand-500 hover:bg-brand-600 rounded-t relative"
                    style={{ height: `${(d.runs / maxDailyRuns) * 100}%`, minHeight: "2px" }}
                    title={`${d.date}: ${d.runs} runs, $${d.cost.toFixed(3)}`}
                  >
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] bg-slate-800 text-white px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap">
                      {d.runs} · ${d.cost.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-[9px] text-slate-500 -rotate-45 origin-top-left mt-2">
                    {d.date.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Grid: tools + clients */}
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <Card title="Top tools usadas">
              {data.topTools.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {data.topTools.map((t) => (
                    <li key={t.name} className="flex justify-between items-center">
                      <code className="bg-slate-100 px-1.5 py-0.5 rounded">{t.name}</code>
                      <span className="text-slate-600 font-medium">{t.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Top clientes atendidos">
              {data.topClients.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {data.topClients.map((c) => (
                    <li key={c.id} className="flex justify-between items-center">
                      <span>{c.name}</span>
                      <span className="text-slate-600">
                        {c.count} runs · <span className="text-amber-700">${c.cost.toFixed(2)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Errors */}
          {data.topErrors.length > 0 && (
            <Card title="Top errores" className="mb-4">
              <ul className="space-y-1.5 text-xs">
                {data.topErrors.map((e, i) => (
                  <li key={i} className="flex justify-between items-start gap-3">
                    <span className="text-slate-700 truncate flex-1" title={e.msg}>
                      {e.msg}
                    </span>
                    <span className="text-rose-600 font-medium">{e.count}×</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Recent runs table */}
          <Card title="Runs recientes (últimos 20)">
            <div className="overflow-x-auto -mx-5 -mb-5">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Task</th>
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-right px-3 py-2">Steps</th>
                    <th className="text-right px-3 py-2">Tokens</th>
                    <th className="text-right px-3 py-2">$</th>
                    <th className="text-right px-3 py-2">Dur.</th>
                    <th className="text-right px-3 py-2">Hace</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={r.runId} className="border-t hover:bg-slate-50">
                      <td className="px-3 py-1.5 truncate max-w-[180px]" title={r.taskTitle}>
                        <a
                          href={`/admin/sonia-run/${r.runId}`}
                          className="text-brand-600 hover:underline"
                        >
                          {r.taskTitle}
                        </a>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{r.clientName ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={
                            "inline-block px-1.5 py-0.5 rounded text-[10px] font-medium " +
                            (STATUS_COLORS[r.status] ?? "bg-slate-100")
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">{r.steps}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500">
                        {r.inputTokens.toLocaleString()}/{r.outputTokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right text-amber-700">
                        ${r.cost.toFixed(3)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-500">
                        {r.durationSec !== null
                          ? r.durationSec < 60
                            ? `${r.durationSec}s`
                            : `${Math.floor(r.durationSec / 60)}m ${r.durationSec % 60}s`
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-500">
                        <RelativeTime iso={r.createdAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="text-xs text-slate-400 mt-3 text-center">
            Pricing aproximado: Opus 4.7 = $15/M input + $75/M output. Tokens reales
            facturados por Anthropic pueden variar según prompt caching.
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Card({
  title,
  children,
  className = ""
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${className}`}>
      <h2 className="font-semibold text-sm mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-slate-400 italic">Sin datos en este rango.</p>;
}

function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, now - new Date(iso).getTime()) / 1000;
  if (diff < 60) return <>{Math.floor(diff)}s</>;
  if (diff < 3600) return <>{Math.floor(diff / 60)}m</>;
  if (diff < 86400) return <>{Math.floor(diff / 3600)}h</>;
  return <>{Math.floor(diff / 86400)}d</>;
}
