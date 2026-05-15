"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, TrendingUp } from "lucide-react";

type Period = "daily" | "weekly" | "monthly" | "yearly";

type Report = {
  period: Period;
  days: number;
  totalMicros: number;
  buckets: { key: string; value: number }[];
  byProject: { id: string; name: string; value: number }[];
  byUser: { id: string; name: string; value: number }[];
  byFeature: { key: string; value: number }[];
  byModel: { key: string; value: number }[];
};

function formatUSD(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: "daily", label: "Diario", days: 30 },
  { id: "weekly", label: "Semanal", days: 90 },
  { id: "monthly", label: "Mensual", days: 365 },
  { id: "yearly", label: "Anual", days: 1095 }
];

export default function IaUsageClient() {
  const [period, setPeriod] = useState<Period>("monthly");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const p = PERIODS.find((x) => x.id === period)!;
    const r = await fetch(`/api/v1/admin/ai-usage?period=${period}&days=${p.days}`);
    if (r.ok) setReport(await r.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [period]);

  const maxBucket = report ? Math.max(1, ...report.buckets.map((b) => b.value)) : 1;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Consumo de IA"
        description="Cuánto está gastando aproximadamente cada proyecto y trabajador en llamadas a Claude, GPT y Whisper."
        actions={
          <div className="inline-flex bg-white border rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={
                  "px-3 py-1.5 rounded-md text-xs font-medium " +
                  (period === p.id ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900")
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : !report || report.buckets.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center">
          <TrendingUp className="h-8 w-8 mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-600">
            Aún no hay llamadas de IA registradas en este periodo.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            En cuanto se use el asistente Hub, el redactor, el generador de reseñas o Voice Reviews, aparecerán los datos aquí.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Card
              label="Gasto total"
              value={formatUSD(report.totalMicros)}
              hint={`${report.days} días`}
            />
            <Card
              label="Llamadas registradas"
              value={String(report.buckets.reduce((a, b) => a + (b.value > 0 ? 1 : 0), 0))}
            />
            <Card
              label="Modelo más usado"
              value={report.byModel[0]?.key ?? "—"}
              hint={report.byModel[0] ? formatUSD(report.byModel[0].value) : ""}
            />
          </div>

          <div className="bg-white rounded-xl border p-5 mb-4">
            <h2 className="text-sm font-semibold mb-3">Evolución</h2>
            <div className="space-y-1.5">
              {report.buckets.map((b) => (
                <div key={b.key} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-slate-500 shrink-0">{b.key}</div>
                  <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-brand-500 to-brand-700"
                      style={{ width: `${(b.value / maxBucket) * 100}%` }}
                    />
                  </div>
                  <div className="w-20 text-xs text-right font-medium tabular-nums">{formatUSD(b.value)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownTable
              title="Por proyecto"
              rows={report.byProject.map((r) => ({ key: r.name, value: r.value }))}
              total={report.totalMicros}
            />
            <BreakdownTable
              title="Por trabajador"
              rows={report.byUser.map((r) => ({ key: r.name, value: r.value }))}
              total={report.totalMicros}
            />
            <BreakdownTable
              title="Por feature"
              rows={report.byFeature.map((r) => ({ key: r.key, value: r.value }))}
              total={report.totalMicros}
            />
            <BreakdownTable
              title="Por modelo"
              rows={report.byModel.map((r) => ({ key: r.key, value: r.value }))}
              total={report.totalMicros}
            />
          </div>

          <p className="mt-4 text-xs text-slate-500 leading-relaxed">
            ⓘ Los precios son <strong>estimaciones</strong> según las tarifas públicas de Anthropic y OpenAI a mayo 2026. El coste real facturado puede variar ligeramente según descuentos y prompt caching. Whisper se mide en segundos de audio, no en tokens.
          </p>
        </>
      )}
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  total
}: {
  title: string;
  rows: { key: string; value: number }[];
  total: number;
}) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Sin datos.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {rows.map((r) => {
              const pct = total > 0 ? (r.value / total) * 100 : 0;
              return (
                <tr key={r.key}>
                  <td className="py-1.5 text-slate-700 truncate max-w-[200px]" title={r.key}>{r.key}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600 text-xs">{pct.toFixed(1)}%</td>
                  <td className="py-1.5 text-right tabular-nums font-medium pl-2">{formatUSD(r.value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
