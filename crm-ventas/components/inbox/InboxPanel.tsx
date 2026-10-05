"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Hand,
  KanbanSquare,
  Loader2,
  MailWarning,
  MessageCirclePlus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useAgentName } from "@/components/AgentNameContext";
import PhonesModal from "@/components/inbox/PhonesModal";
import {
  Avatar,
  AI_MODE_LABEL,
  displayName as niceName,
  formatPhone,
  jsonFetch,
  lineStatusText,
  randomKey,
  relativeTime,
  StatusDot,
  type LineSummary,
} from "@/components/inbox/ui";

type Column = { id: string; label: string; color: string; order: number };

type ConversationItem = {
  id: string;
  phone: string;
  lineId: string | null;
  unread: number;
  lastMessageAt: string;
  lastPreview: string | null;
  lastDirection: string | null;
  aiStatus: string;
  hasDraft: boolean;
  optedOut: boolean;
  archived: boolean;
  humanActive: boolean;
  contact: { id: string; name: string; stage: string; phone: string | null } | null;
};

type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  body: string;
  createdAt: string;
  meta: any;
  lineId: string | null;
  ack: number | null;
};

type Pending = {
  id: string;
  body: string;
  status: string;
  scheduledAt: string;
  lastError: string | null;
  origin: string;
};

type Thread = {
  conversation: {
    id: string;
    phone: string;
    lineId: string | null;
    optedOut: boolean;
    archived: boolean;
    aiStatus: string;
    aiError: string | null;
    aiDraft: string | null;
    aiDraftCurrent: boolean;
    humanUntil: string | null;
    lastInboundAt: string | null;
  };
  contact: { id: string; name: string; phone: string | null; stage: string; notes: string | null } | null;
  line: { id: string; label: string; phone: string | null; aiMode: string; active: boolean; lastStatus: string | null } | null;
  messages: ThreadMessage[];
  outbound: Pending[];
};

const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "unread", label: "Sin leer" },
  { id: "pending", label: "Por responder" },
  { id: "drafts", label: "Con propuesta" },
  { id: "optout", label: "Bajas" },
  { id: "archived", label: "Archivadas" },
];

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoy";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function errorText(data: any, fallback: string) {
  return typeof data?.error === "string" ? data.error : fallback;
}

function Ticks({ ack }: { ack: number | null }) {
  if (ack === -1) return <AlertTriangle size={12} className="text-red-200" aria-label="Error de entrega" />;
  if (ack !== null && ack >= 3) return <CheckCheck size={13} className="text-sky-200" aria-label="Leído" />;
  if (ack === 2) return <CheckCheck size={13} aria-label="Entregado" />;
  return <Check size={13} aria-label="Enviado" />;
}

export default function InboxPanel({
  columns = [],
  openContactId = null,
  openRequestKey = 0,
  onOpenBoard,
  heightClass = "h-[calc(100dvh-10.5rem)] md:h-[calc(100vh-3rem)]",
  title = "WhatsApp",
  hideTitleOnMobile = false,
  onUnreadChange,
}: {
  columns?: Column[];
  openContactId?: string | null;
  openRequestKey?: number;
  onOpenBoard?: () => void;
  heightClass?: string;
  title?: string;
  hideTitleOnMobile?: boolean;
  onUnreadChange?: (unreadChats: number) => void;
}) {
  const agentName = useAgentName();
  const [lines, setLines] = useState<LineSummary[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [lineFilter, setLineFilter] = useState("all");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error" | "ok"; text: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [phonesOpen, setPhonesOpen] = useState(false);
  const [newChat, setNewChat] = useState<{ contactId?: string; name: string; phone: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageCount = useRef(0);
  const sendKey = useRef<{ text: string; key: string } | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [newChatLine, setNewChatLine] = useState<string>("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ line: lineFilter, filter });
    if (debouncedQuery) params.set("q", debouncedQuery);
    const { ok, data } = await jsonFetch(`/api/v1/inbox/conversations?${params}`);
    if (ok) {
      setConversations(data.conversations ?? []);
      setLines(data.lines ?? []);
    }
    setListLoaded(true);
  }, [lineFilter, filter, debouncedQuery]);

  const loadThread = useCallback(async (id: string) => {
    const { ok, data } = await jsonFetch<Thread>(`/api/v1/inbox/conversations/${id}`);
    if (ok) {
      setThread(data);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    }
  }, []);

  useEffect(() => {
    void loadList();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadList();
    }, 6000);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    setThread(null);
    lastMessageCount.current = 0;
    void loadThread(selectedId);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadThread(selectedId);
    }, 4000);
    return () => clearInterval(t);
  }, [selectedId, loadThread]);

  // Abrir un chat desde una tarjeta del pipeline.
  useEffect(() => {
    if (!openContactId) return;
    let cancelled = false;
    (async () => {
      const { ok, data } = await jsonFetch(`/api/v1/inbox/lookup?contactId=${encodeURIComponent(openContactId)}`);
      if (cancelled || !ok) return;
      if (data.conversationId) {
        setNewChat(null);
        setSelectedId(data.conversationId);
      } else {
        setSelectedId(null);
        setNewChat({ contactId: data.contact?.id, name: data.contact?.name ?? "", phone: data.contact?.phone ?? "" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openContactId, openRequestKey]);

  useEffect(() => {
    const count = thread?.messages.length ?? 0;
    if (count !== lastMessageCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: lastMessageCount.current ? "smooth" : "auto" });
      lastMessageCount.current = count;
    }
  }, [thread?.messages.length]);

  useEffect(() => {
    setText("");
    setNotice(null);
  }, [selectedId]);

  const linesById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const multiLine = lines.length > 1;
  const unreadTotal = lines.reduce((sum, l) => sum + l.unreadChats, 0);
  useEffect(() => {
    if (listLoaded) onUnreadChange?.(unreadTotal);
  }, [unreadTotal, listLoaded, onUnreadChange]);
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const displayName = niceName(
    thread?.contact?.name ?? selected?.contact?.name,
    thread?.contact?.phone ?? thread?.conversation.phone ?? selected?.phone
  );

  async function send(body: string) {
    if (!selectedId || !body.trim() || sending) return;
    setSending(true);
    setNotice(null);
    // Misma clave mientras el texto no cambie: un reintento de red no duplica.
    if (!sendKey.current || sendKey.current.text !== body.trim()) sendKey.current = { text: body.trim(), key: randomKey() };
    const { ok, data } = await jsonFetch(`/api/v1/inbox/conversations/${selectedId}/send`, {
      method: "POST",
      body: JSON.stringify({ text: body.trim(), idempotencyKey: sendKey.current.key }),
    });
    setSending(false);
    if (ok) sendKey.current = null;
    if (!ok) {
      setNotice({ tone: "error", text: errorText(data, "No se pudo enviar") });
      await loadThread(selectedId);
      return;
    }
    setText("");
    const status = data.outbound?.status;
    if (status === "sent") setNotice(null);
    else if (status === "queued") {
      const at = data.outbound?.scheduledAt ? hhmm(data.outbound.scheduledAt) : "";
      const why = data.result?.message ? ` ${data.result.message}` : "";
      setNotice({ tone: "info", text: `Programado para las ${at} (ritmo anti-baneo).${why}` });
    } else if (status === "failed") {
      setNotice({ tone: "error", text: data.outbound?.lastError ?? "WhatsApp no aceptó el mensaje" });
    }
    await Promise.all([loadThread(selectedId), loadList()]);
  }

  async function startNewChat(e: React.FormEvent) {
    e.preventDefault();
    if (!newChat || !text.trim()) return;
    const line = lines.find((l) => l.id === newChatLine) ?? lines.find((l) => l.isPrimary) ?? lines[0];
    if (!line) {
      setNotice({ tone: "error", text: "No hay ningún número de WhatsApp conectado" });
      return;
    }
    setSending(true);
    const { ok, status, data } = await jsonFetch(`/api/v1/inbox/conversations`, {
      method: "POST",
      body: JSON.stringify({ phone: newChat.phone, name: newChat.name, lineId: line.id, text: text.trim(), idempotencyKey: randomKey() }),
    });
    setSending(false);
    if (!ok) {
      setNotice({
        tone: "error",
        text: status === 422 ? errorText(data, "Bloqueado por seguridad") : errorText(data, "No se pudo iniciar el chat"),
      });
      if (data?.conversationId) setSelectedId(data.conversationId);
      return;
    }
    setText("");
    setNewChat(null);
    setSelectedId(data.conversationId);
    void loadList();
  }

  async function regenerate() {
    if (!selectedId) return;
    setDrafting(true);
    const { ok, data } = await jsonFetch(`/api/v1/inbox/conversations/${selectedId}/draft`, { method: "POST" });
    setDrafting(false);
    if (!ok) setNotice({ tone: "error", text: errorText(data, "La IA no está disponible ahora mismo") });
    await loadThread(selectedId);
  }

  async function discardDraft() {
    if (!selectedId) return;
    await jsonFetch(`/api/v1/inbox/conversations/${selectedId}/draft`, { method: "DELETE" });
    await loadThread(selectedId);
  }

  async function patchConversation(body: Record<string, unknown>) {
    if (!selectedId) return;
    const { ok, data } = await jsonFetch(`/api/v1/inbox/conversations/${selectedId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!ok) setNotice({ tone: "error", text: errorText(data, "No se pudo actualizar") });
    await Promise.all([loadThread(selectedId), loadList()]);
  }

  async function outboundAction(id: string, method: "POST" | "DELETE") {
    if (retrying) return;
    if (method === "POST" && !confirm("¿Reintentar el envío? Si el aviso dice que puede haber llegado, revisa antes el chat en el móvil.")) return;
    setRetrying(id);
    const { ok, data } = await jsonFetch(`/api/v1/inbox/outbound/${id}`, { method });
    setRetrying(null);
    if (!ok) setNotice({ tone: "error", text: errorText(data, "No se pudo completar") });
    if (selectedId) await loadThread(selectedId);
  }

  async function changeStage(stage: string) {
    if (!thread?.contact) return;
    await jsonFetch(`/api/v1/contacts/${thread.contact.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    await loadThread(thread.conversation.id);
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (!coarse && !e.shiftKey))) {
      e.preventDefault();
      if (newChat) {
        void startNewChat(e as unknown as React.FormEvent);
      } else void send(text);
    }
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const conv = thread?.conversation;
  const line = thread?.line ?? (selected?.lineId ? linesById.get(selected.lineId) ?? null : null);
  const aiBusy = conv && (conv.aiStatus === "pending" || conv.aiStatus === "generating");
  const draft = conv?.aiDraft && conv.aiDraftCurrent ? conv.aiDraft : null;
  const lastMessage = thread?.messages[thread.messages.length - 1];
  const waitingReply = lastMessage?.direction === "in" && !thread?.outbound.some((o) => o.status === "queued" || o.status === "sending");
  const showChat = Boolean(selectedId) || Boolean(newChat);

  return (
    <div className={clsx("flex min-h-[28rem] flex-col", heightClass)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className={clsx("min-w-0 items-center gap-2", hideTitleOnMobile ? "hidden md:flex" : "flex")}>
          <h1 className="truncate text-lg font-semibold sm:text-xl">{title}</h1>
          {unreadTotal > 0 && (
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white">{unreadTotal}</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-ghost" onClick={() => void loadList()} title="Recargar" aria-label="Recargar">
            <RefreshCw size={15} />
          </button>
          <button className="btn border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" onClick={() => setPhonesOpen(true)}>
            <Smartphone size={15} />
            <span className="hidden sm:inline">Teléfonos</span>
            {lines.length > 0 && <span className="text-slate-500">{lines.length}</span>}
          </button>
        </div>
      </div>

      <div className="card flex min-h-0 flex-1 overflow-hidden">
        {/* ------- Lista de conversaciones ------- */}
        <aside className={clsx("flex w-full shrink-0 flex-col md:w-80 md:border-r md:border-slate-200 lg:w-96", showChat && "hidden md:flex")}>
          <div className="space-y-2 border-b border-slate-100 p-3">
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              <button
                onClick={() => setLineFilter("all")}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                  lineFilter === "all" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                Todos los números
              </button>
              {lines.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLineFilter(l.id)}
                  title={`${lineStatusText(l)} · IA: ${AI_MODE_LABEL[l.aiMode] ?? l.aiMode}`}
                  className={clsx(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                    lineFilter === l.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <StatusDot status={l.lastStatus} paused={l.paused} active={l.active} />
                  {l.label}
                  {l.unreadChats > 0 && (
                    <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">{l.unreadChats}</span>
                  )}
                </button>
              ))}
            </div>
            <label className="relative block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input !pl-8"
                placeholder="Buscar nombre, teléfono o texto"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={clsx(
                    "shrink-0 rounded-md px-2 py-1 text-xs",
                    filter === f.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {listLoaded && lines.length === 0 && (
              <div className="m-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                Aún no hay ningún WhatsApp conectado.{" "}
                <button className="font-semibold underline" onClick={() => setPhonesOpen(true)}>
                  Conectar un número
                </button>
              </div>
            )}
            {listLoaded && lines.length > 0 && conversations.length === 0 && (
              <p className="p-4 text-sm text-slate-500">
                {filter === "all" && !debouncedQuery
                  ? "Cuando alguien escriba a cualquiera de tus números aparecerá aquí."
                  : "No hay conversaciones con este filtro."}
              </p>
            )}
            {conversations.map((c) => {
              const name = niceName(c.contact?.name, c.contact?.phone ?? c.phone);
              const l = c.lineId ? linesById.get(c.lineId) : undefined;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setNewChat(null);
                    setSelectedId(c.id);
                  }}
                  className={clsx(
                    "flex w-full gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50",
                    selectedId === c.id && "bg-brand-50/70 hover:bg-brand-50"
                  )}
                >
                  <Avatar name={name} seed={c.phone} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={clsx("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{name}</span>
                      <span className={clsx("shrink-0 text-[11px]", c.unread ? "font-semibold text-emerald-600" : "text-slate-400")}>
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className={clsx("min-w-0 flex-1 truncate text-xs", c.unread ? "text-slate-700" : "text-slate-500")}>
                        {c.lastPreview ? (
                          <>
                            {c.lastDirection === "out" ? "Tú: " : ""}
                            {c.lastPreview}
                          </>
                        ) : (
                          <span className="italic text-slate-400">Primer mensaje en cola</span>
                        )}
                      </span>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">
                          {c.unread}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      {multiLine && l && (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          <StatusDot status={l.lastStatus} paused={l.paused} active={l.active} className="h-1.5 w-1.5" />
                          {l.label}
                        </span>
                      )}
                      {c.hasDraft && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                          <Sparkles size={10} /> Propuesta lista
                        </span>
                      )}
                      {(c.aiStatus === "pending" || c.aiStatus === "generating") && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
                          <Loader2 size={10} className="animate-spin" /> {agentName} pensando
                        </span>
                      )}
                      {c.humanActive && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                          <Hand size={10} /> Lo lleva una persona
                        </span>
                      )}
                      {c.optedOut && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                          <Ban size={10} /> Baja
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ------- Conversación ------- */}
        <section className={clsx("min-w-0 flex-1 flex-col", showChat ? "flex" : "hidden md:flex")}>
          {!showChat && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
              <ShieldCheck size={28} className="text-slate-300" />
              <p>Selecciona una conversación.</p>
              <p className="max-w-xs text-xs">
                Todos tus números en un solo sitio. Cada respuesta sale por el número al que escribió el cliente, con ritmo humano y
                protección anti-baneo.
              </p>
            </div>
          )}

          {newChat && (
            <>
              <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3">
                <button
                  type="button"
                  onClick={() => setNewChat(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
                  aria-label="Volver"
                >
                  <ArrowLeft size={18} />
                </button>
                <MessageCirclePlus size={18} className="text-brand-600" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">Nuevo chat · {newChat.name || formatPhone(newChat.phone)}</div>
                  <div className="truncate text-xs text-slate-500">{formatPhone(newChat.phone) || "Sin teléfono"}</div>
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4 text-sm text-slate-600">
                <p>Este contacto todavía no te ha escrito por WhatsApp.</p>
                <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
                  Escribir a alguien que no te ha escrito es lo que más baneos provoca. Solo se permite en números con «Conversaciones
                  nuevas/día» activado (Teléfonos → Avanzado), con calentamiento, sin enlaces en el primer mensaje y en horario comercial.
                </p>
              </div>
              <form onSubmit={startNewChat} className="border-t border-slate-200 p-3">
                <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
                  Enviar desde
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                    value={newChatLine || lines.find((l) => l.isPrimary)?.id || lines[0]?.id || ""}
                    onChange={(e) => setNewChatLine(e.target.value)}
                  >
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                        {l.phone ? ` · ${formatPhone(l.phone)}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    className="input max-h-44 min-h-10 resize-none"
                    rows={1}
                    placeholder={newChat.phone ? "Escribe el primer mensaje…" : "Este contacto no tiene teléfono"}
                    value={text}
                    disabled={!newChat.phone}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onComposerKey}
                  />
                  <button className="btn-primary h-10 w-10 shrink-0 px-0" disabled={sending || !text.trim() || !newChat.phone} aria-label="Enviar">
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
                {notice && <p className={clsx("mt-2 text-xs", notice.tone === "error" ? "text-red-600" : "text-slate-600")}>{notice.text}</p>}
              </form>
            </>
          )}

          {selectedId && !newChat && (
            <>
              <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-4">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
                  aria-label="Volver a conversaciones"
                >
                  <ArrowLeft size={18} />
                </button>
                <Avatar name={displayName} seed={thread?.conversation.phone ?? selectedId} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{displayName}</div>
                  <div className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                    {!line && conv?.lineId && <span className="text-amber-700">El número de este chat ya no está en la bandeja</span>}
                    {line && (
                      <>
                        <StatusDot status={line.lastStatus} active={line.active} className="h-1.5 w-1.5" />
                        <span className="truncate">
                          vía {line.label}
                          {line.phone ? ` · ${formatPhone(line.phone)}` : ""}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {thread?.contact && columns.length > 0 && (
                    <select
                      className="hidden rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 sm:block"
                      value={thread.contact.stage}
                      onChange={(e) => void changeStage(e.target.value)}
                      title="Columna del pipeline"
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {onOpenBoard && (
                    <button className="btn-ghost h-9 px-2" onClick={onOpenBoard} title="Ver tablero" aria-label="Ver tablero">
                      <KanbanSquare size={16} />
                    </button>
                  )}
                  {conv && (
                    <button
                      className="btn-ghost h-9 px-2"
                      onClick={() => void patchConversation({ archived: !conv.archived })}
                      title={conv.archived ? "Desarchivar" : "Archivar"}
                      aria-label={conv.archived ? "Desarchivar" : "Archivar"}
                    >
                      {conv.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                    </button>
                  )}
                  {conv && (
                    <button
                      className="btn-ghost h-9 px-2"
                      onClick={() => void patchConversation({ unread: true })}
                      title="Marcar como no leído"
                      aria-label="Marcar como no leído"
                    >
                      <MailWarning size={16} />
                    </button>
                  )}
                </div>
              </div>

              {conv && (conv.optedOut || line?.aiMode === "auto") && (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs sm:px-4">
                  {conv.optedOut ? (
                    <>
                      <Ban size={13} className="text-red-600" />
                      <span className="text-red-700">Este cliente pidió la baja: no se le enviará nada salvo que vuelva a escribir.</span>
                      <button
                        className="ml-auto font-medium text-slate-600 underline"
                        onClick={() => {
                          if (confirm("¿Seguro que este cliente quiere volver a recibir mensajes? Escribir a quien pidió la baja puede provocar denuncias y bloqueos del número.")) {
                            void patchConversation({ optedOut: false });
                          }
                        }}
                      >
                        Quitar baja
                      </button>
                    </>
                  ) : conv.humanUntil ? (
                    <>
                      <Hand size={13} className="text-sky-600" />
                      <span className="text-slate-600">
                        Lo lleva una persona: {agentName} no responde sola en este chat hasta las {hhmm(conv.humanUntil)}
                        {new Date(conv.humanUntil).toDateString() !== new Date().toDateString() ? ` del ${new Date(conv.humanUntil).toLocaleDateString("es-ES")}` : ""}.
                      </span>
                      <button className="ml-auto font-medium text-brand-700 underline" onClick={() => void patchConversation({ aiPaused: false })}>
                        Devolver a {agentName}
                      </button>
                    </>
                  ) : (
                    <>
                      <Bot size={13} className="text-violet-600" />
                      <span className="text-slate-600">{agentName} responde sola en este número.</span>
                      <button className="ml-auto font-medium text-slate-700 underline" onClick={() => void patchConversation({ aiPaused: true })}>
                        Tomar el control
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-slate-50/60 p-3 sm:p-4">
                {!thread && (
                  <div className="flex justify-center p-6 text-slate-400">
                    <Loader2 className="animate-spin" size={18} />
                  </div>
                )}
                {thread?.messages.map((m, i) => {
                  const prev = thread.messages[i - 1];
                  const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                  const lineChanged = multiLine && prev && prev.lineId !== m.lineId && m.lineId;
                  const out = m.direction === "out";
                  const origin = m.meta?.sonia ? "ai" : m.meta?.fromPhone ? (m.meta?.apiSent ? "api" : "phone") : "manual";
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div className="my-3 flex justify-center">
                          <span className="rounded-full bg-white px-3 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm">{dayLabel(m.createdAt)}</span>
                        </div>
                      )}
                      {lineChanged && (
                        <div className="my-2 text-center text-[11px] text-slate-400">— por {linesById.get(m.lineId!)?.label ?? "otro número"} —</div>
                      )}
                      <div className={clsx("flex", out ? "justify-end" : "justify-start")}>
                        <div
                          className={clsx(
                            "max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[72%]",
                            out ? "rounded-br-md bg-brand-500 text-white" : "rounded-bl-md bg-white text-slate-800"
                          )}
                        >
                          {out && origin === "ai" && (
                            <span className="mb-0.5 flex items-center gap-1 text-[11px] font-medium opacity-80">
                              <Bot size={11} /> {agentName}
                            </span>
                          )}
                          {out && origin === "phone" && (
                            <span className="mb-0.5 flex items-center gap-1 text-[11px] font-medium opacity-80">
                              <Smartphone size={11} /> Desde el móvil
                            </span>
                          )}
                          {m.body}
                          <span className={clsx("mt-0.5 flex items-center justify-end gap-1 text-[10px]", out ? "text-white/70" : "text-slate-400")}>
                            {hhmm(m.createdAt)}
                            {out && <Ticks ack={m.ack} />}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {thread?.outbound.map((o) => (
                  <div key={o.id} className="flex justify-end">
                    <div
                      className={clsx(
                        "max-w-[88%] rounded-2xl rounded-br-md border px-3 py-2 text-sm sm:max-w-[72%]",
                        o.status === "failed" || o.status === "blocked"
                          ? "border-red-200 bg-red-50 text-red-900"
                          : "border-dashed border-brand-300 bg-brand-50 text-slate-800"
                      )}
                    >
                      <span className="mb-1 flex items-center gap-1 text-[11px] font-medium">
                        {o.status === "sending" ? (
                          <>
                            <Loader2 size={11} className="animate-spin" /> Escribiendo…
                          </>
                        ) : o.status === "queued" ? (
                          <>
                            <Clock size={11} /> {o.origin === "auto" ? `${agentName} responde` : "Programado"} a las {hhmm(o.scheduledAt)}
                          </>
                        ) : (
                          <>
                            <AlertTriangle size={11} /> {o.status === "blocked" ? "Bloqueado por seguridad" : "No enviado"}
                          </>
                        )}
                      </span>
                      <span className="whitespace-pre-wrap break-words">{o.body}</span>
                      {o.lastError && (
                        <span className="mt-1 block text-[11px] opacity-80">{o.lastError.replace(/^[A-Z_]+: /, "")}</span>
                      )}
                      <span className="mt-1.5 flex justify-end gap-3 text-[11px] font-medium">
                        {(o.status === "failed" || o.status === "blocked") && (
                          <button className="underline disabled:opacity-50" disabled={retrying === o.id} onClick={() => void outboundAction(o.id, "POST")}>
                            {retrying === o.id ? "Reintentando…" : "Reintentar"}
                          </button>
                        )}
                        {o.status !== "sending" && (
                          <button className="underline" onClick={() => void outboundAction(o.id, "DELETE")}>
                            {o.status === "queued" ? "Cancelar" : "Descartar"}
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* ------- Propuesta de la IA ------- */}
              {conv && !conv.optedOut && line?.aiMode !== "off" && (aiBusy || drafting || draft || waitingReply) && (
                <div className="border-t border-violet-100 bg-violet-50/60 px-3 py-2.5 sm:px-4">
                  {aiBusy || drafting ? (
                    <p className="flex items-center gap-2 text-xs text-violet-800">
                      <Loader2 size={13} className="animate-spin" />
                      {agentName} está preparando {line?.aiMode === "auto" && !conv.humanUntil ? "la respuesta" : "una propuesta"}…
                    </p>
                  ) : draft ? (
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                        <Sparkles size={12} /> Propuesta de {agentName}
                      </div>
                      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-slate-800">{draft}</p>
                      {conv.aiError && <p className="mt-1 text-[11px] text-amber-700">{conv.aiError}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 bg-violet-600 px-3 text-xs text-white hover:bg-violet-700" disabled={sending} onClick={() => void send(draft)}>
                          <Send size={13} /> Enviar tal cual
                        </button>
                        <button
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 border border-violet-200 bg-white px-3 text-xs text-violet-700 hover:bg-violet-50"
                          onClick={() => {
                            setText(draft);
                            textareaRef.current?.focus();
                          }}
                        >
                          Editar
                        </button>
                        <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 px-2 text-xs text-violet-700 hover:bg-violet-100" onClick={() => void regenerate()}>
                          <RefreshCw size={12} /> Otra
                        </button>
                        <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 px-2 text-xs text-slate-500 hover:bg-violet-100" onClick={() => void discardDraft()} aria-label="Descartar propuesta">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-violet-800">
                      {conv.aiError && <span className="text-amber-700">{conv.aiError}.</span>}
                      <button className="inline-flex items-center gap-1 font-semibold underline" onClick={() => void regenerate()}>
                        <Sparkles size={12} /> Proponer respuesta con IA
                      </button>
                    </div>
                  )}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(text);
                }}
                className="border-t border-slate-200 p-3"
              >
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    className="input max-h-44 min-h-10 resize-none"
                    rows={1}
                    placeholder={conv?.optedOut ? "Cliente dado de baja" : "Escribe una respuesta…"}
                    value={text}
                    disabled={conv?.optedOut}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onComposerKey}
                  />
                  {text && draft && text !== draft && (
                    <button type="button" className="btn-ghost h-10 w-10 shrink-0 px-0" onClick={() => setText("")} title="Vaciar" aria-label="Vaciar">
                      <Undo2 size={15} />
                    </button>
                  )}
                  <button className="btn-primary h-10 w-10 shrink-0 px-0" disabled={sending || !text.trim() || conv?.optedOut} aria-label="Enviar">
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
                {notice ? (
                  <p className={clsx("mt-2 text-xs", notice.tone === "error" ? "text-red-600" : notice.tone === "ok" ? "text-emerald-700" : "text-slate-600")}>
                    {notice.text}
                  </p>
                ) : (
                  line && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
                      <ShieldCheck size={11} />
                      Sale por {line.label}
                      {line.phone ? ` (${formatPhone(line.phone)})` : ""} · con «escribiendo…» y ritmo anti-baneo
                    </p>
                  )
                )}
              </form>
            </>
          )}
        </section>
      </div>

      {phonesOpen && (
        <PhonesModal
          onClose={() => {
            setPhonesOpen(false);
            void loadList();
          }}
        />
      )}
    </div>
  );
}
