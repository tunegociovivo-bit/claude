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
  const [actionItems, setActionItems] = useState<{ title: string; assignee?: string; due?: string }[]>([]);

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
    setActionItems([]);
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
      setActionItems(data.actionItems ?? []);
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border overflow-hidden">
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

          {phase === "done" && (
            <>
              <div className="text-emerald-600 text-sm font-medium mb-2 inline-flex items-center gap-1">
                ✓ Resumen añadido al hilo de comentarios
              </div>
              {actionItems.length > 0 && (
                <div className="text-xs text-slate-600 mt-3 text-left">
                  Acciones detectadas:
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">
                    {actionItems.map((a, i) => (
                      <li key={i}>{a.title}{a.assignee ? ` — ${a.assignee}` : ""}{a.due ? ` (${a.due})` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm"
              >
                Cerrar
              </button>
            </>
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
