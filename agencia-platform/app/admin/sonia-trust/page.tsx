"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, Shield, ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";

type ClientScore = {
  clientId: string;
  clientName: string;
  autonomous: boolean;
  score: number;
  level: "ready" | "supervised" | "manual";
  stats: {
    total: number;
    succeeded: number;
    requiresHuman: number;
    failed: number;
    successRate: number | null;
    totalCostUsd: number;
    avgCostUsd: number;
    humanRate: number;
  };
};

const LEVEL_INFO = {
  ready: {
    color: "emerald",
    label: "Listo para autopilot",
    icon: <ShieldCheck className="h-4 w-4" />,
    description:
      "Score ≥ 80. Sonia ha demostrado fiabilidad con este cliente — puedes activar modo autónomo y omitirá pedirte aprobación en acciones de riesgo medio."
  },
  supervised: {
    color: "amber",
    label: "Supervisado",
    icon: <Shield className="h-4 w-4" />,
    description:
      "Score 50-79. Sonia sigue trabajando pero conviene revisar drafts y validar antes de soltarla."
  },
  manual: {
    color: "rose",
    label: "Manual",
    icon: <ShieldOff className="h-4 w-4" />,
    description:
      "Score < 50. Poco volumen o tasa de éxito baja. Sigue revisando todo manualmente."
  }
};

export default function SoniaTrustPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ clients: ClientScore[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingClient, setSavingClient] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/sonia-client-scores?days=${days}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }
  useEffect(() => {
    load();
  }, [days]);

  async function toggleAutonomous(clientId: string, next: boolean) {
    setSavingClient(clientId);
    try {
      await fetch("/api/v1/admin/sonia-client-scores", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, autonomous: next })
      });
      await load();
    } finally {
      setSavingClient(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Trust por cliente"
        description="Score 0-100 según fiabilidad histórica de Sonia con cada cliente. Activa autopilot solo cuando estés convencido."
        actions={
          <div className="flex gap-1 bg-white border rounded-lg p-0.5">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={
                  "px-2.5 py-1 rounded text-xs font-medium " +
                  (days === d ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")
                }
              >
                {d}d
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {!data ? (
        <div className="text-center py-12 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Calculando…
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-2 mb-4">
            {(["ready", "supervised", "manual"] as const).map((level) => {
              const info = LEVEL_INFO[level];
              const count = data.clients.filter((c) => c.level === level).length;
              return (
                <div
                  key={level}
                  className={`bg-${info.color}-50 border border-${info.color}-200 rounded-lg p-3`}
                >
                  <div className={`text-xs text-${info.color}-700 flex items-center gap-1.5`}>
                    {info.icon} {info.label}
                  </div>
                  <div className="text-2xl font-bold mt-1">{count}</div>
                  <p className={`text-[10px] text-${info.color}-600 mt-1`}>
                    {info.description}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            {data.clients.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                Sin clientes con datos en este rango.
              </div>
            ) : (
              data.clients.map((c) => (
                <ClientRow
                  key={c.clientId}
                  c={c}
                  saving={savingClient === c.clientId}
                  onToggle={(next) => toggleAutonomous(c.clientId, next)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ClientRow({
  c,
  saving,
  onToggle
}: {
  c: ClientScore;
  saving: boolean;
  onToggle: (next: boolean) => void;
}) {
  const info = LEVEL_INFO[c.level];
  const barColor =
    c.score >= 80 ? "bg-emerald-500" : c.score >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-sm">{c.clientName}</h3>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-${info.color}-100 text-${info.color}-700`}
            >
              {info.icon} {info.label}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {c.stats.total} runs · {c.stats.successRate !== null ? `${Math.round(c.stats.successRate * 100)}% éxito` : "sin datos"}
            {" · "}
            ${c.stats.totalCostUsd.toFixed(2)} total ({c.stats.avgCostUsd > 0 ? `$${c.stats.avgCostUsd.toFixed(3)}/run` : "—"})
            {c.stats.humanRate > 0 && (
              <span className={c.stats.humanRate > 0.3 ? "text-amber-600 ml-2" : "ml-2"}>
                · {Math.round(c.stats.humanRate * 100)}% pidió humano
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold">{c.score}</div>
            <div className="text-[10px] text-slate-400 -mt-1">/ 100</div>
          </div>
          <label
            className={
              "inline-flex items-center gap-2 px-2 py-1 rounded-lg border cursor-pointer text-xs " +
              (c.autonomous
                ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                : "bg-slate-50 border-slate-200 text-slate-600")
            }
          >
            <input
              type="checkbox"
              checked={c.autonomous}
              onChange={(e) => onToggle(e.target.checked)}
              disabled={saving || c.level !== "ready"}
              className="accent-emerald-600"
            />
            {saving ? "..." : "Autopilot"}
          </label>
        </div>
      </div>

      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${c.score}%` }}
        />
      </div>

      {c.autonomous && c.level !== "ready" && (
        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
          ⚠️ Autopilot activo pero el score bajó. Considera revisar.
        </div>
      )}
    </div>
  );
}
