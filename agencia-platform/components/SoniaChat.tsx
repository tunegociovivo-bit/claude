"use client";

/**
 * Pair programming chat con Sonia. Botón flotante en esquina derecha
 * (arriba del área de notificaciones). Al click abre un panel lateral
 * con historial de chat + textarea + botón micro.
 *
 * Funcionalidad:
 *   - Texto: typing + Enter (Shift+Enter = nueva línea)
 *   - Voz: botón micro graba audio (MediaRecorder API), al soltar lo
 *     manda a /api/v1/voice/transcribe (Whisper), el texto resultante
 *     se pega al input para que David pueda editar antes de enviar
 *     (o se envía directamente si soltó con doble-click).
 *   - Streaming/no-streaming: por ahora respuesta entera (no SSE).
 *     El modelo es Haiku — latencia <2s típica.
 *
 * Persistencia: el historial vive en localStorage 'sonia-chat-v1' y
 * sobrevive a recargas. Botón "Limpiar" lo resetea.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, Mic, MicOff, Send, MessageCircle, X, Trash2 } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string; ts: number };

const STORAGE_KEY = "sonia-chat-v1";
const MAX_HISTORY = 30;

export default function SoniaChat() {
  const pathname = usePathname();
  // Ocultar en rutas sin sesión y en widgets embebidos públicos
  const hidden =
    !pathname ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/v/") ||
    pathname.startsWith("/p/");

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cargar historial al montar
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setMessages(parsed.slice(-MAX_HISTORY));
      }
    } catch {}
  }, []);

  // Persistir cuando cambien
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
    } catch {}
  }, [messages]);

  // Auto-scroll al final
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // Focus al abrir
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;
    setError(null);
    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setSending(true);
    try {
      const r = await fetch("/api/v1/sonia-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.slice(-MAX_HISTORY).map((m) => ({
            role: m.role,
            content: m.content
          }))
        })
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${r.status}`);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content ?? "(sin respuesta)", ts: Date.now() }
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  async function startRecording() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Tu navegador no soporta grabación de audio");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await uploadAndTranscribe();
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo acceder al micro");
    }
  }

  function stopRecording() {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    setRecording(false);
  }

  async function uploadAndTranscribe() {
    if (recordedChunksRef.current.length === 0) return;
    setTranscribing(true);
    try {
      const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
      const form = new FormData();
      form.append("audio", blob, "voice.webm");
      const r = await fetch("/api/v1/sonia-chat/voice", {
        method: "POST",
        body: form
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? `HTTP ${r.status}`);
      const text = String(data?.text ?? "").trim();
      if (!text) {
        setError("No se transcribió nada. Habla más cerca del micro.");
      } else {
        // Pegar al input para que el user pueda editar antes de enviar
        setInput((curr) => (curr ? `${curr} ${text}` : text));
        // Auto-focus para que pueda corregir o enviar
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    } catch (e: any) {
      setError(e?.message ?? "Transcripción falló");
    } finally {
      setTranscribing(false);
    }
  }

  function clearChat() {
    if (!confirm("¿Borrar todo el historial del chat?")) return;
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (hidden) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-brand-600 hover:bg-brand-700 text-white shadow-lg flex items-center justify-center transition-transform hover:scale-105"
        title="Chat con Sonia"
        aria-label="Abrir chat con Sonia"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[min(420px,calc(100vw-2rem))] h-[min(620px,calc(100vh-2rem))] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-sm">Chat con Sonia</span>
          <span className="text-xs text-slate-400">· Haiku</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
              title="Borrar historial"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
            title="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/50">
        {messages.length === 0 && (
          <div className="text-center text-xs text-slate-500 py-8 leading-relaxed">
            <p className="font-medium text-slate-700 mb-2">¿De qué hablamos?</p>
            <p>"¿cómo va RS Advocats?"</p>
            <p>"¿qué tasks tienen prioridad URGENTE hoy?"</p>
            <p>"explícame qué hace la task X"</p>
            <p className="mt-2 text-slate-400">
              Texto o pulsa el micro para hablar.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "flex justify-end"
                : "flex justify-start"
            }
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] bg-brand-600 text-white px-3 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap break-words"
                  : "max-w-[85%] bg-white border border-slate-200 px-3 py-2 rounded-2xl rounded-bl-sm text-sm whitespace-pre-wrap break-words shadow-sm"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white border px-3 py-2 rounded-2xl rounded-bl-sm text-sm flex items-center gap-2 text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sonia pensando…
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-xs bg-rose-50 text-rose-700 border-t border-rose-200">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t bg-white p-3 rounded-b-2xl">
        <div className="flex items-end gap-2">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              if (!recording && !transcribing) startRecording();
            }}
            onMouseUp={() => recording && stopRecording()}
            onMouseLeave={() => recording && stopRecording()}
            onTouchStart={(e) => {
              e.preventDefault();
              if (!recording && !transcribing) startRecording();
            }}
            onTouchEnd={() => recording && stopRecording()}
            disabled={transcribing || sending}
            className={
              "h-10 w-10 rounded-full flex items-center justify-center transition shrink-0 " +
              (recording
                ? "bg-rose-500 text-white animate-pulse"
                : transcribing
                  ? "bg-slate-200 text-slate-500"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700")
            }
            title={recording ? "Soltar para enviar" : "Mantén pulsado para grabar"}
            aria-label="Grabar voz"
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              recording
                ? "Grabando…"
                : transcribing
                  ? "Transcribiendo…"
                  : "Escribe o mantén pulsado el micro…"
            }
            disabled={recording || transcribing || sending}
            rows={1}
            className="flex-1 resize-none px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 max-h-32"
            style={{ minHeight: "40px" }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || sending || recording || transcribing}
            className="h-10 w-10 rounded-full bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white flex items-center justify-center transition shrink-0"
            title="Enviar (Enter)"
            aria-label="Enviar"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
