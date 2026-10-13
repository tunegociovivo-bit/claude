"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Square, Trash2 } from "lucide-react";

const MAX_SECONDS = 300;

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {}
  }
  return "";
}

export function voiceRecordingSupported() {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

function mmss(total: number) {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Grabación de una nota de voz: se graba, se escucha y se envía (o se descarta).
// Empieza a grabar al abrirse (tras pulsar el micrófono).
export default function VoiceComposer({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (blob: Blob, idempotencyKey: string) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<"starting" | "recording" | "preview" | "sending" | "error">("starting");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const discarded = useRef(false);
  // Una clave por grabación: si la red falla y se pulsa otra vez «Enviar», el
  // servidor reconoce el reintento y no manda la nota dos veces.
  const sendKey = useRef(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

  function stopTracks() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        const mime = pickMime();
        const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        recorder.current = rec;
        chunks.current = [];
        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        rec.onstop = () => {
          stopTracks();
          if (discarded.current) return;
          const b = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
          setBlob(b);
          setUrl(URL.createObjectURL(b));
          setPhase("preview");
        };
        rec.start(250);
        startedAt.current = Date.now();
        setPhase("recording");
      } catch (e) {
        setError(
          (e as Error)?.name === "NotAllowedError"
            ? "Permite el micrófono para este sitio en el navegador y vuelve a intentarlo."
            : "No se pudo usar el micrófono de este dispositivo."
        );
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      discarded.current = true;
      try {
        if (recorder.current?.state === "recording") recorder.current.stop();
      } catch {}
      stopTracks();
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  function stop() {
    try {
      if (recorder.current?.state === "recording") recorder.current.stop();
    } catch {}
  }

  function discard() {
    discarded.current = true;
    stop();
    stopTracks();
    onCancel();
  }

  async function send() {
    if (!blob) return;
    setPhase("sending");
    const ok = await onSend(blob, sendKey.current);
    if (ok) onCancel();
    else setPhase("preview");
  }

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <button type="button" onClick={discard} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-red-600 hover:bg-red-50" aria-label="Descartar nota de voz">
        <Trash2 size={19} />
      </button>
      {phase === "starting" && <span className="flex-1 text-sm text-slate-500">Abriendo micrófono…</span>}
      {phase === "error" && <span className="flex-1 text-sm text-red-600">{error}</span>}
      {phase === "recording" && (
        <>
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-slate-700">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
            Grabando {mmss(seconds)}
            <span className="hidden text-xs font-normal text-slate-400 sm:inline">· máx. 5 min</span>
          </span>
          <button type="button" onClick={stop} className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white" aria-label="Parar y escuchar">
            <Square size={14} fill="currentColor" /> Parar
          </button>
        </>
      )}
      {(phase === "preview" || phase === "sending") && url && (
        <>
          <audio src={url} controls className="h-10 min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => void send()}
            disabled={phase === "sending"}
            className="btn-primary h-11 w-11 shrink-0 rounded-full px-0"
            aria-label="Enviar nota de voz"
          >
            {phase === "sending" ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </button>
        </>
      )}
    </div>
  );
}
