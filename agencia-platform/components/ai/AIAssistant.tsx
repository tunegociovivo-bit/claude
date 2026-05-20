"use client";

/**
 * Chat con Sonia (era "Hub"). Botón flotante esquina inferior derecha
 * disponible en toda la app. Combina:
 *
 *  - Loop agéntico vía /api/v1/ai/chat (Opus + tools de chat-tools.ts):
 *    puede listar tasks, crear recursos, resumir documentos, etc.
 *
 *  - Entrada por VOZ (micrófono): MediaRecorder API → Whisper vía
 *    /api/v1/sonia-chat/voice → el texto transcrito se pega al input
 *    para que David lo revise antes de enviar.
 *
 *  - Sugerencias rápidas al abrir un chat vacío.
 *
 * Persistencia: NO — el chat se vacía al recargar. Si se necesita
 * historial persistente, añadir localStorage con clave 'sonia-chat-v1'.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  X,
  Send,
  Loader2,
  Mic,
  MicOff,
  CheckSquare,
  User,
  FolderKanban,
  FileText,
  Calendar,
  ArrowUpRight
} from "lucide-react";
import clsx from "clsx";

type HubCard = {
  type: "task" | "client" | "project" | "document" | "event";
  title: string;
  url: string;
  subtitle?: string;
  badges?: { label: string; tone?: "default" | "red" | "amber" | "green" | "indigo" }[];
};

type Message = { role: "user" | "assistant"; content: string; cards?: HubCard[] };

const SUGGESTIONS = [
  "¿Qué tareas tiene Nordic Coffee abiertas?",
  "Lista las publicaciones de Instagram de esta semana",
  "Crea una tarea de revisión de copy para mañana en el proyecto de Atelier",
  "Resume el estado de los proyectos activos"
];

export default function AIAssistant() {
  const pathname = usePathname();
  const hidden =
    !pathname ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/v/") ||
    pathname.startsWith("/p/");

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(content?: string) {
    const text = (content ?? input).trim();
    if (!text || loading) return;
    setInput("");
    setError(null);
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const r = await fetch("/api/v1/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? "Error del asistente");
      }
      const data = await r.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply, cards: Array.isArray(data.cards) ? data.cards : undefined }
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
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
        setInput((curr) => (curr ? `${curr} ${text}` : text));
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } catch (e: any) {
      setError(e?.message ?? "Transcripción falló");
    } finally {
      setTranscribing(false);
    }
  }

  if (hidden) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg hover:shadow-xl grid place-items-center transition-all hover:scale-105 z-40"
          title="Chat con Sonia"
          aria-label="Chat con Sonia"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 w-[420px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl border shadow-2xl flex flex-col z-40">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="font-semibold text-sm">Sonia</div>
                <div className="text-[11px] text-slate-500">Tu asistente de agencia</div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-900"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Pregúntame lo que necesites del workspace: tareas, clientes, proyectos, documentos.
                  También puedo crear tareas, sugerir copy o resumir documentos. Usa el micro
                  para hablarme en vez de escribir.
                </p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="w-full text-left text-xs p-2 rounded-lg border bg-white hover:bg-slate-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={clsx(
                    "flex flex-col",
                    m.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={clsx(
                      "rounded-2xl px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words",
                      m.role === "user"
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-900"
                    )}
                  >
                    {m.role === "assistant" ? renderRichText(m.content) : m.content}
                  </div>
                  {m.role === "assistant" && m.cards && m.cards.length > 0 && (
                    <div className="mt-1.5 w-[92%] space-y-1.5">
                      {m.cards.map((c, k) => (
                        <HubCardItem key={`${i}-${k}-${c.url}`} card={c} onNavigate={() => setOpen(false)} />
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-2xl px-3 py-2 text-sm text-slate-500 inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Pensando…
                </div>
              </div>
            )}
            {error && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">
                {error}
              </div>
            )}
          </div>

          <div className="p-3 border-t">
            <div className="flex gap-2 items-center">
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!recording && !transcribing && !loading) startRecording();
                }}
                onMouseUp={() => recording && stopRecording()}
                onMouseLeave={() => recording && stopRecording()}
                onTouchStart={(e) => {
                  e.preventDefault();
                  if (!recording && !transcribing && !loading) startRecording();
                }}
                onTouchEnd={() => recording && stopRecording()}
                disabled={transcribing || loading}
                className={clsx(
                  "h-9 w-9 rounded-lg flex items-center justify-center transition shrink-0",
                  recording
                    ? "bg-rose-500 text-white animate-pulse"
                    : transcribing
                      ? "bg-slate-200 text-slate-500"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                )}
                title={recording ? "Soltar para enviar al texto" : "Mantén pulsado para grabar"}
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
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  recording
                    ? "Grabando…"
                    : transcribing
                      ? "Transcribiendo…"
                      : "Pregunta o instrucción…"
                }
                className="flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
                disabled={loading || recording || transcribing}
              />
              <button
                onClick={() => send()}
                disabled={loading || !input.trim() || recording || transcribing}
                className="h-9 w-9 rounded-lg bg-brand-600 hover:bg-brand-700 text-white grid place-items-center disabled:opacity-50"
                aria-label="Enviar"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const CARD_ICON: Record<HubCard["type"], typeof CheckSquare> = {
  task: CheckSquare,
  client: User,
  project: FolderKanban,
  document: FileText,
  event: Calendar
};

const BADGE_TONE: Record<NonNullable<NonNullable<HubCard["badges"]>[number]["tone"]>, string> = {
  default: "bg-slate-200 text-slate-600",
  red: "bg-rose-100 text-rose-700",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-700",
  indigo: "bg-indigo-100 text-indigo-700"
};

/** Tarjeta interactiva de un resultado del Hub dentro del chat de Sonia. */
function HubCardItem({ card, onNavigate }: { card: HubCard; onNavigate: () => void }) {
  const Icon = CARD_ICON[card.type] ?? FileText;
  return (
    <Link
      href={card.url}
      onClick={onNavigate}
      className="group flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
    >
      <Icon className="h-4 w-4 text-slate-400 mt-0.5 shrink-0 group-hover:text-brand-600" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-slate-900 truncate">{card.title}</div>
        {card.subtitle && <div className="text-[11px] text-slate-500 truncate">{card.subtitle}</div>}
        {card.badges && card.badges.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {card.badges.map((b, i) => (
              <span
                key={i}
                className={clsx(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                  BADGE_TONE[b.tone ?? "default"]
                )}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <ArrowUpRight className="h-3.5 w-3.5 text-slate-300 shrink-0 group-hover:text-brand-600" />
    </Link>
  );
}

/**
 * Render ligero de markdown — solo enlaces [texto](url) y negrita **x**.
 * Sin librería externa. Los enlaces internos (que empiezan por /) usan
 * next/link para navegar sin recargar; los externos abren en pestaña
 * nueva. El resto del texto se respeta tal cual (whitespace-pre-wrap
 * lo maneja el contenedor).
 */
function renderRichText(text: string): React.ReactNode {
  // Partimos por enlaces markdown y negritas, preservando el orden.
  const tokenRe = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] && m[2] !== undefined) {
      // Enlace
      const label = m[1];
      const href = m[2];
      if (href.startsWith("/")) {
        out.push(
          <Link
            key={key++}
            href={href}
            className="text-brand-700 underline underline-offset-2 hover:text-brand-900 font-medium"
          >
            {label}
          </Link>
        );
      } else {
        out.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-brand-700 underline underline-offset-2 hover:text-brand-900 font-medium"
          >
            {label}
          </a>
        );
      }
    } else if (m[3] !== undefined) {
      out.push(
        <strong key={key++} className="font-semibold">
          {m[3]}
        </strong>
      );
    }
    last = tokenRe.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
