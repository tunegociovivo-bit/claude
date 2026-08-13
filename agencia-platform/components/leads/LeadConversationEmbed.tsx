"use client";

/**
 * Ventana de conversación de WhatsApp EMBEBIDA (dentro de una tarea del hub).
 * Muestra el hilo del lead, el número de Sonia que lo gestiona y una caja para
 * responder sin salir de la tarea. Pensada también para móvil (compacta).
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, ExternalLink } from "lucide-react";

type Msg = {
  id: string;
  direction: "in" | "out";
  body: string;
  at: string;
  instanceName?: string | null;
  ack?: number | null;
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function LeadConversationEmbed({ phone, leadId }: { phone: string; leadId?: string | null }) {
  const [items, setItems] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyChannel, setReplyChannel] = useState<string | null>(null);
  const [leadName, setLeadName] = useState<string | null>(null);
  const [realPhone, setRealPhone] = useState<string | null>(null);
  const [isLid, setIsLid] = useState(false);
  const [optedOut, setOptedOut] = useState(false);
  const [channels, setChannels] = useState<{ name: string; label?: string | null; phone?: string | null }[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const q = new URLSearchParams({ phone });
      if (leadId) q.set("leadId", leadId);
      const r = await fetch(`/api/v1/leads/inbox/conversation?${q.toString()}`, { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.items ?? []);
      setReplyChannel(d.replyChannel ?? null);
      setLeadName(d.lead?.name ?? d.displayName ?? null);
      setRealPhone(d.realPhone ?? null);
      setIsLid(!!d.isLid);
      setOptedOut(!!d.optedOut);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    const i = setInterval(() => void load(), 12_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  useEffect(() => {
    fetch("/api/v1/leads/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setChannels(Array.isArray(d?.channels) ? d.channels : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [items]);

  const chan = channels.find((c) => c.name === replyChannel);
  const chanLabel = chan?.label || chan?.phone || replyChannel || "Principal";

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    // Optimista: pinta el mensaje ya.
    setItems((prev) => [...prev, { id: `tmp-${Date.now()}`, direction: "out", body: t, at: new Date().toISOString() }]);
    setText("");
    try {
      const r = await fetch("/api/v1/leads/inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, leadId: leadId ?? undefined, text: t })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d?.message ?? d?.error?.message ?? "No se pudo enviar el mensaje.");
      }
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Error de red");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50/40 overflow-hidden">
      {/* Cabecera: nombre + número de Sonia que gestiona + abrir en generador */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-emerald-100/70 border-b border-emerald-200">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-emerald-900 truncate">
            💬 Conversación WhatsApp{leadName ? ` · ${leadName}` : ""}
          </div>
          <div className="text-[10px] text-emerald-800/80 truncate">
            📱 Gestionado por: <strong>{chanLabel}</strong>
            {realPhone && !isLid ? ` · ${realPhone}` : isLid ? " · nº oculto por WhatsApp" : ""}
          </div>
        </div>
        <a
          href={`/admin/leads?tab=inbox&phone=${encodeURIComponent(phone)}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 hover:text-emerald-900"
          title="Abrir la conversación en el generador de leads"
        >
          <ExternalLink className="h-3 w-3" /> Abrir
        </a>
      </div>

      {/* Hilo */}
      <div ref={scrollRef} className="max-h-56 overflow-y-auto px-3 py-2 space-y-1.5 bg-white/60">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando conversación…
          </div>
        ) : items.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-4">Sin mensajes todavía.</div>
        ) : (
          items.map((m) => (
            <div key={m.id} className={"flex " + (m.direction === "out" ? "justify-end" : "justify-start")}>
              <div
                className={
                  "max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs whitespace-pre-wrap break-words " +
                  (m.direction === "out"
                    ? "bg-emerald-200/70 text-emerald-950"
                    : "bg-white border border-slate-200 text-slate-700")
                }
              >
                {m.body}
                <div className="text-[9px] opacity-50 text-right mt-0.5">{fmtTime(m.at)}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Responder */}
      <div className="border-t border-emerald-200 p-2 bg-white">
        {optedOut && (
          <div className="text-[10px] text-rose-600 mb-1">
            ⚠️ Este contacto pidió no recibir mensajes (opt-out). Responde solo si retomó él la conversación.
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Responder por WhatsApp… (Enter envía, Shift+Enter salto de línea)"
            className="flex-1 resize-none text-xs border rounded-md px-2 py-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-none max-h-24"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            title="Enviar por WhatsApp"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
