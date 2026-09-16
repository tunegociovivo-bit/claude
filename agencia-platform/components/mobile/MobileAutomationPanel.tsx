"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  ChevronDown,
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
import type {
  MobileAutomationExecutableJob,
  MobileAutomationExecutionResult
} from "@/components/mobile/mobile-automation-executor";
import {
  buildAutomationTargetUrl,
  getAutomationWorkflows
} from "@/lib/mobile/automation-catalog";
import type {
  MobileAutomationPlatform as Platform,
  MobileAutomationSourceKind as SourceKind
} from "@/lib/mobile/automation-policy";
import {
  parseFacebookGroupBatch,
  selectedFacebookGroupCount,
  serializeFacebookGroupBatch,
  toggleFacebookGroupCandidate,
  updateFacebookGroupMembershipAnswers,
  type FacebookGroupBatch
} from "@/lib/mobile/facebook-group-batch";

import FacebookConversationBatchView from "@/components/mobile/FacebookConversationBatchView";
import { parseConversationBatch, type FacebookConversationBatch } from "@/lib/mobile/facebook-conversations";

function readConversations(action: string, text: string | null | undefined): FacebookConversationBatch | null {
  if (!action.endsWith("FACEBOOK_CONVERSATIONS") || !text) return null;
  try { return parseConversationBatch(text); } catch { return null; }
}

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
  composer?: { allowed: boolean; submitLabel: string; create: (body: Record<string, unknown>) => Promise<void> };
  onEnsureReady?: () => Promise<boolean>;
  onExecuteJob: (job: MobileAutomationExecutableJob) => Promise<MobileAutomationExecutionResult>;
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

function isNavigationAction(action: string): boolean {
  return action === "OPEN_URL" || action === "SEARCH_FACEBOOK_GROUPS";
}

function readFacebookGroupBatch(action: string, value: string | null | undefined): FacebookGroupBatch | null {
  if (!["DISCOVER_FACEBOOK_GROUPS", "JOIN_FACEBOOK_GROUP_BATCH"].includes(action) || !value) return null;
  try {
    return parseFacebookGroupBatch(value);
  } catch {
    return null;
  }
}

function selectedGroupCount(action: string, value: string | null | undefined): number {
  const batch = readFacebookGroupBatch(action, value);
  return batch ? selectedFacebookGroupCount(batch) : 0;
}

function statusLabel(job: AutomationJob): string {
  if (job.action === "DISCOVER_FACEBOOK_CONVERSATIONS" && job.status === "RUNNING") return "Buscando comentarios";
  if (job.action === "REPLY_FACEBOOK_CONVERSATIONS") {
    if (job.status === "PENDING_APPROVAL") return "Respuestas listas para revisar";
    if (job.status === "RUNNING") return "Enviando respuestas seleccionadas";
    if (job.status === "WAITING_USER") return "Envío parcial · revisar";
  }
  if (job.action === "SEARCH_FACEBOOK_GROUPS") {
    if (job.status === "RUNNING") return "Buscando grupos en el móvil";
    if (job.status === "WAITING_USER") return "Resultados listos para revisar";
  }
  if (job.action === "DISCOVER_FACEBOOK_GROUPS" && job.status === "RUNNING") return "Analizando resultados en el móvil";
  if (job.action === "JOIN_FACEBOOK_GROUP_BATCH") {
    if (job.status === "PENDING_APPROVAL") return "Selección lista para aprobar";
    if (job.status === "RUNNING") return "Solicitando acceso en Facebook";
    if (job.status === "WAITING_USER") return "Lote parcial · necesita revisión";
    if (job.status === "COMPLETED") return "Lote completado";
  }
  return STATUS_LABELS[job.status] || job.status;
}

const GROUP_OUTCOME_LABELS: Record<string, string> = {
  pending: "Pendiente",
  joined: "Unido",
  requested: "Solicitud enviada",
  needs_answers: "Faltan datos",
  failed: "No procesado",
  skipped: "Omitido"
};

function FacebookGroupBatchView({
  batch,
  editable,
  disabled,
  onToggle
}: {
  batch: FacebookGroupBatch;
  editable: boolean;
  disabled: boolean;
  onToggle: (candidateId: string, selected: boolean) => void;
}) {
  if (batch.candidates.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-dashed bg-slate-50 px-3 py-3 text-xs text-slate-600">
        Se analizarán varias pantallas y se propondrán hasta {batch.maxGroups} grupos según: {batch.criteria}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] text-slate-600">
        {batch.candidates.length} resultados analizados · {batch.candidates.filter((candidate) => candidate.selected).length} seleccionados
      </p>
      {batch.candidates.map((candidate) => (
        <label key={candidate.id} className={`block rounded-lg border px-2.5 py-2 ${candidate.selected ? "border-emerald-200 bg-emerald-50/60" : "bg-slate-50"}`}>
          <div className="flex items-start gap-2">
            {editable && (
              <input
                type="checkbox"
                checked={candidate.selected}
                disabled={disabled}
                onChange={(event) => onToggle(candidate.id, event.target.checked)}
                className="mt-0.5"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-xs font-bold text-slate-800">{candidate.name}</span>
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{candidate.relevanceScore}%</span>
              </div>
              {candidate.details && <p className="mt-0.5 text-[11px] text-slate-500">{candidate.details}</p>}
              <p className="mt-1 text-[11px] leading-4 text-slate-700">{candidate.reason}</p>
              {!editable && candidate.outcome !== "pending" && (
                <p className="mt-1 text-[11px] font-semibold text-indigo-700">
                  {GROUP_OUTCOME_LABELS[candidate.outcome] ?? candidate.outcome}
                  {candidate.resultDetail ? ` · ${candidate.resultDetail}` : ""}
                </p>
              )}
            </div>
          </div>
        </label>
      ))}
    </div>
  );
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
  onEnsureReady,
  onExecuteJob,
  onPasteText,
  composer
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
  const [membershipAnswers, setMembershipAnswers] = useState("");
  const [maxGroups, setMaxGroups] = useState(8);
  const [niche, setNiche] = useState("");
  const [replyGuidance, setReplyGuidance] = useState("");
  const [postsPerGroup, setPostsPerGroup] = useState(5);
  const [commentScreensPerPost, setCommentScreensPerPost] = useState(5);
  const [lookbackDays, setLookbackDays] = useState<7 | 30 | 90>(30);
  const [queueOpen, setQueueOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const conversationScan = platform === "facebook" && sourceKind === "COMMENT_DISCOVERY";
  const [tone, setTone] = useState("natural y concreto");
  const [experienceConfirmed, setExperienceConfirmed] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [membershipAnswerEdits, setMembershipAnswerEdits] = useState<Record<string, string>>({});
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
    if (composer) { setCanManage(composer.allowed); setLoading(false); return; }
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
  }, [deviceSerial, composer]);

  const claimAndExecute = useCallback(async () => {
    if (composer || !ready || !canManage || workerBusyRef.current) return;
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
      setWorkerMessage(job.action === "DISCOVER_FACEBOOK_CONVERSATIONS" ? "Buscando comentarios y preparando respuestas…" : job.action === "REPLY_FACEBOOK_CONVERSATIONS" ? "Enviando las respuestas seleccionadas…" : job.action === "DISCOVER_FACEBOOK_GROUPS"
        ? `Analizando varios resultados sobre «${job.sourceRef}» en Facebook…`
        : job.action === "JOIN_FACEBOOK_GROUP_BATCH"
          ? "Procesando en Facebook todos los grupos aprobados…"
          : job.action === "SEARCH_FACEBOOK_GROUPS"
            ? `Buscando grupos sobre «${job.sourceRef}» en Facebook…`
            : "Preparando el trabajo aprobado en el móvil…");
      try {
        const isConversation = job.action.endsWith("FACEBOOK_CONVERSATIONS");
        const heartbeat = isConversation ? window.setInterval(() => {
          void apiJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(job.id)}/checkpoint`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ executorSessionId })
          }).catch(() => undefined);
        }, 30_000) : undefined;
        let execution: MobileAutomationExecutionResult;
        try { execution = await onExecuteJob({ ...job, executorSessionId }); }
        finally { if (heartbeat !== undefined) window.clearInterval(heartbeat); }
        await apiJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(job.id)}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            executorSessionId,
            outcome: execution.outcome,
            ...(execution.resultText ? { resultText: execution.resultText } : {}),
            ...(execution.outcome === "PARTIAL" ? {
              errorCode: "partial_group_batch",
              error: execution.summary ?? "Parte del lote necesita revisión manual."
            } : {})
          })
        });
        setWorkerMessage(execution.outcome === "DISCOVERED"
          ? job.action === "DISCOVER_FACEBOOK_CONVERSATIONS" ? "Búsqueda terminada. Revisa, edita y selecciona las respuestas que quieres enviar." : "Análisis terminado. Revisa la selección y aprueba todo el lote con un solo clic."
          : execution.outcome === "COMPLETED"
            ? execution.summary ?? "Todos los grupos seleccionados han sido procesados."
            : execution.outcome === "PARTIAL"
              ? execution.summary ?? "Parte del lote necesita revisión."
              : isNavigationAction(job.action)
                ? "Búsqueda abierta en el móvil. Ya puedes revisar los resultados."
                : "URL abierta y texto copiado. Revisa el móvil antes de publicar.");
      } catch (executionError) {
        const message = executionError instanceof Error ? executionError.message : "No se pudo preparar el móvil";
        await apiJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(job.id)}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ executorSessionId, outcome: "FAILED", errorCode: "mobile_prepare_failed", error: message })
        }).catch(() => undefined);
        setWorkerMessage(null);
        setError(message);
      }
      await loadJobs();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "El worker móvil se ha detenido");
    } finally {
      workerBusyRef.current = false;
    }
  }, [canManage, composer, deviceSerial, loadJobs, onExecuteJob, ready]);

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
      const draftBody = {
          platform,
          sourceKind,
          idempotencyKey,
          phoneKey,
          deviceSerial,
          targetName: (conversationScan ? niche.trim() || "Grupos de mi cuenta" : targetName.trim()) || undefined,
          targetUrl: generatedTargetUrl ?? targetUrl.trim(),
          facts: facts.trim(),
          ...(conversationScan ? { niche, replyGuidance, postsPerGroup, commentScreensPerPost, lookbackDays } : {}),
          membershipAnswers: sourceKind === "GROUP_DISCOVERY" ? membershipAnswers.trim() : undefined,
          maxGroups: sourceKind === "GROUP_DISCOVERY" ? maxGroups : undefined,
          tone: tone.trim() || undefined,
          experienceConfirmed: sourceKind === "REAL_REVIEW" ? experienceConfirmed : false,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined
      };
      if (composer) { await composer.create(draftBody); draftRequestIdRef.current = null; return; }
      await apiJson("/api/v1/mobile/automations/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody) });
      draftRequestIdRef.current = null;
      setQueueOpen(true);
      setFacts("");
      setMembershipAnswers("");
      setTargetName("");
      setTargetUrl("");
      setExperienceConfirmed(false);
      await loadJobs();
      setWorkerMessage(conversationScan ? "Búsqueda en cola. Se prepararán respuestas para revisar antes de enviar." : sourceKind === "GROUP_DISCOVERY"
        ? ready
          ? "Análisis enviado. El móvil recorrerá varios resultados de Facebook."
          : "Análisis en cola. Abre la pantalla del móvil para ejecutarlo."
        : "Borrador generado. Revísalo y apruébalo antes de enviarlo al móvil.");
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
      let decisionText = edits[job.id] ?? job.text ?? "";
      if (job.action === "JOIN_FACEBOOK_GROUP_BATCH" && membershipAnswerEdits[job.id] !== undefined) {
        const batch = readFacebookGroupBatch(job.action, decisionText);
        if (!batch) throw new Error("El lote de grupos ya no es válido. Actualiza la lista.");
        decisionText = serializeFacebookGroupBatch(updateFacebookGroupMembershipAnswers(
          batch,
          membershipAnswerEdits[job.id]!
        ));
      }
      await apiJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(job.id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...((action === "APPROVE" || (action === "RETRY" && ["JOIN_FACEBOOK_GROUP_BATCH", "REPLY_FACEBOOK_CONVERSATIONS"].includes(job.action)))
            ? { text: decisionText }
            : {})
        })
      });
      setEdits((current) => { const updated = { ...current }; delete updated[job.id]; return updated; });
      await loadJobs();
      if (action === "APPROVE" || action === "RETRY") {
        if (action === "RETRY") {
          if (!ready && onEnsureReady) {
            setWorkerMessage("Abriendo pantalla del movil para lanzar el reintento...");
            const opened = await onEnsureReady();
            setWorkerMessage(opened
              ? "Reintento lanzado. El movil empezara con los grupos pendientes."
              : "Reintento en cola. No se ha podido abrir la pantalla del movil.");
            return;
          }
          setWorkerMessage(ready
            ? "Reintento lanzado. El movil empezara con los grupos pendientes."
            : "Reintento en cola hasta que abras la pantalla del movil.");
          void claimAndExecute();
          return;
        }
        setWorkerMessage(job.action === "JOIN_FACEBOOK_GROUP_BATCH"
          ? ready
            ? "Lote aprobado. El móvil empezará a solicitar acceso a los grupos seleccionados."
            : "Lote aprobado y en cola hasta que abras la pantalla del móvil."
          : ready
            ? "Aprobado. El Xiaomi lo preparará en unos segundos."
            : "Aprobado y en cola hasta que abras la pantalla del móvil.");
        void claimAndExecute();
      }
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "No se ha podido cambiar el trabajo");
    } finally {
      setBusy(false);
    }
  }

  function toggleGroupSelection(job: AutomationJob, candidateId: string, selected: boolean) {
    try {
      const batch = readFacebookGroupBatch(job.action, edits[job.id] ?? job.text);
      if (!batch) throw new Error("El lote de grupos ya no es válido. Actualiza la lista.");
      const updated = toggleFacebookGroupCandidate(batch, candidateId, selected);
      setEdits((current) => ({ ...current, [job.id]: serializeFacebookGroupBatch(updated) }));
      setError(null);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "No se ha podido cambiar la selección");
    }
  }

  function changePlatform(next: Platform) {
    setPlatform(next);
    setSourceKind(getAutomationWorkflows(next)[0]!.sourceKind);
    setTargetName("");
    setTargetUrl("");
    setFacts("");
    setMembershipAnswers("");
    setExperienceConfirmed(false);
  }

  function changeWorkflow(next: SourceKind) {
    setSourceKind(next);
    setTargetName("");
    setTargetUrl("");
    setFacts("");
    setMembershipAnswers("");
    setExperienceConfirmed(false);
  }

  const activeJobs = jobs.filter((job) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(job.status));

  return (
    <section className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-3" aria-label="Centro de automatizaciones">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Bot className="h-4 w-4 text-violet-700" /> {composer ? "Configurar encargo común" : "Centro de automatizaciones"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            El Hub analiza resultados y procesa lotes completos. Una sola aprobación autoriza las solicitudes seleccionadas.
          </p>
        </div>
        {!composer && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
          {ready ? "Worker conectado" : "Abre la pantalla para ejecutar"}
        </span>}
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
          <span className="font-semibold">{selectedWorkflow.label}.</span> {conversationScan ? "Busca comentarios en los grupos de tu cuenta o en un destino concreto y prepara respuestas editables con tu texto base." : selectedWorkflow.description}
        </div>
        <div className={`grid gap-2 ${selectedWorkflow.targetUrlLabel && !conversationScan ? "sm:grid-cols-2" : ""}`}>
          {!conversationScan && <label className="text-xs font-semibold text-slate-700">
            {conversationScan ? "Qué comentarios te interesan (opcional)" : selectedWorkflow.targetNameLabel}
            <input
              value={targetName}
              onChange={(event) => setTargetName(event.target.value)}
              placeholder={conversationScan ? "Ej. dudas sobre rentabilidad de supermercados" : selectedWorkflow.targetNamePlaceholder}
              required={sourceKind === "GROUP_DISCOVERY"}
              className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal"
            />
          </label>}
          {selectedWorkflow.targetUrlLabel && (
            <label className="text-xs font-semibold text-slate-700">
              {selectedWorkflow.targetUrlLabel}{conversationScan ? " (opcional)" : ""}
              <input
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder={selectedWorkflow.targetUrlPlaceholder ?? "https://…"}
                inputMode="url"
                required={!conversationScan}
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
          )}
        </div>
        <label className="block text-xs font-semibold text-slate-700">
          {conversationScan ? "Qué comentarios buscar (opcional)" : selectedWorkflow.factsLabel}
          <textarea
            value={facts}
            onChange={(event) => setFacts(event.target.value)}
            minLength={conversationScan ? undefined : 20}
            maxLength={4000}
            required={!conversationScan}
            rows={3}
            placeholder={conversationScan ? "Déjalo vacío para preparar respuestas a todos los comentarios leídos, o indica aquí qué preguntas o temas te interesan." : selectedWorkflow.factsPlaceholder}
            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal"
          />
        </label>
        {conversationScan && <div className="space-y-3 rounded-xl border border-indigo-100 bg-white p-3">
          <p className="text-xs leading-5 text-slate-600">Deja el destino vacío para recorrer los grupos de esta cuenta. El nicho filtra los grupos por su temática. Si lo dejas vacío, se revisarán todos.</p>
          <label className="block text-xs font-semibold text-slate-700">Nicho de los grupos (opcional)
            <input value={niche} onChange={(event) => setNiche(event.target.value)} placeholder="Ej. franquicias" maxLength={200} className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" />
          </label>
          <label className="block text-xs font-semibold text-slate-700">Texto base para las respuestas
            <textarea value={replyGuidance} onChange={(event) => setReplyGuidance(event.target.value)} required minLength={3} maxLength={4000} rows={4} placeholder="Ej. Quiero transmitir que actualmente considero que las franquicias de supermercado serán las más rentables en el futuro. Adapta esa opinión a cada comentario." className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" />
            <span className="mt-1 block text-[11px] font-normal text-slate-500">La IA adaptará esta idea a cada comentario. Podrás editar cada respuesta antes de enviarla.</span>
          </label>
          <label className="block text-xs font-semibold text-slate-700">Antigüedad de los comentarios
            <select value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value) as 7 | 30 | 90)} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal">
              <option value={7}>Últimos 7 días</option><option value={30}>Último mes (30 días)</option><option value={90}>Últimos 3 meses (90 días)</option>
            </select>
          </label>
          <p className="text-xs text-slate-500">Solo se abren publicaciones con un contador visible mayor que cero. Se omiten las que no muestran contador y los comentarios cuya fecha no se puede comprobar. El periodo se aplica al comentario, aunque la publicación sea anterior.</p>
          <details className="text-xs text-slate-600"><summary className="cursor-pointer font-semibold">Profundidad de lectura</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label>Publicaciones por grupo<input type="number" min={1} max={20} value={postsPerGroup} onChange={(event) => setPostsPerGroup(Number(event.target.value))} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label>Pantallas de comentarios por publicación<input type="number" min={1} max={20} value={commentScreensPerPost} onChange={(event) => setCommentScreensPerPost(Number(event.target.value))} className="mt-1 w-full rounded-lg border p-2" /></label>
            </div><p className="mt-2">Se mostrará la cobertura real de la búsqueda. Los comentarios ocultos, eliminados o fuera de esta profundidad no se incluyen.</p>
          </details>
        </div>}
        {sourceKind === "GROUP_DISCOVERY" && (
          <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
            <label className="block text-xs font-semibold text-slate-700">
              Datos reales para responder preguntas de acceso
              <textarea
                value={membershipAnswers}
                onChange={(event) => setMembershipAnswers(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Ej. Soy David, dirijo una agencia de marketing en Málaga y quiero aprender sobre modelos de franquicia en España."
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal"
              />
              <span className="mt-1 block text-[10px] font-normal text-slate-500">La IA dejará sin responder cualquier pregunta que requiera datos que no estén aquí.</span>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Máximo del lote
              <input
                type="number"
                min={1}
                max={15}
                value={maxGroups}
                onChange={(event) => setMaxGroups(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
          </div>
        )}
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
          {composer ? composer.submitLabel : sourceKind === "GROUP_DISCOVERY" ? "Analizar y seleccionar grupos" : conversationScan ? "Buscar comentarios y preparar respuestas" : selectedWorkflow.submitLabel}
        </button>
      </form>

      {workerMessage && <p role="status" className="mt-3 rounded-lg bg-indigo-100 px-3 py-2 text-xs text-indigo-800">{workerMessage}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-xs text-rose-800">{error}</p>}

      {!composer && <div className="mt-4 border-t border-violet-100 pt-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="mobile-supervised-queue" className="flex items-center gap-2 text-xs font-bold text-slate-700"><ChevronDown className={`h-4 w-4 transition-transform ${queueOpen ? "" : "-rotate-90"}`} /> Cola supervisada · {activeJobs.length} activos</button>
          <button type="button" onClick={() => void loadJobs()} disabled={loading} aria-label="Actualizar automatizaciones" className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-900">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {queueOpen && <div id="mobile-supervised-queue">
        <div className="my-3 flex gap-2 text-xs"><button type="button" onClick={() => setShowHistory(false)} className={`rounded-full px-3 py-1.5 ${!showHistory ? "bg-indigo-100 font-bold text-indigo-900" : "bg-white text-slate-600"}`}>Activos · {activeJobs.length}</button><button type="button" onClick={() => setShowHistory(true)} className={`rounded-full px-3 py-1.5 ${showHistory ? "bg-indigo-100 font-bold text-indigo-900" : "bg-white text-slate-600"}`}>Historial</button></div>
        {loading ? (
          <p className="mt-3 text-xs text-slate-500">Cargando cola…</p>
        ) : jobs.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed bg-white/70 px-3 py-4 text-center text-xs text-slate-500">Aún no hay borradores para este móvil.</p>
        ) : (
          <div className="mt-2 max-h-[30rem] space-y-2 overflow-y-auto pr-1">
            {(showHistory ? jobs.filter((job) => ["COMPLETED", "REJECTED", "CANCELLED"].includes(job.status)) : activeJobs).slice(0, 20).map((job, index) => (
              <details key={job.id} open={index === 0} className="rounded-lg border bg-white p-3 shadow-sm">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800">{workflowLabel(job.platform, job.sourceKind)}</div>
                    {job.sourceRef && <div className="mt-0.5 text-[11px] text-slate-500">{job.sourceRef}</div>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClasses(job.status)}`}>{statusLabel(job)}</span>
                </summary>
                {(() => {
                  const conversations = readConversations(job.action, edits[job.id] ?? job.text);
                  if (conversations) return <FacebookConversationBatchView batch={conversations} editable={["PENDING_APPROVAL", "WAITING_USER"].includes(job.status)} disabled={busy} onChange={(updated) => setEdits((current) => ({ ...current, [job.id]: JSON.stringify(updated) }))} />;
                  const batch = readFacebookGroupBatch(job.action, edits[job.id] ?? job.text);
                  if (batch) {
                    return (
                      <FacebookGroupBatchView
                        batch={batch}
                        editable={job.status === "PENDING_APPROVAL"}
                        disabled={busy}
                        onToggle={(candidateId, selected) => toggleGroupSelection(job, candidateId, selected)}
                      />
                    );
                  }
                  return job.status === "PENDING_APPROVAL" ? (
                    <textarea value={edits[job.id] ?? job.text ?? ""} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: event.target.value }))} rows={4} maxLength={4000} className="mt-2 w-full rounded-lg border px-2.5 py-2 text-xs leading-5" />
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">{job.text}</p>
                  );
                })()}
                {job.status === "WAITING_USER" && job.action === "JOIN_FACEBOOK_GROUP_BATCH" && (() => {
                  const batch = readFacebookGroupBatch(job.action, edits[job.id] ?? job.text);
                  return batch ? (
                    <label className="mt-2 block text-[11px] font-semibold text-slate-700">
                      Añadir datos reales para responder lo pendiente
                      <textarea
                        value={membershipAnswerEdits[job.id] ?? batch.membershipAnswers}
                        onChange={(event) => setMembershipAnswerEdits((current) => ({
                          ...current,
                          [job.id]: event.target.value
                        }))}
                        maxLength={2000}
                        rows={3}
                        className="mt-1 w-full rounded-lg border bg-white px-2.5 py-2 text-xs font-normal leading-5"
                      />
                    </label>
                  ) : null;
                })()}
                {job.lastError && <p className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{job.lastError}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {job.status === "PENDING_APPROVAL" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void decide(job, "APPROVE")}
                        disabled={busy || (job.action === "REPLY_FACEBOOK_CONVERSATIONS" && !(readConversations(job.action, edits[job.id] ?? job.text)?.candidates.some((item) => item.selected && ["pending", "failed"].includes(item.outcome) && item.reply.trim()))) || (job.action === "JOIN_FACEBOOK_GROUP_BATCH" && selectedGroupCount(job.action, edits[job.id] ?? job.text) === 0)}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {job.action === "REPLY_FACEBOOK_CONVERSATIONS" ? `Enviar ${readConversations(job.action, edits[job.id] ?? job.text)?.candidates.filter((item) => item.selected && ["pending", "failed"].includes(item.outcome)).length ?? 0} respuestas seleccionadas` : job.action === "JOIN_FACEBOOK_GROUP_BATCH"
                          ? `Aprobar lote · ${selectedGroupCount(job.action, edits[job.id] ?? job.text)} grupos`
                          : "Aprobar"}
                      </button>
                      <button type="button" onClick={() => void decide(job, "REJECT")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-slate-700"><X className="h-3.5 w-3.5" /> Rechazar</button>
                    </>
                  )}
                  {job.status === "WAITING_USER" && (
                    <>
                      {!isNavigationAction(job.action) && !["JOIN_FACEBOOK_GROUP_BATCH", "REPLY_FACEBOOK_CONVERSATIONS"].includes(job.action) && job.text && (
                        <button type="button" onClick={() => void onPasteText(job.text!)} disabled={!ready || busy} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><Clipboard className="h-3.5 w-3.5" /> Pegar en el campo enfocado</button>
                      )}
                      {["JOIN_FACEBOOK_GROUP_BATCH", "REPLY_FACEBOOK_CONVERSATIONS"].includes(job.action) && (
                        <button type="button" onClick={() => void decide(job, "RETRY")} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Reintentar pendientes</button>
                      )}
                      <button type="button" onClick={() => void decide(job, "COMPLETE")} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white"><Check className="h-3.5 w-3.5" /> {["JOIN_FACEBOOK_GROUP_BATCH", "REPLY_FACEBOOK_CONVERSATIONS"].includes(job.action) ? "Cerrar lote" : isNavigationAction(job.action) ? "Revisión terminada" : "Ya lo publiqué"}</button>
                    </>
                  )}
                  {job.status === "FAILED" && <button type="button" onClick={() => void decide(job, "RETRY")} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white"><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button>}
                  {(["QUEUED", "WAITING_USER", "FAILED"].includes(job.status) || (job.status === "RUNNING" && job.action.endsWith("FACEBOOK_CONVERSATIONS"))) && <button type="button" onClick={() => void decide(job, "CANCEL")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-slate-600"><PauseCircle className="h-3.5 w-3.5" /> Cancelar</button>}
                  {job.targetUrl && <a href={job.targetUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-slate-600"><ExternalLink className="h-3.5 w-3.5" /> Ver destino</a>}
                </div>
              </details>
            ))}
          </div>
        )}
        </div>}
      </div>}

      <p className="mt-3 flex items-start gap-2 text-[11px] leading-4 text-slate-500">
        <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Primero revisa el resultado. Solo se ejecutan las solicitudes o respuestas que selecciones y apruebes. Mantén el móvil conectado y esta pantalla abierta.
      </p>
    </section>
  );
}
