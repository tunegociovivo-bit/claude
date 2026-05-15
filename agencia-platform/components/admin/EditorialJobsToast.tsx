"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Sparkles } from "lucide-react";

type RunningJob = {
  id: string;
  startedAt: number;
  clientName?: string;
  month?: string;
};

type JobStatus = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  progressPct: number;
  progressMsg: string | null;
  result: any;
  errorCode: string | null;
  errorMessage: string | null;
};

/**
 * Toast persistente que muestra los jobs en segundo plano de la generación
 * editorial. Hace polling cada 3s. Persiste en localStorage para sobrevivir
 * navegación entre pantallas / refrescos.
 *
 * Cuando un job completa, llama a onCompleted (si se pasa) y permite al
 * usuario despachar el toast pulsando ×.
 */
export default function EditorialJobsToast({ onJobCompleted }: { onJobCompleted?: () => void }) {
  const [jobs, setJobs] = useState<RunningJob[]>([]);
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Sync inicial desde localStorage + listener para nuevos jobs
  useEffect(() => {
    function loadFromStorage() {
      try {
        const items: RunningJob[] = JSON.parse(localStorage.getItem("editorial.runningJobs") ?? "[]");
        setJobs(items);
      } catch {}
    }
    loadFromStorage();
    function onNew() {
      loadFromStorage();
    }
    window.addEventListener("editorial:job-started", onNew);
    return () => window.removeEventListener("editorial:job-started", onNew);
  }, []);

  // Polling
  useEffect(() => {
    const active = jobs.filter((j) => {
      const s = statuses[j.id];
      return !s || s.status === "PENDING" || s.status === "RUNNING";
    });
    if (active.length === 0) return;
    const interval = setInterval(async () => {
      const next: Record<string, JobStatus> = { ...statuses };
      let anyChange = false;
      for (const j of active) {
        try {
          const r = await fetch(`/api/v1/editorial/generate-month/jobs/${j.id}`);
          if (!r.ok) continue;
          const s: JobStatus = await r.json();
          next[j.id] = s;
          if ((s.status === "COMPLETED" || s.status === "FAILED") && (!statuses[j.id] || statuses[j.id].status !== s.status)) {
            anyChange = true;
            if (s.status === "COMPLETED" && onJobCompleted) onJobCompleted();
          }
        } catch {}
      }
      setStatuses(next);
      if (anyChange) {
        // Auto-limpia los completed de localStorage después de 20s
        // (los dejamos visibles para que el user los vea)
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [jobs, statuses, onJobCompleted]);

  function dismiss(id: string) {
    setDismissed((s) => {
      const n = new Set(s);
      n.add(id);
      return n;
    });
    // Quitar también de localStorage
    try {
      const items: RunningJob[] = JSON.parse(localStorage.getItem("editorial.runningJobs") ?? "[]");
      const filtered = items.filter((j) => j.id !== id);
      localStorage.setItem("editorial.runningJobs", JSON.stringify(filtered));
    } catch {}
  }

  const visible = jobs.filter((j) => !dismissed.has(j.id));
  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-sm w-[calc(100vw-2rem)] sm:w-96">
      {visible.map((j) => {
        const s = statuses[j.id];
        const status = s?.status ?? "PENDING";
        const isDone = status === "COMPLETED" || status === "FAILED";
        const seconds = Math.floor((Date.now() - j.startedAt) / 1000);
        return (
          <div
            key={j.id}
            className={
              "rounded-xl border shadow-lg overflow-hidden bg-white " +
              (status === "COMPLETED"
                ? "border-emerald-300"
                : status === "FAILED"
                  ? "border-rose-300"
                  : "border-violet-300")
            }
          >
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  {status === "COMPLETED" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : status === "FAILED" ? (
                    <XCircle className="h-4 w-4 text-rose-600" />
                  ) : (
                    <Loader2 className="h-4 w-4 text-violet-600 animate-spin" />
                  )}
                  <span className="text-sm font-semibold text-slate-900">
                    {status === "COMPLETED"
                      ? "Generación completada"
                      : status === "FAILED"
                        ? "Generación fallida"
                        : "Generando mes con IA"}
                  </span>
                </div>
                {isDone && (
                  <button
                    onClick={() => dismiss(j.id)}
                    className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-600">
                {j.clientName && <span className="font-medium">{j.clientName}</span>}
                {j.clientName && j.month && <span> · </span>}
                {j.month}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {s?.progressMsg ?? "En cola…"} · {seconds}s
              </p>
              {s?.errorMessage && (
                <p className="mt-1 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-1.5">
                  {s.errorMessage}
                </p>
              )}
              {s?.result && status === "COMPLETED" && (
                <div className="mt-1 space-y-0.5">
                  <p className="text-[11px] text-emerald-700">
                    ✓ {s.result.count ?? 0} publicación{(s.result.count ?? 0) === 1 ? "" : "es"} creada
                    {(s.result.count ?? 0) === 1 ? "" : "s"}
                  </p>
                  {typeof s.result.imagesGenerated === "number" &&
                    s.result.imagesGenerated + (s.result.imagesFailed ?? 0) > 0 && (
                      <p
                        className={
                          "text-[11px] " +
                          ((s.result.imagesFailed ?? 0) > 0 ? "text-amber-700" : "text-emerald-700")
                        }
                      >
                        🖼️ {s.result.imagesGenerated} imagen{s.result.imagesGenerated === 1 ? "" : "es"} generada
                        {s.result.imagesGenerated === 1 ? "" : "s"}
                        {(s.result.imagesFailed ?? 0) > 0 && ` · ${s.result.imagesFailed} fallaron`}
                      </p>
                    )}
                  {typeof s.result.imagesGenerated === "number" &&
                    s.result.imagesGenerated === 0 &&
                    (s.result.imagesFailed ?? 0) === 0 && (
                      <p className="text-[11px] text-slate-500">
                        (sin imágenes — no se pidió generar imagen)
                      </p>
                    )}
                  {Array.isArray(s.result.imageErrors) && s.result.imageErrors.length > 0 && (
                    <details className="text-[10px] text-amber-700">
                      <summary className="cursor-pointer">Ver errores de imagen</summary>
                      <ul className="ml-3 mt-0.5 list-disc">
                        {s.result.imageErrors.map((err: string, i: number) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
            {!isDone && (
              <div className="h-1 bg-violet-100">
                <div
                  className="h-full bg-violet-500 transition-all duration-700 ease-linear"
                  style={{ width: `${Math.max(5, s?.progressPct ?? 5)}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
