"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Bot, RefreshCw } from "lucide-react";
import clsx from "clsx";

type Thread = {
  phone: string;
  lastMessage: string;
  direction: string;
  at: string;
  contact: { id: string; name: string; stage: string } | null;
};

type Msg = {
  id: string;
  direction: "in" | "out";
  body: string;
  createdAt: string;
  meta: any;
};

export default function ConversacionesClient() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/v1/conversations");
    if (res.ok) setThreads((await res.json()).conversations);
  }, []);

  const loadMessages = useCallback(async (phone: string) => {
    const res = await fetch(`/api/v1/conversations?phone=${encodeURIComponent(phone)}`);
    if (res.ok) setMessages((await res.json()).messages);
  }, []);

  useEffect(() => {
    loadThreads();
    const t = setInterval(loadThreads, 15000);
    return () => clearInterval(t);
  }, [loadThreads]);

  useEffect(() => {
    if (!selected) return;
    loadMessages(selected);
    const t = setInterval(() => loadMessages(selected), 8000);
    return () => clearInterval(t);
  }, [selected, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !text.trim()) return;
    setSending(true);
    setError(null);
    const res = await fetch("/api/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: selected, text: text.trim() }),
    });
    setSending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo enviar");
      return;
    }
    setText("");
    loadMessages(selected);
  }

  const selectedThread = threads.find((t) => t.phone === selected);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Conversaciones de WhatsApp</h1>
        <button className="btn-ghost" onClick={loadThreads} title="Recargar">
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="card flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-200">
          {threads.length === 0 && (
            <p className="p-4 text-sm text-slate-500">
              Aún no hay conversaciones. Cuando alguien escriba al WhatsApp del
              negocio aparecerá aquí.
            </p>
          )}
          {threads.map((t) => (
            <button
              key={t.phone}
              onClick={() => setSelected(t.phone)}
              className={clsx(
                "block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50",
                selected === t.phone && "bg-brand-50"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-medium">
                  {t.contact?.name ?? t.phone}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {new Date(t.at).toLocaleDateString("es-ES", {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
              </div>
              <div className="truncate text-xs text-slate-500">
                {t.direction === "out" ? "Tú: " : ""}
                {t.lastMessage}
              </div>
            </button>
          ))}
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Selecciona una conversación
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="text-sm font-semibold">
                  {selectedThread?.contact?.name ?? selected}
                </div>
                <div className="text-xs text-slate-500">{selected}</div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/50 p-4">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={clsx(
                      "flex",
                      m.direction === "out" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={clsx(
                        "max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                        m.direction === "out"
                          ? "bg-brand-500 text-white"
                          : "bg-white shadow-sm"
                      )}
                    >
                      {m.meta?.sonia && (
                        <span className="mb-1 flex items-center gap-1 text-xs opacity-75">
                          <Bot size={12} /> SONIA
                        </span>
                      )}
                      {m.body}
                      <div
                        className={clsx(
                          "mt-1 text-right text-[10px]",
                          m.direction === "out" ? "text-white/70" : "text-slate-400"
                        )}
                      >
                        {new Date(m.createdAt).toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-3">
                <input
                  className="input"
                  placeholder="Escribe una respuesta…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <button className="btn-primary" disabled={sending || !text.trim()}>
                  <Send size={15} />
                </button>
              </form>
              {error && <p className="px-4 pb-2 text-sm text-red-600">{error}</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
