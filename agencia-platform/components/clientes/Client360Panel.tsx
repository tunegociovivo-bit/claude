"use client";

/**
 * Panel Cliente 360 (FASE 3b · UI) — ADITIVO sobre la pantalla de cliente actual.
 *
 * Consume GET /api/v1/clients/[id]/overview (agregado). Muestra salud/SLA
 * (explicable), rentabilidad (solo si el server la marca visible = admin),
 * actividad y responsables.
 *
 * FALLBACK / KILL-SWITCH:
 *   - Si NEXT_PUBLIC_CLIENT360_UI="off" o localStorage 'client360-ui'='off' →
 *     el panel no se monta (queda la UI actual intacta).
 *   - Si el endpoint responde 404 (kill-switch de servidor HUB_CLIENT360=off) o
 *     falla → no se renderiza nada (la pantalla actual es el fallback).
 * Nunca rompe la página: ante cualquier problema devuelve null.
 */
import { useEffect, useState } from "react";
import { Activity, HeartPulse, TrendingUp, Users } from "lucide-react";
import { bandLabel, bandClasses, alertClasses, formatEurCents, activityLabel } from "@/lib/clients/health-ui";

type Overview = {
  health: {
    score: number;
    band: "good" | "warn" | "risk";
    factors: { key: string; label: string; points: number; detail: string }[];
    alerts: { level: "info" | "warn" | "critical"; message: string }[];
    nextSteps: string[];
  };
  activity: { daysSinceLastActivity: number | null };
  tasks: { openCount: number; overdueCount: number; doneCount: number };
  responsables: { managers: { id: string; name: string | null }[]; aiOwner: { lastStatus: string | null } | null };
  billing: {
    visible: boolean;
    reason?: string;
    profitability?: {
      recurring: { mrrEuros: number; hasMrr: boolean };
      invoiced: { billedCents: number; paidCents: number; pendingCents: number; overdueCents: number; overdueCount: number };
      cost: { available: false; reason: string };
      margin: { available: false; reason: string };
    };
  };
};

function uiDisabled(): boolean {
  if (process.env.NEXT_PUBLIC_CLIENT360_UI === "off") return true;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("client360-ui") === "off";
  } catch {
    return false;
  }
}

export default function Client360Panel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (uiDisabled()) {
      setReady(true);
      return;
    }
    let aborted = false;
    fetch(`/api/v1/clients/${clientId}/overview`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!aborted) setData(d);
      })
      .catch(() => {})
      .finally(() => !aborted && setReady(true));
    return () => {
      aborted = true;
    };
  }, [clientId]);

  // Fallback: sin datos (desactivado / 404 / error) → no renderiza nada.
  if (!ready || !data || !data.health) return null;

  const { health } = data;
  const bc = bandClasses(health.band);
  const prof = data.billing.profitability;

  return (
    <section aria-label="Resumen 360 del cliente" className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Salud / SLA */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
          <HeartPulse className="h-4 w-4 text-slate-400" /> Salud de cuenta
        </h2>
        <div className="flex items-center gap-3">
          <div className={`text-3xl font-bold tabular-nums ${bc.ring}`} aria-hidden>
            {health.score}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${bc.badge}`} role="status">
            {bandLabel(health.band)} · {health.score}/100
          </span>
        </div>
        {health.factors.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {health.factors.map((f) => (
              <li key={f.key} className="text-xs flex items-start justify-between gap-2">
                <span className="text-slate-600">
                  <span className="font-medium text-slate-800">{f.label}:</span> {f.detail}
                </span>
                <span className={`tabular-nums shrink-0 ${f.points < 0 ? "text-rose-600" : "text-slate-400"}`}>
                  {f.points < 0 ? f.points : "0"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {health.alerts.length > 0 && (
          <ul className="mt-3 space-y-1.5" aria-label="Alertas">
            {health.alerts.map((a, i) => (
              <li key={i} className={`text-xs px-2 py-1 rounded border ${alertClasses(a.level)}`}>
                {a.message}
              </li>
            ))}
          </ul>
        )}
        {health.nextSteps.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-medium text-slate-500 mb-1">Próximos pasos</div>
            <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-700">
              {health.nextSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Rentabilidad (solo si el server la marca visible = admin) */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4 text-slate-400" /> Rentabilidad
        </h2>
        {data.billing.visible && prof ? (
          <dl className="space-y-1.5 text-sm">
            <Row label="MRR" value={prof.recurring.hasMrr ? `${prof.recurring.mrrEuros.toLocaleString("es-ES")} €` : "—"} />
            <Row label="Facturado" value={formatEurCents(prof.invoiced.billedCents)} />
            <Row label="Cobrado" value={formatEurCents(prof.invoiced.paidCents)} />
            <Row label="Pendiente" value={formatEurCents(prof.invoiced.pendingCents)} />
            <Row
              label="Vencido"
              value={`${formatEurCents(prof.invoiced.overdueCents)}${prof.invoiced.overdueCount ? ` (${prof.invoiced.overdueCount})` : ""}`}
              danger={prof.invoiced.overdueCents > 0}
            />
            <div className="pt-2 mt-2 border-t text-xs text-slate-500">
              <div>Costes: <span className="font-medium text-slate-600">sin datos</span></div>
              <div>Margen: <span className="font-medium text-slate-600">no calculable</span> (sin costes trazables)</div>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-slate-500">{data.billing.reason ?? "Importes visibles solo para administradores."}</p>
        )}
      </div>

      {/* Actividad + Responsables */}
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold mb-2 flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-slate-400" /> Actividad
          </h2>
          <p className="text-sm text-slate-700">{activityLabel(data.activity.daysSinceLastActivity)}</p>
          <p className="text-xs text-slate-500 mt-1">
            {data.tasks.openCount} abiertas · <span className={data.tasks.overdueCount ? "text-rose-600 font-medium" : ""}>{data.tasks.overdueCount} vencidas</span> · {data.tasks.doneCount} hechas
          </p>
        </div>
        <div>
          <h2 className="font-semibold mb-2 flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-slate-400" /> Responsables
          </h2>
          {data.responsables.managers.length > 0 ? (
            <ul className="text-sm text-slate-700 space-y-0.5">
              {data.responsables.managers.map((m) => (
                <li key={m.id}>{m.name ?? "—"}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">Sin responsable de proyecto asignado.</p>
          )}
          {data.responsables.aiOwner && (
            <p className="text-xs text-slate-500 mt-1">Sonia (IA): {data.responsables.aiOwner.lastStatus ?? "activa"}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`tabular-nums font-medium ${danger ? "text-rose-600" : "text-slate-800"}`}>{value}</dd>
    </div>
  );
}
