"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Sparkles, X, Pause, Play, Check, Edit3 } from "lucide-react";

type Phase = "idle" | "recording" | "paused" | "processing" | "preview" | "saving" | "done" | "error";

type Draft = {
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal" | null;
  dueDate: string | null;
  dueTime: string | null;
  projectName: string | null;
  assigneeNames: string[];
  tagNames: string[];
};

type Resolved = {
  projectId: string | null;
  assigneeIds: string[];
};

/**
 * Modal: graba audio del usuario describiendo una tarea, lo manda
 * a /api/v1/tasks/voice-create (Whisper + Claude), muestra el draft
 * para revisar y crea la tarea al confirmar. Si el usuario quiere
 * editar campos antes de crear, abre el form completo via prop
 * `onOpenInForm` (el padre se encarga de abrir TaskFormModal con
 * los valores pre-rellenados).
 */
export default function VoiceTaskRecorder({
  open,
  onClose,
  defaultProjectId,
  onCreated,
  onOpenInForm
}: {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
  onCreated: () => void;
  onOpenInForm?: (preset: {
    title: string;
    description?: string;
    projectId?: string;
    assigneeIds?: string[];
    priority?: "urgent" | "high" | "normal" | null;
    dueDate?: string;
    dueTime?: string;
  }) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) reset();
    return () => stopTracks();
  }, [open]);

  function reset() {
    stopTracks();
    setPhase("idle");
    setError(null);
    setElapsed(0);
    setBlob(null);
    setTranscript("");
    setDraft(null);
    setResolved(null);
    chunksRef.current = [];
  }

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setBlob(finalBlob);
        stopTracks();
        // Auto-procesar al detener: no hay revisión de audio aquí,
        // queremos que el flow sea de "hablo y aparece la tarea".
        void processAudio(finalBlob);
      };
      recorderRef.current = rec;
      rec.start(1000);
      setPhase("recording");
      const startedAt = Date.now();
      tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    } catch (e: any) {
      setPhase("error");
      setError(
        e?.name === "NotAllowedError"
          ? "Permiso de micrófono denegado. Habilítalo en el icono de candado de la URL."
          : e?.message ?? "No se pudo abrir el micrófono."
      );
    }
  }

  function togglePause() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      setPhase("paused");
      if (tickRef.current) clearInterval(tickRef.current);
    } else if (rec.state === "paused") {
      rec.resume();
      setPhase("recording");
      const baseline = Date.now() - elapsed * 1000;
      tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - baseline) / 1000)), 500);
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (tickRef.current) clearInterval(tickRef.current);
    rec.stop();
  }

  async function processAudio(audioBlob: Blob) {
    setPhase("processing");
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", audioBlob, `task-voice-${Date.now()}.webm`);
      if (defaultProjectId) form.append("projectHint", defaultProjectId);
      const r = await fetch("/api/v1/tasks/voice-create", { method: "POST", body: form });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Servidor ${r.status}`);
      }
      const data = await r.json();
      setTranscript(data.transcript ?? "");
      setDraft(data.draft);
      setResolved(data.resolved ?? null);
      setPhase("preview");
    } catch (e: any) {
      setPhase("error");
      setError(e?.message ?? "No se pudo generar la tarea.");
    }
  }

  async function createTask() {
    if (!draft) return;
    setPhase("saving");
    try {
      const payload: any = {
        title: draft.title,
        description: draft.description ?? undefined,
        projectId: resolved?.projectId ?? defaultProjectId,
        assigneeIds: resolved?.assigneeIds ?? [],
        priority:
          draft.priority === "urgent"
            ? "URGENT"
            : draft.priority === "high"
              ? "HIGH"
              : "MEDIUM",
        status: "TODO"
      };
      if (draft.dueDate) {
        payload.dueDate = draft.dueTime
          ? `${draft.dueDate}T${draft.dueTime}:00.000Z`
          : `${draft.dueDate}T00:00:00.000Z`;
        payload.dueAllDay = !draft.dueTime;
      }
      if (!payload.projectId) {
        throw new Error("No se pudo determinar el proyecto. Edita manualmente.");
      }
      const r = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `Servidor ${r.status}`);
      }
      setPhase("done");
      onCreated();
      setTimeout(onClose, 800);
    } catch (e: any) {
      setPhase("error");
      setError(e?.message ?? "No se pudo crear la tarea.");
    }
  }

  function openForEdit() {
    if (!draft || !onOpenInForm) return;
    onOpenInForm({
      title: draft.title,
      description: draft.description ?? undefined,
      projectId: resolved?.projectId ?? defaultProjectId,
      assigneeIds: resolved?.assigneeIds ?? [],
      priority: draft.priority,
      dueDate: draft.dueDate ?? undefined,
      dueTime: draft.dueTime ?? undefined
    });
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] bg-slate-900/40 backdrop-blur-sm grid place-items-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== "recording" && phase !== "paused") onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <Mic className="h-4 w-4 text-rose-600" />
          <h3 className="font-semibold text-slate-900 flex-1">Nueva tarea por voz</h3>
          {phase !== "recording" && phase !== "paused" && (
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="px-5 py-6 text-center">
          {phase === "idle" && (
            <>
              <p className="text-sm text-slate-600 mb-4">
                Dicta una tarea — di título, contexto, fecha, asignado… La IA la
                estructura y la creas con un click.
              </p>
              <button
                onClick={startRecording}
                className="px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium inline-flex items-center gap-2"
              >
                <Mic className="h-4 w-4" /> Empezar a dictar
              </button>
            </>
          )}

          {(phase === "recording" || phase === "paused") && (
            <>
              <div className="inline-flex items-center gap-2 text-rose-600">
                <span
                  className={
                    "h-3 w-3 rounded-full bg-rose-600 " +
                    (phase === "recording" ? "animate-pulse" : "")
                  }
                />
                <span className="font-mono text-lg">{formatTime(elapsed)}</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">Habla con normalidad.</p>
              <div className="mt-5 flex items-center justify-center gap-2">
                <button onClick={togglePause} className="px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-sm inline-flex items-center gap-1.5">
                  {phase === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  {phase === "paused" ? "Reanudar" : "Pausa"}
                </button>
                <button onClick={stopRecording} className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm inline-flex items-center gap-1.5">
                  <Square className="h-3.5 w-3.5" /> Detener y procesar
                </button>
              </div>
            </>
          )}

          {phase === "processing" && (
            <div className="text-sm text-slate-600 inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> La IA está estructurando la tarea…
            </div>
          )}

          {phase === "preview" && draft && (
            <div className="text-left space-y-3">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                ✓ Tarea generada — revisa y confirma.
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Título</div>
                <div className="px-3 py-2 rounded-md border bg-white text-sm font-medium">{draft.title}</div>
              </div>
              {draft.description && (
                <div className="space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Descripción</div>
                  <div className="px-3 py-2 rounded-md border bg-slate-50 text-xs whitespace-pre-wrap">
                    {draft.description}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {draft.priority && (
                  <Chip label="Prioridad" value={draft.priority === "urgent" ? "🚨 Urgencia" : draft.priority === "high" ? "Alta" : "Normal"} />
                )}
                {draft.dueDate && (
                  <Chip label="Vencimiento" value={`${draft.dueDate}${draft.dueTime ? " " + draft.dueTime : ""}`} />
                )}
                {draft.projectName && (
                  <Chip
                    label="Proyecto"
                    value={draft.projectName}
                    warn={!resolved?.projectId}
                  />
                )}
                {draft.assigneeNames.length > 0 && (
                  <Chip
                    label="Asignado"
                    value={draft.assigneeNames.join(", ")}
                    warn={resolved && resolved.assigneeIds.length === 0 ? true : false}
                  />
                )}
              </div>
              <details className="text-[11px]">
                <summary className="cursor-pointer text-slate-500">Ver transcripción</summary>
                <p className="text-slate-600 mt-1 italic">{transcript}</p>
              </details>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  onClick={createTask}
                  className="flex-1 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium inline-flex items-center justify-center gap-1.5"
                >
                  <Check className="h-4 w-4" /> Crear tarea
                </button>
                {onOpenInForm && (
                  <button
                    onClick={openForEdit}
                    className="px-3 py-2 rounded-md border bg-white hover:bg-slate-50 text-sm inline-flex items-center gap-1.5"
                  >
                    <Edit3 className="h-4 w-4" /> Editar antes
                  </button>
                )}
                <button
                  onClick={reset}
                  className="px-3 py-2 rounded-md border bg-white hover:bg-slate-50 text-sm"
                >
                  Volver a grabar
                </button>
              </div>
            </div>
          )}

          {phase === "saving" && (
            <div className="text-sm text-slate-600 inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Creando tarea…
            </div>
          )}

          {phase === "done" && (
            <div className="text-emerald-600 text-sm font-medium inline-flex items-center gap-1">
              <Sparkles className="h-4 w-4" /> Tarea creada
            </div>
          )}

          {phase === "error" && (
            <>
              <p className="text-sm text-rose-600 mb-3">{error}</p>
              <button onClick={reset} className="px-4 py-2 rounded-md border bg-white hover:bg-slate-50 text-sm">
                Volver a empezar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, warn }: { label: string; value: string; warn?: boolean | null }) {
  return (
    <div
      className={
        "rounded-md border px-2 py-1.5 " +
        (warn ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200")
      }
    >
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={"text-xs " + (warn ? "text-amber-800" : "text-slate-800")}>{value}</div>
      {warn && <div className="text-[10px] text-amber-700">No encontrado — revisa</div>}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
