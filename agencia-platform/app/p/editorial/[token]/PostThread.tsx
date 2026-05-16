"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, MessageCircle } from "lucide-react";

type Message = {
  id: string;
  authorType: "CLIENT" | "TEAM";
  authorId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
  author?: { id: string; name: string | null; image: string | null } | null;
};

/**
 * Hilo de mensajes entre cliente y equipo dentro del panel de
 * aprobación. Polling cada 30s para que el cliente vea las
 * respuestas del equipo sin recargar — solución simple antes de
 * subscriber realtime via SSE/WebSocket.
 */
export default function PostThread({
  token,
  postId,
  accent
}: {
  token: string;
  postId: string;
  accent: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const r = await fetch(`/api/public/approval/${token}/messages?postId=${postId}`);
      if (r.ok) {
        const data = await r.json();
        setMessages(data.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Polling cada 30s sólo si el hilo está abierto.
    if (!open) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [token, postId, open]);

  async function send() {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      const r = await fetch(`/api/public/approval/${token}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, body: text.trim() })
      });
      if (r.ok) {
        const m = await r.json();
        setMessages((prev) => [...prev, m]);
        setText("");
      }
    } finally {
      setPosting(false);
    }
  }

  if (loading) return null;

  return (
    <div className="mt-3 border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {open ? "Ocultar conversación" : `Conversación (${messages.length})`}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {messages.length === 0 && (
            <p className="text-xs text-slate-500 italic">
              Sin mensajes todavía. Escribe lo primero.
            </p>
          )}
          {messages.map((m) => {
            const isClient = m.authorType === "CLIENT";
            return (
              <div
                key={m.id}
                className={
                  "flex gap-2 " + (isClient ? "" : "flex-row-reverse text-right")
                }
              >
                <div
                  className={
                    "max-w-[80%] rounded-lg px-3 py-1.5 text-sm " +
                    (isClient ? "bg-slate-100 text-slate-800" : "text-white")
                  }
                  style={isClient ? undefined : { backgroundColor: accent }}
                >
                  <div className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">
                    {isClient ? m.authorName ?? "Cliente" : m.author?.name ?? "Equipo"} ·{" "}
                    {new Date(m.createdAt).toLocaleString("es-ES", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                </div>
              </div>
            );
          })}
          <div className="flex gap-2 items-start pt-1">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
              }}
              rows={2}
              placeholder="Responde al equipo…"
              className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2"
              style={{ "--tw-ring-color": accent } as React.CSSProperties}
            />
            <button
              type="button"
              onClick={send}
              disabled={posting || !text.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50"
              style={{ backgroundColor: accent }}
            >
              {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
