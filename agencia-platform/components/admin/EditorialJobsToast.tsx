"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, RefreshCw, FileText } from "lucide-react";

type RunningJob = {
  id: string;
  startedAt: number;
  clientName?: string;
  month?: string;
};

type JobEvent = { ts: number; level: "info" | "warn" | "error"; message: string };

type JobStatus = {
  id: string;
  kind?: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  progressPct: number;
  progressMsg: string | null;
  result: any;
  events?: JobEvent[] | null;
  systemPrompt?: string | null;
  userPrompt?: string | null;
  cancelRequested?: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

/**
 * Toast persistente para jobs background de generación editorial.
 * Polling cada 3s, persistencia en localStorage, expandible con log
 * de events y prompts, botón de retry-images si hubo fallos.
 */
export default function EditorialJobsToast({ onJobCompleted }: { onJobCompleted?: () => void }) {
  const [jobs, setJobs] = useState<RunningJob[]>([]);
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPrompt, setShowPrompt] = useState<string | null>(null); // jobId del prompt mostrado
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

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

    async function tick() {
      const next: Record<string, JobStatus> = { ...statuses };
      let anyChange = false;
      for (const j of active) {
        try {
          const r = await fetch(`/api/v1/editorial/generate-month/jobs/${j.id}`);
          if (r.status === 404) {
            anyChange = true;
            dismiss(j.id);
            continue;
          }
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
    }
    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [jobs, statuses, onJobCompleted]);

  function dismiss(id: string) {
    setDismissed((s) => {
      const n = new Set(s);
      n.add(id);
      return n;
    });
    try {
      const items: RunningJob[] = JSON.parse(localStorage.getItem("editorial.runningJobs") ?? "[]");
      const filtered = items.filter((j) => j.id !== id);
      localStorage.setItem("editorial.runningJobs", JSON.stringify(filtered));
    } catch {}
  }

  async function cancel(id: string) {
    if (!confirm("¿Cancelar la generación?\n\nLas publicaciones ya creadas se conservan; sólo se aborta la siguiente iteración.")) return;
    await fetch(`/api/v1/editorial/generate-month/jobs/${id}`, { method: "DELETE" });
    // No descartamos — el polling capturará el estado CANCELLED.
  }

  async function retryImages(jobId: string, clientName?: string) {
    setRetrying((s) => new Set(s).add(jobId));
    try {
      const r = await fetch(`/api/v1/editorial/generate-month/jobs/${jobId}/retry-images`, {
        method: "POST"
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        alert(`Error: ${data?.error?.message ?? r.status}`);
        return;
      }
      // El retry crea un nuevo job — lo añadimos al toast también.
      try {
        const existing = JSON.parse(localStorage.getItem("editorial.runningJobs") ?? "[]");
        existing.push({
          id: data.jobId,
          startedAt: Date.now(),
          clientName,
          month: `Reintento (${data.count} imgs)`
        });
        localStorage.setItem("editorial.runningJobs", JSON.stringify(existing));
        window.dispatchEvent(new CustomEvent("editorial:job-started", { detail: { id: data.jobId } }));
      } catch {}
    } finally {
      setRetrying((s) => {
        const n = new Set(s);
        n.delete(jobId);
        return n;
      });
    }
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  useEffect(() => {
    try {
      const items: RunningJob[] = JSON.parse(localStorage.getItem("editorial.runningJobs") ?? "[]");
      const ONE_HOUR = 60 * 60 * 1000;
      const fresh = items.filter((j) => Date.now() - j.startedAt < ONE_HOUR);
      if (fresh.length !== items.length) {
        localStorage.setItem("editorial.runningJobs", JSON.stringify(fresh));
        setJobs(fresh);
      }
    } catch {}
  }, []);

  function clearAll() {
    if (!confirm("¿Limpiar todos los toasts de generación pendientes?")) return;
    try {
      localStorage.setItem("editorial.runningJobs", "[]");
    } catch {}
    setJobs([]);
    setStatuses({});
  }

  function titleForJob(s: JobStatus | undefined, fallback: string): string {
    const kind = s?.kind ?? "";
    if (kind === "editorial.retry_images") {
      if (s?.status === "COMPLETED") return "Imágenes reintentadas";
      if (s?.status === "FAILED") return "Reintento fallido";
      return "Reintentando imágenes…";
    }
    if (kind === "editorial.regenerate_post") {
      if (s?.status === "COMPLETED") return "Publicación regenerada";
      if (s?.status === "FAILED") return "Regeneración fallida";
      return "Regenerando publicación…";
    }
    if (kind === "editorial.generate_single") {
      if (s?.status === "COMPLETED") return "Publicación creada";
      if (s?.status === "FAILED") return "Generación fallida";
      return "Generando publicación con IA…";
    }
    // generate_month por defecto
    if (s?.status === "COMPLETED") return "Generación completada";
    if (s?.status === "FAILED") return "Generación fallida";
    return fallback;
  }

  const visible = jobs.filter((j) => !dismissed.has(j.id));
  if (visible.length === 0 && !showPrompt) return null;

  return (
    <>
      <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-md w-[calc(100vw-2rem)] sm:w-[26rem]">
        {visible.length > 1 && (
          <div className="text-right">
            <button
              onClick={clearAll}
              className="text-[11px] px-2 py-1 rounded bg-white border hover:bg-slate-50 text-slate-600 shadow-sm"
            >
              Limpiar todos ({visible.length})
            </button>
          </div>
        )}
        {visible.map((j) => {
          const s = statuses[j.id];
          let status = s?.status ?? "PENDING";
          const seconds = Math.floor((Date.now() - j.startedAt) / 1000);
          const clientStuck = !s && seconds > 180;
          if (clientStuck) status = "FAILED";
          const isDone = status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
          const title = titleForJob(s, "Generando mes con IA");
          const failedImageCount = (s?.result?.failedImagePostIds?.length ?? 0) > 0
            ? s!.result.failedImagePostIds.length
            : 0;
          const canRetryImages = status === "COMPLETED" && failedImageCount > 0 && s?.kind !== "editorial.retry_images";
          const isExpanded = expanded.has(j.id);
          const events: JobEvent[] = Array.isArray(s?.events) ? s!.events! : [];
          return (
            <div
              key={j.id}
              className={
                "rounded-xl border shadow-lg overflow-hidden bg-white " +
                (status === "COMPLETED"
                  ? "border-emerald-300"
                  : status === "FAILED"
                    ? "border-rose-300"
                    : status === "CANCELLED"
                      ? "border-slate-300"
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
                    ) : status === "CANCELLED" ? (
                      <XCircle className="h-4 w-4 text-slate-500" />
                    ) : (
                      <Loader2 className="h-4 w-4 text-violet-600 animate-spin" />
                    )}
                    <span className="text-sm font-semibold text-slate-900">{title}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!isDone && seconds > 30 && (
                      <button
                        onClick={() => cancel(j.id)}
                        disabled={s?.cancelRequested}
                        className="text-[10px] px-1.5 py-0.5 rounded border bg-white hover:bg-rose-50 border-rose-200 text-rose-700 disabled:opacity-50"
                        title="Cancelar generación (conserva lo creado)"
                      >
                        {s?.cancelRequested ? "Cancelando…" : "Cancelar"}
                      </button>
                    )}
                    <button
                      onClick={() => dismiss(j.id)}
                      className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                      title="Descartar toast"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-600">
                  {j.clientName && <span className="font-medium">{j.clientName}</span>}
                  {j.clientName && j.month && <span> · </span>}
                  {j.month}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {s?.progressMsg ?? "En cola…"} · {seconds}s
                </p>
                {clientStuck && (
                  <p className="mt-1 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-1.5">
                    El servidor no responde sobre este job (más de 3 min). Probablemente Railway reinició Node.
                    Pulsa × para descartar y vuelve a generar.
                  </p>
                )}
                {s?.errorMessage && (
                  <p className="mt-1 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-1.5">
                    {s.errorMessage}
                  </p>
                )}
                {s?.result && status === "COMPLETED" && (
                  <div className="mt-1 space-y-0.5">
                    {typeof s.result.count === "number" && s.kind !== "editorial.retry_images" && (
                      <p className="text-[11px] text-emerald-700">
                        ✓ {s.result.count} publicación{s.result.count === 1 ? "" : "es"} creada
                        {s.result.count === 1 ? "" : "s"}
                      </p>
                    )}
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
                  </div>
                )}

                {/* Acciones post-completado */}
                {isDone && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {canRetryImages && (
                      <button
                        onClick={() => retryImages(j.id, j.clientName)}
                        disabled={retrying.has(j.id)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border bg-white hover:bg-amber-50 border-amber-300 text-amber-800 disabled:opacity-50"
                      >
                        <RefreshCw className={"h-3 w-3 " + (retrying.has(j.id) ? "animate-spin" : "")} />
                        Reintentar {failedImageCount} imagen{failedImageCount === 1 ? "" : "es"}
                      </button>
                    )}
                    {(events.length > 0 || s?.systemPrompt) && (
                      <button
                        onClick={() => toggleExpand(j.id)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                      >
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {isExpanded ? "Ocultar log" : `Ver log (${events.length})`}
                      </button>
                    )}
                    {(s?.systemPrompt || s?.userPrompt) && (
                      <button
                        onClick={() => setShowPrompt(j.id)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                      >
                        <FileText className="h-3 w-3" />
                        Ver prompt
                      </button>
                    )}
                  </div>
                )}

                {/* Log expandible */}
                {isExpanded && events.length > 0 && (
                  <div className="mt-2 rounded border bg-slate-50 max-h-48 overflow-y-auto">
                    <ul className="divide-y divide-slate-200 text-[10px] font-mono">
                      {events.map((ev, i) => (
                        <li
                          key={i}
                          className={
                            "px-2 py-1 flex gap-2 " +
                            (ev.level === "error"
                              ? "text-rose-700 bg-rose-50/40"
                              : ev.level === "warn"
                                ? "text-amber-700 bg-amber-50/40"
                                : "text-slate-700")
                          }
                        >
                          <span className="tabular-nums text-slate-400 shrink-0">
                            {(ev.ts / 1000).toFixed(1)}s
                          </span>
                          <span className="flex-1 break-words">{ev.message}</span>
                        </li>
                      ))}
                    </ul>
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

      {/* Modal de prompt completo (cuando el user pulsa "Ver prompt") */}
      {showPrompt && (() => {
        const s = statuses[showPrompt];
        if (!s) return null;
        return (
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setShowPrompt(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-3 border-b flex items-center justify-between">
                <h3 className="text-sm font-semibold">Prompt enviado a Claude</h3>
                <button onClick={() => setShowPrompt(null)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {s.systemPrompt && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 mb-1">System</h4>
                    <pre className="text-[11px] bg-slate-50 border rounded p-3 whitespace-pre-wrap font-mono max-h-[40vh] overflow-y-auto">
                      {s.systemPrompt}
                    </pre>
                  </div>
                )}
                {s.userPrompt && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 mb-1">User</h4>
                    <pre className="text-[11px] bg-slate-50 border rounded p-3 whitespace-pre-wrap font-mono max-h-[40vh] overflow-y-auto">
                      {s.userPrompt}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
