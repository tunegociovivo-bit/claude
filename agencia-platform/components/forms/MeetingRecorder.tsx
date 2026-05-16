"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Sparkles, X, Pause, Play } from "lucide-react";

type Phase =
  | "idle"
  | "asking-permission"
  | "recording"
  | "paused"
  | "processing"
  | "transcribing"
  | "summarizing"
  | "done"
  | "error";

/**
 * Graba la reunión desde el micrófono del navegador y la procesa con
 * IA (Whisper para transcribir + Claude para resumir). El resumen
 * estructurado se inserta como comentario rich en la tarea para que
 * quede unido al contexto.
 *
 * Limitaciones conocidas:
 *  - Whisper admite hasta ~25 MB. Una reunión de >25 min en webm ya
 *    se acerca al límite. Si excede, el endpoint devuelve 413 y aquí
 *    mostramos error claro.
 *  - Sólo audio (no captura pantalla / audio del sistema). Si la
 *    reunión está en otra app, hace falta micro físico abierto en la
 *    sala o un loopback a nivel sistema.
 *  - Permission denied → mostramos cómo darlo desde el navegador.
 */
export default function MeetingRecorder({
  taskId,
  open,
  onClose,
  onComment
}: {
  taskId: string;
  open: boolean;
  onClose: () => void;
  onComment: (comment: any) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  // Resumen completo devuelto por la IA. Se pinta en la fase "done"
  // como panel rico (no solo "✓ resumen añadido al hilo").
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  // Por cada acción, el user decide si ejecutarla. La ejecución crea
  // subtarea / email draft / evento de calendario / documento según
  // el `tool` que asignó la IA.
  const [actionSelection, setActionSelection] = useState<boolean[]>([]);
  const [executing, setExecuting] = useState(false);
  const [executedCounts, setExecutedCounts] = useState<null | {
    subtasks: number;
    emails: number;
    events: number;
    documents: number;
  }>(null);

  async function executeSelected() {
    if (!summary) return;
    const items = summary.action_items.filter((_, i) => actionSelection[i]);
    if (items.length === 0) return;
    setExecuting(true);
    try {
      const r = await fetch(`/api/v1/tasks/${taskId}/meeting/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setExecutedCounts(data.counts);
    } catch (e: any) {
      setError(`No se pudieron crear los elementos: ${e?.message ?? e}`);
    } finally {
      setExecuting(false);
    }
  }

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
    setSummary(null);
    setActionSelection([]);
    setExecutedCounts(null);
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
    setPhase("asking-permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Algunos navegadores no soportan webm/opus; dejamos que MediaRecorder
      // elija el mejor formato por defecto si el específico falla.
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setBlob(finalBlob);
        stopTracks();
      };
      recorderRef.current = rec;
      rec.start(1000); // chunks cada 1s para tener data parcial incremental
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
    // El onstop pone el blob y setea fase a "processing" tras click manual.
    setPhase("processing");
  }

  async function processWithAi() {
    if (!blob) return;
    setError(null);
    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, `meeting-${Date.now()}.webm`);
      form.append("durationSec", String(elapsed));
      const r = await fetch(`/api/v1/tasks/${taskId}/meeting`, {
        method: "POST",
        body: form
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Servidor ${r.status}`);
      }
      setPhase("summarizing");
      const data = await r.json();
      const sum: MeetingSummary | null = data.summary ?? null;
      setSummary(sum);
      // Por defecto seleccionamos todas las ejecutables — el user
      // deselecciona las que no quiera.
      setActionSelection((sum?.action_items ?? []).map((a) => !!a.executable));
      if (data.comment) onComment(data.comment);
      setPhase("done");
    } catch (e: any) {
      setPhase("error");
      setError(e?.message ?? "No se pudo procesar la reunión.");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm grid place-items-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== "recording" && phase !== "paused") onClose();
      }}
    >
      <div
        className={
          "bg-white rounded-xl shadow-2xl w-full border overflow-hidden " +
          // Modal estrecho durante grabación; ancho al ver el resumen
          // para que las secciones respiren sin truncarse.
          (phase === "done" ? "max-w-3xl" : "max-w-md")
        }
      >
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <Mic className="h-4 w-4 text-rose-600" />
          <h3 className="font-semibold text-slate-900 flex-1">Grabar reunión</h3>
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
                Graba la conversación. Al terminar, la IA generará un resumen con puntos
                clave, decisiones y tareas pendientes, y lo añadirá como comentario.
              </p>
              <button
                onClick={startRecording}
                className="px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium inline-flex items-center gap-2"
              >
                <Mic className="h-4 w-4" />
                Empezar a grabar
              </button>
            </>
          )}

          {phase === "asking-permission" && (
            <p className="text-sm text-slate-600 inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Solicitando permiso del micrófono…
            </p>
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
                <span className="text-xs text-slate-500">{phase === "paused" ? "(pausado)" : ""}</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Habla con normalidad. Cuanto más claro el audio, mejor el resumen.
              </p>
              <div className="mt-5 flex items-center justify-center gap-2">
                <button
                  onClick={togglePause}
                  className="px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-sm inline-flex items-center gap-1.5"
                >
                  {phase === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  {phase === "paused" ? "Reanudar" : "Pausa"}
                </button>
                <button
                  onClick={stopRecording}
                  className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm inline-flex items-center gap-1.5"
                >
                  <Square className="h-3.5 w-3.5" />
                  Detener
                </button>
              </div>
            </>
          )}

          {phase === "processing" && blob && (
            <>
              <p className="text-sm text-slate-600 mb-3">
                {formatTime(elapsed)} grabados · {(blob.size / (1024 * 1024)).toFixed(1)} MB
              </p>
              <audio src={URL.createObjectURL(blob)} controls className="w-full mb-4" />
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => reset()}
                  className="px-4 py-2 rounded-md border bg-white hover:bg-slate-50 text-sm"
                >
                  Descartar y volver
                </button>
                <button
                  onClick={processWithAi}
                  className="px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm inline-flex items-center gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  Procesar con IA
                </button>
              </div>
            </>
          )}

          {(phase === "transcribing" || phase === "summarizing") && (
            <div className="text-sm text-slate-600 inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === "transcribing" ? "Transcribiendo audio…" : "Generando resumen…"}
            </div>
          )}

          {phase === "done" && summary && (
            <MeetingDonePanel
              summary={summary}
              actionSelection={actionSelection}
              setActionSelection={setActionSelection}
              executing={executing}
              executedCounts={executedCounts}
              onExecute={executeSelected}
              onClose={onClose}
            />
          )}

          {phase === "error" && (
            <>
              <p className="text-sm text-rose-600 mb-3">{error}</p>
              <button
                onClick={() => reset()}
                className="px-4 py-2 rounded-md border bg-white hover:bg-slate-50 text-sm"
              >
                Volver a empezar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type ActionTool = "subtask" | "email" | "calendar_event" | "document";

export type MeetingAction = {
  title: string;
  assignee?: string | null;
  due?: string | null;
  tool: ActionTool;
  tool_details?: string | null;
  executable: boolean;
};

export type MeetingSummary = {
  summary: string;
  participants: string[];
  topics: string[];
  critical_points: string[];
  key_points: string[];
  decisions: string[];
  open_questions: string[];
  action_items: MeetingAction[];
};

/**
 * Panel post-grabación: muestra el resumen completo (no solo
 * "✓ añadido al hilo") y permite seleccionar qué acciones quiere
 * el usuario que se materialicen en el Hub. El render se hace en
 * el modal del MeetingRecorder para que sea visible al instante
 * sin tener que ir a buscar el comentario en el hilo.
 */
function MeetingDonePanel({
  summary,
  actionSelection,
  setActionSelection,
  executing,
  executedCounts,
  onExecute,
  onClose
}: {
  summary: MeetingSummary;
  actionSelection: boolean[];
  setActionSelection: (next: boolean[]) => void;
  executing: boolean;
  executedCounts: null | { subtasks: number; emails: number; events: number; documents: number };
  onExecute: () => void;
  onClose: () => void;
}) {
  function toggle(i: number) {
    const next = [...actionSelection];
    next[i] = !next[i];
    setActionSelection(next);
  }

  const selectedCount = actionSelection.filter(Boolean).length;
  const totalExecuted = executedCounts
    ? executedCounts.subtasks + executedCounts.emails + executedCounts.events + executedCounts.documents
    : 0;

  return (
    <div className="text-left space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      <div className="text-emerald-700 text-xs font-medium inline-flex items-center gap-1.5">
        ✓ Resumen completo añadido al hilo de comentarios
      </div>

      {summary.summary && (
        <Section title="Resumen">
          <p className="text-sm text-slate-700 leading-relaxed">{summary.summary}</p>
        </Section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {summary.participants.length > 0 && (
          <Section title="👥 Participantes">
            <BulletList items={summary.participants} />
          </Section>
        )}
        {summary.topics.length > 0 && (
          <Section title="🗂️ Temas tratados">
            <BulletList items={summary.topics} />
          </Section>
        )}
      </div>

      {summary.critical_points.length > 0 && (
        <Section title="⚠️ Vital importancia" tone="danger">
          <BulletList items={summary.critical_points} />
        </Section>
      )}

      {summary.key_points.length > 0 && (
        <Section title="📌 Puntos clave">
          <BulletList items={summary.key_points} />
        </Section>
      )}

      {summary.decisions.length > 0 && (
        <Section title="✓ Decisiones">
          <BulletList items={summary.decisions} />
        </Section>
      )}

      {summary.open_questions.length > 0 && (
        <Section title="❓ Preguntas abiertas">
          <BulletList items={summary.open_questions} />
        </Section>
      )}

      {summary.action_items.length > 0 && (
        <Section title={`📋 Acciones detectadas (${summary.action_items.length})`}>
          <p className="text-xs text-slate-500 mb-2">
            Marca las que quieres que el sistema cree. Las ejecutables están preseleccionadas.
          </p>
          <ul className="space-y-1.5">
            {summary.action_items.map((a, i) => (
              <li key={i} className="flex items-start gap-2 bg-slate-50 rounded-md p-2">
                <input
                  type="checkbox"
                  checked={!!actionSelection[i]}
                  onChange={() => toggle(i)}
                  disabled={!a.executable || executing || !!executedCounts}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0 text-xs">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border text-[10px] text-slate-600">
                      {toolBadge(a.tool)}
                    </span>
                    <span className="font-medium text-slate-900">{a.title}</span>
                    {a.assignee && <span className="text-slate-500">→ {a.assignee}</span>}
                    {a.due && <span className="text-slate-400">({a.due})</span>}
                    {!a.executable && (
                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1 rounded">
                        manual
                      </span>
                    )}
                  </div>
                  {a.tool_details && (
                    <p className="text-[11px] text-slate-600 mt-0.5">{a.tool_details}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {executedCounts ? (
            <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
              ✓ Creados {totalExecuted} elementos:{" "}
              {executedCounts.subtasks > 0 && <span>{executedCounts.subtasks} subtarea{executedCounts.subtasks === 1 ? "" : "s"}</span>}
              {executedCounts.emails > 0 && <span> · {executedCounts.emails} email{executedCounts.emails === 1 ? "" : "s"} draft</span>}
              {executedCounts.events > 0 && <span> · {executedCounts.events} evento{executedCounts.events === 1 ? "" : "s"}</span>}
              {executedCounts.documents > 0 && <span> · {executedCounts.documents} documento{executedCounts.documents === 1 ? "" : "s"}</span>}
            </div>
          ) : (
            <button
              type="button"
              onClick={onExecute}
              disabled={selectedCount === 0 || executing}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Crear {selectedCount} elemento{selectedCount === 1 ? "" : "s"} seleccionados
            </button>
          )}
        </Section>
      )}

      <div className="pt-2 text-right">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  tone
}: {
  title: string;
  children: React.ReactNode;
  tone?: "danger";
}) {
  return (
    <div
      className={
        "rounded-lg border p-3 " +
        (tone === "danger" ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200")
      }
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc ml-4 space-y-0.5 text-xs text-slate-700">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

function toolBadge(tool: ActionTool): string {
  switch (tool) {
    case "email":
      return "✉️ Email";
    case "calendar_event":
      return "📅 Evento";
    case "document":
      return "📄 Documento";
    case "subtask":
    default:
      return "✅ Subtarea";
  }
}
