"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  Check,
  Clipboard,
  Clock3,
  ExternalLink,
  Loader2,
  PauseCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import type { MobileAutomationExecutableJob } from "@/components/mobile/mobile-automation-executor";
import {
  buildAutomationTargetUrl,
  getAutomationWorkflows
} from "@/lib/mobile/automation-catalog";
import type {
  MobileAutomationPlatform as Platform,
  MobileAutomationSourceKind as SourceKind
} from "@/lib/mobile/automation-policy";

type AutomationJob = MobileAutomationExecutableJob & {
  id: string;
  phoneKey: string;
  deviceSerial: string;
  platform: Platform;
  sourceKind: SourceKind;
  sourceRef: string | null;
  facts: string | null;
  status: string;
  scheduledAt: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  preparedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type Props = {
  deviceSerial: string;
  phoneKey: string;
  ready: boolean;
  onExecuteJob: (job: MobileAutomationExecutableJob) => Promise<void>;
  onPasteText: (text: string) => Promise<void>;
};

const PLATFORM_OPTIONS: Array<{ value: Platform; label: string }> = [
  { value: "google_maps", label: "Google Maps" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "generic", label: "Otra web HTTPS" }
];

function workflowLabel(platform: Platform, sourceKind: SourceKind): string {
  return getAutomationWorkflows(platform).find((item) => item.sourceKind === sourceKind)?.label
    ?? sourceKind;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pendiente de aprobación",
  QUEUED: "Programado",
  RUNNING: "Preparando en el móvil",
  WAITING_USER: "Listo para pegar y publicar",
  COMPLETED: "Completado",
  REJECTED: "Rechazado",
  FAILED: "Necesita revisión",
  CANCELLED: "Cancelado"
};

function statusClasses(status: string) {
  if (status === "COMPLETED") return "bg-emerald-100 text-emerald-800";
  if (status === "WAITING_USER") return "bg-indigo-100 text-indigo-800";
  if (status === "FAILED") return "bg-rose-100 text-rose-800";
  if (status === "QUEUED" || status === "RUNNING") return "bg-sky-100 text-sky-800";
  return "bg-amber-100 text-amber-800";
}

function sessionIdFor(deviceSerial: string) {
  const key = `nv-mobile-automation-session:${deviceSerial}`;
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(key, value);
  }
  return value;
}

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || "La automatización no ha podido continuar");
  }
  return payload;
}

export default function MobileAutomationPanel({
  deviceSerial,
  phoneKey,
  ready,
  onExecuteJob,
  onPasteText
}: Props) {
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [workerMessage, setWorkerMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind>("REAL_REVIEW");
  const [platform, setPlatform] = useState<Platform>("google_maps");
  const [targetName, setTargetName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [facts, setFacts] = useState("");
  const [tone, setTone] = useState("natural y concreto");
  const [experienceConfirmed, setExperienceConfirmed] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const workerBusyRef = useRef(false);
  const draftRequestIdRef = useRef<string | null>(null);
  const platformWorkflows = getAutomationWorkflows(platform);
  const selectedWorkflow = platformWorkflows.find((item) => item.sourceKind === sourceKind)
    ?? platformWorkflows[0]!;
  const hasRunnableJob = jobs.some((job) => (
    job.status === "RUNNING"
    || (job.status === "QUEUED" && new Date(job.scheduledAt).getTime() <= Date.now())
  ));

  const loadJobs = useCallback(async () => {
    try {
      const payload = await apiJson(`/api/v1/mobile/automations?deviceSerial=${encodeURIComponent(deviceSerial)}`);
      setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      setCanManage(Boolean(payload.canManage));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se ha podido cargar la cola");
    } finally {
      setLoading(false);
    }
  }, [deviceSerial]);

  const claimAndExecute = useCallback(async () => {
    if (!ready || !canManage || workerBusyRef.current) return;
    workerBusyRef.current = true;
    const executorSessionId = sessionIdFor(deviceSerial);
    try {
      const payload = await apiJson("/api/v1/mobile/automations/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceSerial, executorSessionId })
      });
      const job = payload.job as AutomationJob | null;
      if (!job) return;
      setWorkerMessage("Preparando el trabajo aprobado en el móvil…");
      try {
        await onExecuteJob(job);
        await apiJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(job.id)}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ executorSessionId, outcome: "PREPARED" })
        });
        setWorkerMessage(job.action === "OPEN_URL"
          ? "Búsqueda abierta en el móvil. Ya puedes revisar los resultados."
          : "URL abierta y texto copiado. Revisa el móvil antes de publicar.");
      } catch (executionError) {
        const message = executionError instanceof Error ? executionError.message : "No se pudo preparar el móvil";
        await apiJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(job.id)}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ executorSessionId, outcome: "FAILED", errorCode: "mobile_prepare_failed", error: message })
        }).catch(() => undefined);
        setError(message);
      }
      await loadJobs();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "El worker móvil se ha detenido");
    } finally {
      workerBusyRef.current = false;
    }
  }, [canManage, deviceSerial, loadJobs, onExecuteJob, ready]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  useEffect(() => {
    const timer = window.setInterval(() => { void loadJobs(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  useEffect(() => {
    if (!ready || !canManage || !hasRunnableJob) return;
    void claimAndExecute();
    const timer = window.setInterval(() => { void claimAndExecute(); }, 8_000);
    return () => window.clearInterval(timer);
  }, [canManage, claimAndExecute, hasRunnableJob, ready]);

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWorkerMessage(null);
    try {
      const generatedTargetUrl = buildAutomationTargetUrl(platform, sourceKind, targetName);
      const idempotencyKey = draftRequestIdRef.current ?? crypto.randomUUID();
      draftRequestIdRef.current = idempotencyKey;
      await apiJson("/api/v1/mobile/automations/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          sourceKind,
          idempotencyKey,
          phoneKey,
          deviceSerial,
          targetName: targetName.trim() || undefined,
          targetUrl: generatedTargetUrl ?? targetUrl.trim(),
          facts: facts.trim(),
          tone: tone.trim() || undefined,
          experienceConfirmed: sourceKind === "REAL_REVIEW" ? experienceConfirmed : false,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined
        })
      });
      draftRequestIdRef.current = null;
      setFacts("");
      setTargetName("");
      setTargetUrl("");
      setExperienceConfirmed(false);
      setWorkerMessage("Borrador generado. Revísalo y apruébalo antes de enviarlo al móvil.");
      await loadJobs();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se ha podido generar el borrador");
    } finally {
      setBusy(false);
    }
  }

  async function decide(job: AutomationJob, action: "APPROVE" | "REJECT" | "COMPLETE" | "RETRY" | "CANCEL") {
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(job.id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "APPROVE" ? { text: edits[job.id] ?? job.text ?? "" } : {})
        })
      });
      await loadJobs();
      if (action === "APPROVE") {
        setWorkerMessage(ready ? "Aprobado. El Xiaomi lo preparará en unos segundos." : "Aprobado y en cola hasta que abras la pantalla del móvil.");
        void claimAndExecute();
      }
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "No se ha podido cambiar el trabajo");
    } finally {
      setBusy(false);
    }
  }

  function changePlatform(next: Platform) {
    setPlatform(next);
    setSourceKind(getAutomationWorkflows(next)[0]!.sourceKind);
    setTargetName("");
    setTargetUrl("");
    setFacts("");
    setExperienceConfirmed(false);
  }

  function changeWorkflow(next: SourceKind) {
    setSourceKind(next);
    setTargetName("");
    setTargetUrl("");
    setFacts("");
    setExperienceConfirmed(false);
  }

  const activeJobs = jobs.filter((job) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(job.status));

  return (
    <section className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-3" aria-label="Centro de automatizaciones">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Bot className="h-4 w-4 text-violet-700" /> Centro de automatizaciones
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            La IA prepara el destino y el texto. Tú revisas, apruebas y confirmas la publicación final.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
          {ready ? "Worker conectado" : "Abre la pantalla para ejecutar"}
        </span>
      </div>

      <form onSubmit={createDraft} className="mt-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">
            Plataforma
            <select value={platform} onChange={(event) => changePlatform(event.target.value as Platform)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm">
              {PLATFORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Acción en {PLATFORM_OPTIONS.find((option) => option.value === platform)?.label}
            <select value={sourceKind} onChange={(event) => changeWorkflow(event.target.value as SourceKind)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm">
              {platformWorkflows.map((option) => <option key={option.sourceKind} value={option.sourceKind}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="rounded-lg border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs leading-5 text-violet-900">
          <span className="font-semibold">{selectedWorkflow.label}.</span> {selectedWorkflow.description}
        </div>
        <div className={`grid gap-2 ${selectedWorkflow.targetUrlLabel ? "sm:grid-cols-2" : ""}`}>
          <label className="text-xs font-semibold text-slate-700">
            {selectedWorkflow.targetNameLabel}
            <input
              value={targetName}
              onChange={(event) => setTargetName(event.target.value)}
              placeholder={selectedWorkflow.targetNamePlaceholder}
              required={sourceKind === "GROUP_DISCOVERY"}
              className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          {selectedWorkflow.targetUrlLabel && (
            <label className="text-xs font-semibold text-slate-700">
              {selectedWorkflow.targetUrlLabel}
              <input
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder={selectedWorkflow.targetUrlPlaceholder ?? "https://…"}
                inputMode="url"
                required
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
          )}
        </div>
        <label className="block text-xs font-semibold text-slate-700">
          {selectedWorkflow.factsLabel}
          <textarea
            value={facts}
            onChange={(event) => setFacts(event.target.value)}
            minLength={20}
            maxLength={4000}
            required
            rows={3}
            placeholder={selectedWorkflow.factsPlaceholder}
            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {!(["GROUP_DISCOVERY", "COMMENT_DISCOVERY"] as SourceKind[]).includes(sourceKind) ? (
            <input value={tone} onChange={(event) => setTone(event.target.value)} placeholder="Tono" className="rounded-lg border bg-white px-3 py-2 text-sm" />
          ) : <span className="hidden sm:block" />}
          <label className="relative text-xs font-semibold text-slate-700">
            <span className="sr-only">Fecha y hora</span>
            <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm" />
          </label>
        </div>
        {sourceKind === "REAL_REVIEW" && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            <input type="checkbox" checked={experienceConfirmed} onChange={(event) => setExperienceConfirmed(event.target.checked)} required className="mt-1" />
            Confirmo que visité este lugar y que los hechos aportados corresponden a una experiencia real, aunque no llevara el móvil.
          </label>
        )}
        <button type="submit" disabled={busy || !canManage} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {selectedWorkflow.submitLabel}
        </button>
      </form>

      {workerMessage && <p role="status" className="mt-3 rounded-lg bg-indigo-100 px-3 py-2 text-xs text-indigo-800">{workerMessage}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-xs text-rose-800">{error}</p>}

      <div className="mt-4 border-t border-violet-100 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">Cola supervisada · {activeJobs.length}</h4>
          <button type="button" onClick={() => void loadJobs()} disabled={loading} aria-label="Actualizar automatizaciones" className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-900">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {loading ? (
          <p className="mt-3 text-xs text-slate-500">Cargando cola…</p>
        ) : jobs.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed bg-white/70 px-3 py-4 text-center text-xs text-slate-500">Aún no hay borradores para este móvil.</p>
        ) : (
          <div className="mt-2 max-h-[30rem] space-y-2 overflow-y-auto pr-1">
            {jobs.slice(0, 20).map((job) => (
              <article key={job.id} className="rounded-lg border bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800">{workflowLabel(job.platform, job.sourceKind)}</div>
                    {job.sourceRef && <div className="mt-0.5 text-[11px] text-slate-500">{job.sourceRef}</div>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClasses(job.status)}`}>{STATUS_LABELS[job.status] || job.status}</span>
                </div>
                {job.status === "PENDING_APPROVAL" ? (
                  <textarea value={edits[job.id] ?? job.text ?? ""} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: event.target.value }))} rows={4} maxLength={4000} className="mt-2 w-full rounded-lg border px-2.5 py-2 text-xs leading-5" />
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">{job.text}</p>
                )}
                {job.lastError && <p className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{job.lastError}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {job.status === "PENDING_APPROVAL" && (
                    <>
                      <button type="button" onClick={() => void decide(job, "APPROVE")} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white"><ShieldCheck className="h-3.5 w-3.5" /> Aprobar</button>
                      <button type="button" onClick={() => void decide(job, "REJECT")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-slate-700"><X className="h-3.5 w-3.5" /> Rechazar</button>
                    </>
                  )}
                  {job.status === "WAITING_USER" && (
                    <>
                      {job.action !== "OPEN_URL" && job.text && (
                        <button type="button" onClick={() => void onPasteText(job.text!)} disabled={!ready || busy} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><Clipboard className="h-3.5 w-3.5" /> Pegar en el campo enfocado</button>
                      )}
                      <button type="button" onClick={() => void decide(job, "COMPLETE")} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white"><Check className="h-3.5 w-3.5" /> {job.action === "OPEN_URL" ? "Revisión terminada" : "Ya lo publiqué"}</button>
                    </>
                  )}
                  {job.status === "FAILED" && <button type="button" onClick={() => void decide(job, "RETRY")} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white"><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button>}
                  {["QUEUED", "WAITING_USER", "FAILED"].includes(job.status) && <button type="button" onClick={() => void decide(job, "CANCEL")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-slate-600"><PauseCircle className="h-3.5 w-3.5" /> Cancelar</button>}
                  {job.targetUrl && <a href={job.targetUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-slate-600"><ExternalLink className="h-3.5 w-3.5" /> Ver destino</a>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-2 text-[11px] leading-4 text-slate-500">
        <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Las búsquedas se abren automáticamente. Las solicitudes, respuestas y publicaciones quedan preparadas para revisar antes de la acción final.
      </p>
    </section>
  );
}
