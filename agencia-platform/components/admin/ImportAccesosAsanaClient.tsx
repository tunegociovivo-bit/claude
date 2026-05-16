"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { ArrowLeft, Loader2, KeyRound, CheckCircle2, AlertCircle, ExternalLink, Stethoscope } from "lucide-react";

type JobStatus = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  progressPct: number;
  progressMsg: string | null;
  result: any;
  events?: { ts: number; level: string; message: string }[] | null;
  errorMessage: string | null;
};

type DiagRow = {
  asanaName: string;
  matchedDbName: string | null;
  matchType: "exact" | "contains" | "none";
  dbAccesosLen: number;
};

type DiagSummary = {
  asanaTotal: number;
  dbTotal: number;
  exact: number;
  contains: number;
  noMatch: number;
  alreadyHasAccesos: number;
};

export default function ImportAccesosAsanaClient() {
  const [rootTaskId, setRootTaskId] = useState("1201694137821107");
  const [onConflict, setOnConflict] = useState<"skip" | "overwrite" | "append">("skip");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [diag, setDiag] = useState<{ summary: DiagSummary; rows: DiagRow[] } | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [lastJobLoaded, setLastJobLoaded] = useState(false);

  // Al cargar, si no estamos en medio de un job actual, traemos el
  // último job de este kind para mostrarlo (para que el usuario vea
  // qué pasó la última vez aunque se haya ido y vuelto).
  useEffect(() => {
    if (jobId || lastJobLoaded) return;
    fetch("/api/v1/admin/import-accesos-asana/last-job")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.job) {
          setStatus(data.job);
          setJobId(data.job.id);
        }
        setLastJobLoaded(true);
      })
      .catch(() => setLastJobLoaded(true));
  }, [jobId, lastJobLoaded]);

  async function runDiagnose() {
    setDiagLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/v1/admin/import-accesos-asana/diagnose?rootTaskId=${encodeURIComponent(rootTaskId)}`
      );
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? data?.error ?? `Error ${r.status}`);
        return;
      }
      if (data.error) {
        setError(data.error);
        return;
      }
      setDiag({ summary: data.summary, rows: data.rows });
    } finally {
      setDiagLoading(false);
    }
  }

  // Polling
  useEffect(() => {
    if (!jobId) return;
    if (status?.status === "COMPLETED" || status?.status === "FAILED") return;
    let stop = false;
    async function tick() {
      try {
        const r = await fetch(`/api/v1/editorial/generate-month/jobs/${jobId}`);
        if (!r.ok) return;
        const data = await r.json();
        if (!stop) setStatus(data);
      } catch {}
    }
    tick();
    const i = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [jobId, status?.status]);

  async function start() {
    if (!confirm("¿Iniciar import desde Asana?\n\nVa a leer las 165 subtareas de la tarea CLIENTES (~2-3 min) y volcar los accesos en cada ficha. Con onConflict=skip los clientes que ya tienen accesos no se tocan.")) return;
    setStarting(true);
    setError(null);
    setStatus(null);
    setJobId(null);
    try {
      const r = await fetch("/api/v1/admin/import-accesos-asana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootTaskId, onConflict })
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setJobId(data.jobId);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver al panel admin
      </Link>

      <PageHeader
        title="Importar accesos desde Asana"
        description="Volcar las credenciales de cada subtarea-cliente de Asana al campo Accesos de cada ficha de cliente."
      />

      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          <div className="font-medium flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            Requisitos
          </div>
          <ul className="text-xs mt-1 list-disc ml-4 space-y-0.5">
            <li>Necesitas tener Asana conectado en{" "}
              <Link href="/admin/asana" className="underline">/admin/asana</Link>
            </li>
            <li>La tarea raíz tiene que tener este formato: subtarea por cliente, sub-subtareas con credenciales en las "notes"</li>
            <li>El matching de cliente es por nombre case-insensitive + fuzzy ("contains")</li>
          </ul>
          <p className="text-xs mt-2">
            <a
              href={`https://app.asana.com/0/0/${rootTaskId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Ver tarea raíz en Asana <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            GID de la tarea raíz en Asana
          </label>
          <input
            value={rootTaskId}
            onChange={(e) => setRootTaskId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-700">
            Si el cliente ya tiene accesos:
          </label>
          <select
            value={onConflict}
            onChange={(e) => setOnConflict(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="skip">No tocar (saltar)</option>
            <option value="overwrite">Sobreescribir</option>
            <option value="append">Añadir al final</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={start}
            disabled={starting || (!!status && status.status === "RUNNING")}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Iniciar import
          </button>
          <button
            onClick={runDiagnose}
            disabled={diagLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
          >
            {diagLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
            Diagnosticar (sin tocar BD)
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <strong>Error:</strong> {error}
          </div>
        )}

        {status && (
          <div
            className={
              "rounded-lg border p-3 text-sm " +
              (status.status === "COMPLETED"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : status.status === "FAILED"
                  ? "border-rose-300 bg-rose-50 text-rose-800"
                  : "border-violet-300 bg-violet-50 text-violet-900")
            }
          >
            <div className="flex items-center gap-2 font-medium">
              {status.status === "COMPLETED" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : status.status === "FAILED" ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {status.status === "COMPLETED"
                ? "Completado"
                : status.status === "FAILED"
                  ? "Fallido"
                  : "Procesando…"}
              <span className="ml-auto text-xs tabular-nums">{status.progressPct}%</span>
            </div>
            <p className="text-xs mt-1">{status.progressMsg}</p>
            <div className="mt-2 h-1.5 bg-white/60 rounded">
              <div
                className="h-full bg-violet-500 rounded transition-all"
                style={{ width: `${Math.max(5, status.progressPct)}%` }}
              />
            </div>

            {status.status === "COMPLETED" && status.result && (
              <div className="mt-3 text-xs space-y-1">
                <p>Asana subtareas leídas: <strong>{status.result.totalAsana}</strong></p>
                <p>Clientes actualizados: <strong>{status.result.updated}</strong></p>
                <p>Saltados: <strong>{status.result.skipped}</strong></p>
                {Array.isArray(status.result.noMatch) && status.result.noMatch.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">
                      Sin match en BD ({status.result.noMatch.length})
                    </summary>
                    <ul className="ml-4 mt-1 list-disc">
                      {status.result.noMatch.map((n: string, i: number) => <li key={i}>{n}</li>)}
                    </ul>
                  </details>
                )}
                {Array.isArray(status.result.skippedReasons) && status.result.skippedReasons.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">
                      Saltados con motivo ({status.result.skippedReasons.length})
                    </summary>
                    <ul className="ml-4 mt-1 list-disc">
                      {status.result.skippedReasons.map((n: string, i: number) => <li key={i}>{n}</li>)}
                    </ul>
                  </details>
                )}
                <p className="pt-2">
                  <Link href="/clientes" className="underline">Ir a Clientes →</Link>
                </p>
              </div>
            )}

            {status.status === "FAILED" && status.errorMessage && (
              <p className="text-xs mt-2">{status.errorMessage}</p>
            )}

            {Array.isArray(status.events) && status.events.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs">Ver log ({status.events.length})</summary>
                <ul className="mt-1 text-[10px] font-mono space-y-0.5 max-h-48 overflow-y-auto">
                  {status.events.map((ev, i) => (
                    <li
                      key={i}
                      className={
                        ev.level === "error" ? "text-rose-700" : ev.level === "warn" ? "text-amber-700" : "text-slate-700"
                      }
                    >
                      <span className="text-slate-400">{(ev.ts / 1000).toFixed(1)}s</span> {ev.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {diag && (
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <Stethoscope className="h-4 w-4 text-violet-600" />
              Diagnóstico del matching Asana ↔ BD
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <Stat label="Asana subtareas" value={diag.summary.asanaTotal} />
              <Stat label="Clientes en BD" value={diag.summary.dbTotal} />
              <Stat label="Match exacto" value={diag.summary.exact} color="emerald" />
              <Stat label="Match parcial" value={diag.summary.contains} color="amber" />
              <Stat label="Sin match" value={diag.summary.noMatch} color="rose" />
              <Stat label="Ya tienen accesos" value={diag.summary.alreadyHasAccesos} color="slate" />
            </div>
            {diag.summary.noMatch > 0 && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                Hay <strong>{diag.summary.noMatch}</strong> nombres en Asana que NO existen en tu BD. Para que se importen los accesos, esos clientes deben existir primero con el mismo nombre (o uno parecido).
              </p>
            )}
            {diag.summary.alreadyHasAccesos > 0 && onConflict === "skip" && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                <strong>{diag.summary.alreadyHasAccesos}</strong> clientes ya tienen accesos rellenos. Con <code>onConflict=skip</code> no se tocan — cambia a "Sobreescribir" o "Añadir al final" si quieres actualizarlos.
              </p>
            )}
            <details>
              <summary className="cursor-pointer text-xs font-medium">
                Ver tabla completa ({diag.rows.length})
              </summary>
              <div className="mt-2 max-h-96 overflow-y-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b text-slate-500 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 font-medium">Asana</th>
                      <th className="text-left px-2 py-1 font-medium">BD</th>
                      <th className="text-left px-2 py-1 font-medium">Match</th>
                      <th className="text-right px-2 py-1 font-medium">Accesos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {diag.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 font-medium">{r.asanaName}</td>
                        <td className="px-2 py-1 text-slate-600">{r.matchedDbName ?? "—"}</td>
                        <td className="px-2 py-1">
                          {r.matchType === "exact" && <span className="text-emerald-700">✓ exacto</span>}
                          {r.matchType === "contains" && <span className="text-amber-700">≈ parcial</span>}
                          {r.matchType === "none" && <span className="text-rose-700">✗ sin match</span>}
                        </td>
                        <td className="px-2 py-1 text-right text-slate-500 tabular-nums">
                          {r.dbAccesosLen > 0 ? `${r.dbAccesosLen} chars` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color = "slate"
}: {
  label: string;
  value: number;
  color?: "slate" | "emerald" | "amber" | "rose";
}) {
  const colorClass = {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    rose: "text-rose-700"
  }[color];
  return (
    <div className="bg-white border rounded p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={"text-lg font-bold tabular-nums " + colorClass}>{value}</div>
    </div>
  );
}
