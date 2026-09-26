"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquareReply, MessagesSquare, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  MAX_THREAD_MESSAGES,
  renumberThreadScript,
  validateThreadScript,
  type SimulatedMessage
} from "@/lib/mobile/comment-thread";

export type ThreadTarget = { deviceSerial: string; phoneKey: string; label: string };

type TrackedJob = { id: string; deviceSerial: string; status: string; lastError?: string | null; text?: string | null };

const STATUS: Record<string, string> = {
  PENDING_APPROVAL: "Pendiente de aprobación",
  QUEUED: "Aprobado · esperando su turno",
  RUNNING: "Publicando",
  WAITING_USER: "Comprobar publicación",
  COMPLETED: "Publicado",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
  FAILED: "Necesita revisión"
};

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? "No se ha podido completar la operación");
  return payload;
}

export default function CommentThreadComposer({ targets, allowed, onOpen }: { targets: ThreadTarget[]; allowed: boolean; onOpen?: (serials: string[]) => void }) {
  const [postUrl, setPostUrl] = useState("");
  const [postContext, setPostContext] = useState("");
  const [guide, setGuide] = useState("");
  const [turns, setTurns] = useState(Math.min(8, Math.max(2, targets.length)));
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const [messages, setMessages] = useState<SimulatedMessage[] | null>(null);
  const [gapMinutes, setGapMinutes] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [jobs, setJobs] = useState<TrackedJob[] | null>(null);

  const participants = useMemo(() => targets
    .filter((target) => !excluded.includes(target.deviceSerial))
    .map((target) => ({ ...target, facts: (facts[target.deviceSerial] ?? "").trim() })), [targets, excluded, facts]);

  const ids = jobs?.map((job) => job.id).join(",") ?? "";
  useEffect(() => {
    if (!ids) return;
    let disposed = false;
    async function refresh() {
      try {
        const response = await fetch(`/api/v1/mobile/automations?jobIds=${encodeURIComponent(ids)}`, { cache: "no-store" });
        const data = await response.json();
        if (!disposed && response.ok) setJobs((current) => current?.map((job) => data.jobs.find((item: TrackedJob) => item.id === job.id) ?? job) ?? null);
      } catch { /* el siguiente ciclo lo reintenta */ }
    }
    const timer = window.setInterval(refresh, 10_000);
    void refresh();
    return () => { disposed = true; window.clearInterval(timer); };
  }, [ids]);

  async function simulate() {
    setBusy(true); setError(null);
    try {
      const payload = await postJson("/api/v1/mobile/automations/threads/simulate", { postUrl, postContext, guide, turns, participants });
      setPostUrl(payload.postUrl);
      setMessages(payload.messages);
    } catch (simulateError) {
      setError(simulateError instanceof Error ? simulateError.message : "No se pudo simular la conversación");
    } finally { setBusy(false); }
  }

  function updateMessage(order: number, patch: Partial<SimulatedMessage>) {
    setMessages((current) => current?.map((message) => message.order === order ? { ...message, ...patch } : message) ?? null);
  }

  function removeMessage(order: number) {
    setMessages((current) => current ? renumberThreadScript(current.filter((message) => message.order !== order)) : null);
  }

  async function sendToReview() {
    if (!messages) return;
    setBusy(true); setError(null);
    try {
      validateThreadScript(messages, participants.length);
      const payload = await postJson("/api/v1/mobile/automations/threads", { threadId, postUrl, guide, participants, messages, gapMinutes });
      setJobs(payload.jobs);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "No se pudo crear la conversación");
    } finally { setBusy(false); }
  }

  function reset() {
    setMessages(null); setJobs(null); setError(null); setThreadId(crypto.randomUUID());
  }

  if (jobs && messages) {
    return (
      <div className="space-y-3 rounded-xl border border-indigo-100 bg-white p-3 text-xs">
        <p className="font-semibold text-slate-800">Conversación enviada a revisión · {jobs.length} mensajes</p>
        <p className="text-slate-600">Cada mensaje está en la cola de su móvil, pendiente de aprobación. Se publicarán en orden: una respuesta solo sale cuando el comentario al que responde ya está publicado. Si se rechaza un comentario, sus respuestas se cancelan.</p>
        {jobs.map((job, index) => {
          const message = messages[index];
          const participant = message ? participants[message.participant] : undefined;
          return (
            <div key={job.id} className="rounded-lg border bg-slate-50 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">#{index + 1} · {participant?.label ?? job.deviceSerial}{message?.replyToOrder ? ` → responde a #${message.replyToOrder}` : ""}</span>
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">{STATUS[job.status] ?? job.status}</span>
              </div>
              {job.lastError && <p className="mt-1 text-rose-700">{job.lastError}</p>}
              <a className="mt-1 inline-block text-indigo-700 underline" href={`#mobile-device-${encodeURIComponent(job.deviceSerial)}`}>Revisar en la cola de este móvil</a>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          {onOpen && <button type="button" onClick={() => onOpen([...new Set(jobs.map((job) => job.deviceSerial))])} className="rounded-lg border px-3 py-2">Abrir pantallas de estos móviles</button>}
          <button type="button" onClick={reset} className="rounded-lg border px-3 py-2">Nueva conversación</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-indigo-100 bg-white p-3">
      <label className="block text-xs font-semibold text-slate-700">Publicación o anuncio de Facebook
        <input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://www.facebook.com/…" inputMode="url" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold text-slate-700">De qué trata la publicación (opcional)
        <input value={postContext} onChange={(event) => setPostContext(event.target.value)} maxLength={1000} placeholder="Ej. Artículo: las 10 franquicias más rentables de 2026" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" />
      </label>
      <label className="block text-xs font-semibold text-slate-700">Sobre qué deben escribir los comentarios y sus respuestas
        <textarea value={guide} onChange={(event) => setGuide(event.target.value)} rows={3} maxLength={2000} placeholder="Ej. Dudas sobre en qué franquicia invertir. Defender que las de alimentación/supermercado son las más estables, con la experiencia real de la familia. Alguien pregunta por ropa y se le comenta que es un nicho muy saturado." className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" />
      </label>
      <details className="rounded-lg border bg-slate-50 p-2 text-xs" open>
        <summary className="cursor-pointer font-semibold">Participantes · {participants.length} de {targets.length} · datos reales de cada persona</summary>
        <p className="mt-1 text-slate-500">{messages ? "Para cambiar los participantes, vuelve a empezar la simulación. " : ""}La IA solo usará estos datos. Si una persona no tiene datos, preguntará u opinará sin inventar experiencias.</p>
        <div className="mt-2 space-y-2">
          {targets.map((target) => (
            <div key={target.deviceSerial} className="rounded-lg border bg-white p-2">
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={!excluded.includes(target.deviceSerial)} disabled={Boolean(messages)} onChange={(event) => setExcluded((current) => event.target.checked ? current.filter((serial) => serial !== target.deviceSerial) : [...current, target.deviceSerial])} />
                {target.label}
              </label>
              {!excluded.includes(target.deviceSerial) && <textarea value={facts[target.deviceSerial] ?? ""} onChange={(event) => setFacts((current) => ({ ...current, [target.deviceSerial]: event.target.value }))} rows={2} maxLength={1500} placeholder="Ej. Su hermano tiene dos supermercados franquiciados desde 2019 y abrió el segundo en 2023." className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" />}
            </div>
          ))}
        </div>
      </details>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">Número de mensajes
          <input type="number" min={2} max={MAX_THREAD_MESSAGES} value={turns} onChange={(event) => setTurns(Number(event.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-700">Minutos entre mensajes
          <input type="number" min={1} max={240} value={gapMinutes} onChange={(event) => setGapMinutes(Number(event.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
        </label>
      </div>
      <button type="button" onClick={() => void simulate()} disabled={busy || !allowed || participants.length < 2 || !postUrl.trim() || guide.trim().length < 10} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy && !messages ? <Loader2 className="h-4 w-4 animate-spin" /> : messages ? <RefreshCw className="h-4 w-4" /> : <MessagesSquare className="h-4 w-4" />}
        {messages ? "Volver a simular" : "Simular conversación"}
      </button>

      {messages && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">Simulación · edita, reasigna o elimina mensajes antes de enviarlos a revisión</p>
          {messages.map((message) => {
            const parent = message.replyToOrder ? messages[message.replyToOrder - 1] : null;
            return (
              <div key={message.order} className={`rounded-lg border p-2 text-xs ${parent ? "ml-6 border-indigo-100 bg-indigo-50/50" : "bg-white"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">#{message.order}</span>
                  <select value={message.participant} onChange={(event) => updateMessage(message.order, { participant: Number(event.target.value) })} className="rounded border bg-white px-1.5 py-1">
                    {participants.map((participant, index) => <option key={participant.deviceSerial} value={index}>{participant.label}</option>)}
                  </select>
                  <span className="inline-flex items-center gap-1 text-slate-500">{parent ? <><MessageSquareReply className="h-3.5 w-3.5" /> responde a #{parent.order} ({participants[parent.participant]?.label})</> : "Comentario nuevo"}</span>
                  <button type="button" onClick={() => removeMessage(message.order)} className="ml-auto inline-flex items-center gap-1 text-rose-700"><Trash2 className="h-3.5 w-3.5" /> Quitar</button>
                </div>
                <textarea value={message.text} onChange={(event) => updateMessage(message.order, { text: event.target.value })} rows={2} maxLength={1200} className="mt-1 w-full rounded border bg-white px-2 py-1.5" />
              </div>
            );
          })}
          <button type="button" onClick={() => void sendToReview()} disabled={busy || !allowed || messages.length < 2} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar a revisión de cada cuenta ({messages.length} mensajes)
          </button>
          <p className="text-[11px] text-slate-500">Nada se publica todavía: cada mensaje queda pendiente de aprobación en la cola de su móvil.</p>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-rose-100 px-3 py-2 text-xs text-rose-800">{error}</p>}
    </div>
  );
}
