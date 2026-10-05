"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isStoppedThreadBranch } from "@/lib/mobile/thread-dependencies";
import { Loader2, MessageSquareReply, MessagesSquare, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  MAX_THREAD_MESSAGES,
  renumberThreadScript,
  validateThreadScript,
  type SimulatedMessage
} from "@/lib/mobile/comment-thread";

/** Minutos sin avances tras los que la conversación se reactiva sola. */
const AUTO_RESUME_AFTER_MS = 10 * 60 * 1000;

export type ThreadTarget = { deviceSerial: string; phoneKey: string; label: string };

type TrackedJob = { id: string; deviceSerial: string; status: string; lastError?: string | null; text?: string | null; completedAt?: string | null; waiting?: string | null; commentUrl?: string | null; engagement?: { checkedAt: string; visible: boolean; reactions: number | null; replies: number | null } | null };
type TrackedMeta = { order: number; replyToOrder: number | null; author: string };
type ThreadSummary = { threadId: string; guide: string; postUrl: string; createdAt: string; active: boolean; client?: string | null; jobs: Array<TrackedJob & TrackedMeta & { replyToAuthor?: string | null; completedAt?: string | null }> };

function formatDate(value?: string | null): string {
  if (!value) return "";
  try { return new Date(value).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return value; }
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Exporta el histórico (una fila por mensaje) a CSV compatible con Excel en español. */
function downloadHistoryCsv(threads: ThreadSummary[]) {
  const header = ["Cliente", "Fecha conversación", "Publicación", "Tema", "Nº", "Cuenta", "Responde a", "Texto", "Estado", "Publicado el", "Enlace del comentario", "Visible", "Reacciones", "Respuestas", "Comprobado el"];
  const rows = threads.flatMap((thread) => thread.jobs.map((job) => [
    thread.client ?? "", formatDate(thread.createdAt), thread.postUrl, thread.guide, job.order, job.author,
    job.replyToOrder ? `#${job.replyToOrder} ${job.replyToAuthor ?? ""}` : "", job.text ?? "", STATUS[job.status] ?? job.status, formatDate(job.completedAt),
    job.commentUrl ?? "", job.engagement ? (job.engagement.visible ? "Sí" : "No") : "", job.engagement?.reactions ?? "", job.engagement?.replies ?? "", formatDate(job.engagement?.checkedAt)
  ]));
  const csv = "\ufeff" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `historico-conversaciones-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

/** Informe imprimible (Guardar como PDF) de las conversaciones de un cliente. */
function openClientReport(threads: ThreadSummary[], client: string, from: string, to: string) {
  const messages = threads.flatMap((thread) => thread.jobs);
  const published = messages.filter((job) => job.status === "COMPLETED");
  const checked = published.filter((job) => job.engagement);
  const visible = checked.filter((job) => job.engagement?.visible).length;
  const reactions = checked.reduce((sum, job) => sum + (job.engagement?.reactions ?? 0), 0);
  const replies = checked.reduce((sum, job) => sum + (job.engagement?.replies ?? 0), 0);
  const period = [from && `desde ${new Date(from).toLocaleDateString("es-ES")}`, to && `hasta ${new Date(to).toLocaleDateString("es-ES")}`].filter(Boolean).join(" ") || "todo el periodo";
  const body = threads.map((thread) => `
    <section><h2>${escapeHtml(formatDate(thread.createdAt))} · ${escapeHtml(thread.guide.slice(0, 140))}</h2>
    <p><a href="${escapeHtml(thread.postUrl)}">${escapeHtml(thread.postUrl)}</a></p>
    <table><thead><tr><th>Nº</th><th>Cuenta</th><th>Mensaje</th><th>Estado</th><th>Publicado</th><th>Seguimiento</th></tr></thead><tbody>
    ${thread.jobs.map((job) => `<tr><td>#${job.order}${job.replyToOrder ? ` → #${job.replyToOrder}` : ""}</td><td>${escapeHtml(job.author)}</td><td>${escapeHtml(job.text)}${job.commentUrl ? `<br><a href="${escapeHtml(job.commentUrl)}">Ver comentario</a>` : ""}</td><td>${escapeHtml(STATUS[job.status] ?? job.status)}</td><td>${escapeHtml(formatDate(job.completedAt))}</td><td>${job.engagement ? `${job.engagement.visible ? "Visible" : "No visible"}${job.engagement.reactions !== null ? ` · ${job.engagement.reactions} reacciones` : ""}${job.engagement.replies !== null ? ` · ${job.engagement.replies} respuestas` : ""}` : "Sin comprobar"}</td></tr>`).join("")}
    </tbody></table></section>`).join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe ${escapeHtml(client || "conversaciones")}</title>
  <style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;margin:32px;font-size:12px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:24px 0 4px}
  .kpis{display:flex;gap:12px;margin:16px 0}.kpi{border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:18px}
  table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}a{color:#4338ca}
  @media print{button{display:none}a{color:#0f172a}}</style></head><body>
  <button onclick="window.print()" style="float:right;padding:6px 12px">Guardar como PDF</button>
  <h1>Informe de conversaciones · ${escapeHtml(client || "Todos los clientes")}</h1><p>Periodo: ${escapeHtml(period)} · Generado el ${escapeHtml(new Date().toLocaleString("es-ES"))}</p>
  <div class="kpis"><div class="kpi"><b>${threads.length}</b>conversaciones</div><div class="kpi"><b>${published.length}/${messages.length}</b>mensajes publicados</div>
  <div class="kpi"><b>${checked.length ? `${visible}/${checked.length}` : "—"}</b>siguen visibles</div><div class="kpi"><b>${checked.length ? reactions : "—"}</b>reacciones</div><div class="kpi"><b>${checked.length ? replies : "—"}</b>respuestas</div></div>
  ${body || "<p>No hay conversaciones en este periodo.</p>"}</body></html>`;
  const win = window.open("", "_blank");
  if (!win) { alert("El navegador ha bloqueado la ventana del informe. Permite las ventanas emergentes para este sitio."); return; }
  win.document.open(); win.document.write(html); win.document.close();
}

function ThreadHistory({ threads, onTrack, onCheck }: { threads: ThreadSummary[]; onTrack: (thread: ThreadSummary) => void; onCheck: (thread: ThreadSummary) => Promise<string> }) {
  const [query, setQuery] = useState("");
  const [client, setClient] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const clients = [...new Set(threads.map((thread) => thread.client).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es"));
  const filtered = threads.filter((thread) => {
    if (client && (thread.client ?? "") !== client) return false;
    if (from && new Date(thread.createdAt) < new Date(`${from}T00:00:00`)) return false;
    if (to && new Date(thread.createdAt) > new Date(`${to}T23:59:59`)) return false;
    return !query.trim() || `${thread.client ?? ""} ${thread.guide} ${thread.postUrl} ${thread.jobs.map((job) => `${job.author} ${job.text ?? ""}`).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  if (!threads.length) return null;
  return (
    <details className="rounded-lg border bg-slate-50 p-2 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-800">Histórico de conversaciones · {threads.length}</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por tema, cuenta, texto o URL" className="min-w-0 flex-1 rounded border bg-white px-2 py-1" />
        <button type="button" onClick={() => downloadHistoryCsv(filtered)} className="rounded border bg-white px-2 py-1 font-semibold">Descargar CSV</button>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="font-semibold">Cliente
          <select value={client} onChange={(event) => setClient(event.target.value)} className="ml-1 rounded border bg-white px-2 py-1 font-normal">
            <option value="">Todos</option>
            {clients.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="font-semibold">Desde <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded border bg-white px-2 py-1 font-normal" /></label>
        <label className="font-semibold">Hasta <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded border bg-white px-2 py-1 font-normal" /></label>
        <button type="button" onClick={() => openClientReport(filtered, client, from, to)} className="rounded bg-indigo-700 px-2 py-1 font-semibold text-white">Informe (PDF)</button>
      </div>
      {note && <p role="status" className="mt-1 text-emerald-800">{note}</p>}
      <div className="mt-2 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {filtered.map((thread) => {
          const published = thread.jobs.filter((job) => job.status === "COMPLETED").length;
          return (
            <details key={thread.threadId} className="rounded-lg border bg-white p-2">
              <summary className="cursor-pointer">
                <span className="font-semibold">{formatDate(thread.createdAt)}</span> · {thread.guide.slice(0, 90)}
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${thread.active ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"}`}>{thread.active ? "En curso" : "Terminada"} · {published}/{thread.jobs.length} publicados</span>
              </summary>
              <a href={thread.postUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-indigo-700 underline">Abrir la publicación en Facebook</a>
              <ol className="mt-2 space-y-1.5">
                {thread.jobs.map((job) => (
                  <li key={job.id} className={`rounded border px-2 py-1 ${job.replyToOrder ? "ml-5 border-indigo-100 bg-indigo-50/40" : "bg-slate-50"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-semibold">#{job.order} · {job.author}{job.replyToOrder ? ` → responde a #${job.replyToOrder}${job.replyToAuthor ? ` (${job.replyToAuthor})` : ""}` : ""}</span>
                      <span className="text-[10px] text-slate-500">{STATUS[job.status] ?? job.status}{job.completedAt ? ` · ${formatDate(job.completedAt)}` : ""}</span>
                    </div>
                    {job.text && <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{job.text}</p>}
                    {job.commentUrl && <a href={job.commentUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">Ver comentario</a>}
                    {job.engagement && <p className="text-slate-600">{job.engagement.visible ? "Visible" : "No aparece"}{job.engagement.reactions !== null ? ` · ${job.engagement.reactions} reacciones` : ""}{job.engagement.replies !== null ? ` · ${job.engagement.replies} respuestas` : ""} · {formatDate(job.engagement.checkedAt)}</p>}
                  </li>
                ))}
              </ol>
              {thread.client && <p className="mt-1 text-slate-500">Cliente: {thread.client}</p>}
              {thread.active && <button type="button" onClick={() => onTrack(thread)} className="mt-2 rounded border px-2 py-1 font-semibold text-sky-800">Ver seguimiento</button>}
              {published > 0 && <button type="button" onClick={() => void onCheck(thread).then(setNote).catch((error) => setNote(error instanceof Error ? error.message : "No se pudo programar la comprobación"))} className="ml-2 mt-2 rounded border px-2 py-1 font-semibold text-indigo-800">Comprobar reacciones y respuestas</button>}
            </details>
          );
        })}
      </div>
    </details>
  );
}

const ACTIVE_KEY = "nv-thread-active";
const DRAFT_KEY = "nv-thread-draft";
function storageGet(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } }
function storageSet(key: string, value: string | null) { try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* opcional */ } }

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
  const [startAt, setStartAt] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [jobs, setJobs] = useState<TrackedJob[] | null>(null);
  const [approveNote, setApproveNote] = useState<string | null>(null);
  const [meta, setMeta] = useState<TrackedMeta[] | null>(null);
  const [trackedGuide, setTrackedGuide] = useState<string>("");
  const [recent, setRecent] = useState<ThreadSummary[]>([]);
  const [draftLoaded, setDraftLoaded] = useState(false);

  async function loadThreads(): Promise<ThreadSummary[]> {
    const response = await fetch("/api/v1/mobile/automations/threads", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message ?? "No se pudieron cargar las conversaciones");
    return Array.isArray(data?.threads) ? data.threads : [];
  }

  function track(thread: ThreadSummary) {
    setJobs(thread.jobs.map(({ id, deviceSerial, status, lastError, waiting, commentUrl, engagement }) => ({ id, deviceSerial, status, lastError, waiting, commentUrl, engagement })));
    setMeta(thread.jobs.map(({ order, replyToOrder, author }) => ({ order, replyToOrder, author })));
    setTrackedGuide(thread.guide);
    setThreadId(thread.threadId);
    storageSet(ACTIVE_KEY, thread.threadId);
  }

  // Al cargar la página: recuperar la conversación que se estaba siguiendo y el borrador sin enviar.
  useEffect(() => {
    let disposed = false;
    const draft = storageGet(DRAFT_KEY);
    if (draft) {
      try {
        const saved = JSON.parse(draft);
        setPostUrl(saved.postUrl ?? ""); setPostContext(saved.postContext ?? ""); setGuide(saved.guide ?? "");
        if (saved.turns) setTurns(saved.turns);
        setFacts(saved.facts ?? {}); setExcluded(saved.excluded ?? []);
        if (Array.isArray(saved.messages)) setMessages(saved.messages);
        if (saved.gapMinutes) setGapMinutes(saved.gapMinutes);
        if (typeof saved.startAt === "string") setStartAt(saved.startAt);
        if (typeof saved.client === "string") setClient(saved.client);
        if (saved.threadId) setThreadId(saved.threadId);
      } catch { /* borrador dañado: se ignora */ }
    }
    setDraftLoaded(true);
    void loadThreads().then((threads) => {
      if (disposed) return;
      setRecent(threads);
      const activeId = storageGet(ACTIVE_KEY);
      const current = threads.find((thread) => thread.threadId === activeId);
      if (current) track(current);
    }).catch(() => undefined);
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guardar el borrador (configuración y simulación) mientras no se ha enviado.
  useEffect(() => {
    if (!draftLoaded || jobs) return;
    storageSet(DRAFT_KEY, JSON.stringify({ postUrl, postContext, guide, turns, facts, excluded, messages, gapMinutes, threadId, startAt, client }));
  }, [draftLoaded, jobs, postUrl, postContext, guide, turns, facts, excluded, messages, gapMinutes, threadId, startAt, client]);

  const participants = useMemo(() => targets
    .filter((target) => !excluded.includes(target.deviceSerial))
    .map((target) => ({ ...target, facts: (facts[target.deviceSerial] ?? "").trim() })), [targets, excluded, facts]);

  const ids = jobs?.map((job) => job.id).join(",") ?? "";
  const finished = Boolean(jobs?.length) && jobs!.every((job) => ["COMPLETED", "REJECTED", "CANCELLED"].includes(job.status));
  useEffect(() => {
    if (!finished) return;
    storageSet(ACTIVE_KEY, null);
    void loadThreads().then(setRecent).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);
  useEffect(() => {
    if (!ids) return;
    let disposed = false;
    async function refresh() {
      try {
        // El seguimiento se lee de la conversación: incluye por qué espera cada mensaje.
        const response = await fetch(`/api/v1/mobile/automations/threads?threadId=${encodeURIComponent(threadId)}&days=365`, { cache: "no-store" });
        const data = await response.json();
        const fresh: TrackedJob[] = data?.threads?.[0]?.jobs ?? [];
        if (!disposed && response.ok) setJobs((current) => current?.map((job) => {
          const item = fresh.find((candidate) => candidate.id === job.id);
          return item ? { ...job, status: item.status, lastError: item.lastError, deviceSerial: item.deviceSerial, waiting: item.waiting, commentUrl: item.commentUrl, engagement: item.engagement } : job;
        }) ?? null);
      } catch { /* el siguiente ciclo lo reintenta */ }
    }
    const timer = window.setInterval(refresh, 10_000);
    void refresh();
    return () => { disposed = true; window.clearInterval(timer); };
  }, [ids]);

  // Vigilante: si la conversación lleva un rato sin avanzar y hay mensajes parados,
  // se reactiva sola (igual que «Reactivar y continuar») y se reabren las pantallas.
  const progress = useRef<{ signature: string; since: number; lastAuto: number }>({ signature: "", since: Date.now(), lastAuto: 0 });
  const [autoNote, setAutoNote] = useState<string | null>(null);
  useEffect(() => {
    if (!jobs || finished) return;
    const signature = jobs.map((job) => `${job.id}:${job.status}`).join("|");
    if (signature !== progress.current.signature) progress.current = { ...progress.current, signature, since: Date.now() };
  }, [jobs, finished]);
  useEffect(() => {
    if (!jobs?.length || finished) return;
    const timer = window.setInterval(() => {
      const stalled = (jobs ?? []).some((job) => job.status === "WAITING_USER" || job.status === "FAILED" || (job.status === "CANCELLED" && /caduc/i.test(job.lastError ?? "")));
      const now = Date.now();
      if (busy) return;
      if (now - progress.current.since < AUTO_RESUME_AFTER_MS || now - progress.current.lastAuto < AUTO_RESUME_AFTER_MS) return;
      progress.current.lastAuto = now;
      if (!stalled) {
        // Nada parado pero tampoco avanza: probablemente se cerró la pantalla de algún móvil.
        const waiting = [...new Set((jobs ?? []).filter((job) => job.status === "QUEUED" || job.status === "RUNNING").map((job) => job.deviceSerial))];
        if (onOpen && waiting.length) onOpen(waiting);
        return;
      }
      setAutoNote(`Reactivada automáticamente a las ${new Date(now).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} tras ${Math.round(AUTO_RESUME_AFTER_MS / 60000)} min sin avances.`);
      void resumeThread();
    }, 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, jobs, finished, busy]);

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
      const payload = await postJson("/api/v1/mobile/automations/threads", { threadId, postUrl, guide, participants, messages, gapMinutes, ...(startAt ? { startAt: new Date(startAt).toISOString() } : {}), ...(client.trim() ? { client: client.trim() } : {}) });
      setJobs(payload.jobs);
      setMeta(messages.map((message) => ({ order: message.order, replyToOrder: message.replyToOrder, author: participants[message.participant]?.label ?? "" })));
      setTrackedGuide(guide);
      storageSet(ACTIVE_KEY, threadId);
      storageSet(DRAFT_KEY, null);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "No se pudo crear la conversación");
    } finally { setBusy(false); }
  }

  async function decideJob(id: string, action: "RETRY" | "COMPLETE", verifiedPublished = false) {
    if (verifiedPublished && !window.confirm("¿Has comprobado en Facebook que este texto ya está publicado desde la cuenta correcta? Se cerrará este mensaje y no se volverá a enviar.")) return;
    setBusy(true); setError(null);
    try {
      await postJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(id)}/decision`, { action, ...(verifiedPublished ? { verifiedPublished: true } : {}) });
      setJobs((current) => current?.map((job) => job.id === id ? { ...job, status: action === "RETRY" ? "QUEUED" : "COMPLETED", lastError: null } : job) ?? null);
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : "No se pudo actualizar el mensaje");
    } finally { setBusy(false); }
  }

  async function checkThread(thread: ThreadSummary): Promise<string> {
    const result = await postJson("/api/v1/mobile/automations/threads/check", { threadId: thread.threadId });
    const serials = [...new Set(thread.jobs.filter((job) => job.status === "COMPLETED").map((job) => job.deviceSerial))];
    if (onOpen && serials.length) onOpen(serials);
    return result.created ? "Comprobación en cola: un móvil de la conversación revisará reacciones y respuestas sin escribir nada. Se abren sus pantallas." : "Ya había una comprobación en curso para esta conversación.";
  }

  async function resumeThread() {
    if (!jobs) return;
    setBusy(true); setError(null); setApproveNote(null);
    try {
      const result = await postJson("/api/v1/mobile/automations/threads/resume", { threadId });
      const refreshed = await loadThreads();
      setRecent(refreshed);
      const current = refreshed.find((thread) => thread.threadId === threadId);
      if (current) track(current);
      if (onOpen && result.deviceSerials?.length) onOpen(result.deviceSerials);
      setApproveNote(`${result.reactivated} mensajes reactivados.${result.pendingApproval ? ` ${result.pendingApproval} siguen pendientes de aprobación.` : ""} Se están abriendo las pantallas de ${result.deviceSerials?.length ?? 0} móviles: déjalas abiertas hasta que termine.`);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "No se pudo reactivar la conversación");
    } finally { setBusy(false); }
  }

  async function approveAll() {
    if (!jobs) return;
    const pending = jobs.filter((job) => job.status === "PENDING_APPROVAL");
    setBusy(true); setApproveNote(null);
    let ok = 0;
    const failed: string[] = [];
    for (const job of pending) {
      try { await postJson(`/api/v1/mobile/automations/jobs/${encodeURIComponent(job.id)}/decision`, { action: "APPROVE" }); ok += 1; }
      catch (approveError) { failed.push(approveError instanceof Error ? approveError.message : "Error"); }
    }
    setJobs((current) => current?.map((job) => pending.some((item) => item.id === job.id) && !failed.length ? { ...job, status: "QUEUED" } : job) ?? null);
    setApproveNote(`${ok} de ${pending.length} mensajes aprobados.${failed.length ? ` Errores: ${failed[0]}` : " Se publicarán en orden cuando las pantallas estén abiertas."}`);
    setBusy(false);
  }

  function reset() {
    setMessages(null); setJobs(null); setMeta(null); setError(null); setThreadId(crypto.randomUUID());
    storageSet(ACTIVE_KEY, null);
    void loadThreads().then(setRecent).catch(() => undefined);
  }

  if (jobs && meta) {
    return (
      <div className="space-y-3 rounded-xl border border-indigo-100 bg-white p-3 text-xs">
        {finished && <p className="rounded bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">Conversación terminada. Queda guardada en «Histórico de conversaciones» (pulsa «Nueva conversación» para verlo).</p>}
        <p className="font-semibold text-slate-800">Conversación {finished ? "terminada" : "en curso"} · {jobs.length} mensajes · {jobs.filter((job) => job.status === "COMPLETED").length} publicados</p>
        {trackedGuide && <p className="text-slate-500">{trackedGuide.slice(0, 160)}</p>}
        {!finished && <button type="button" disabled={busy} onClick={() => void resumeThread()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Reactivar y continuar</button>}
        {!finished && <p className="text-[11px] text-slate-500">Reactiva los mensajes parados y abre sus pantallas sin interrumpir los trabajos activos. Si un envío quedó sin confirmar, solo se comprueba; no se vuelve a enviar automáticamente. Si la conversación pasa {Math.round(AUTO_RESUME_AFTER_MS / 60000)} minutos parada, se reactiva sola. Si un móvil falla 3 veces seguidas o no se conecta en 15 minutos, su mensaje pasa a otro móvil conectado y libre que no participe en la conversación (el texto no se cambia).</p>}
        {!finished && autoNote && <p className="rounded bg-violet-50 px-2 py-1 text-violet-800">{autoNote}</p>}
        <p className="rounded bg-sky-50 px-2 py-1 text-sky-800">El progreso se guarda en el Hub. Si recargas la página, las pantallas que estaban abiertas se vuelven a abrir solas y la conversación continúa por donde iba.</p>
        <p className="text-slate-600">Cada mensaje necesita aprobación. Se respeta el orden mientras los mensajes avanzan; si una rama queda parada, continúan los mensajes independientes. Una respuesta siempre espera a que se publique su comentario original.</p>
        {jobs.map((job, index) => {
          const message = meta[index];
          return (
            <div key={job.id} className="rounded-lg border bg-slate-50 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">#{index + 1} · {message?.author || job.deviceSerial}{message?.replyToOrder ? ` → responde a #${message.replyToOrder}` : ""}</span>
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">{STATUS[job.status] ?? job.status}</span>
              </div>
              {job.waiting && <p className={`mt-1 ${/^Parado|no está abierta|no puede publicar/.test(job.waiting) ? "text-amber-700" : "text-slate-600"}`}>{job.waiting}</p>}
              {!job.waiting && job.lastError && <p className="mt-1 text-rose-700">{job.lastError}</p>}
              {job.status === "COMPLETED" && job.commentUrl && <a className="mt-1 mr-3 inline-block text-indigo-700 underline" href={job.commentUrl} target="_blank" rel="noreferrer">Ver comentario publicado</a>}
              {job.engagement && <p className="mt-1 text-slate-600">{job.engagement.visible ? "Sigue visible" : "No aparece (oculto o eliminado)"}{job.engagement.reactions !== null ? ` · ${job.engagement.reactions} reacciones` : ""}{job.engagement.replies !== null ? ` · ${job.engagement.replies} respuestas` : ""} · comprobado {new Date(job.engagement.checkedAt).toLocaleString("es-ES")}</p>}
              {job.status === "QUEUED" && !job.waiting && (() => {
                const dependencyJobs = jobs.map((item) => ({ ...item, text: item.text ?? null }));
                const blockers = jobs.slice(Math.max(0, index - 1), index).map((other) => ({ other, order: index })).filter(({ other }) => ["PENDING_APPROVAL", "QUEUED", "RUNNING"].includes(other.status) && !isStoppedThreadBranch({ ...other, text: other.text ?? null }, dependencyJobs));
                const parentOrder = message?.replyToOrder;
                const parent = parentOrder ? jobs[parentOrder - 1] : undefined;
                if (parent && parent.status === "FAILED") return <p className="mt-1 text-amber-700">Bloqueado: el mensaje #{parentOrder} al que responde ha fallado. Reinténtalo o márcalo como publicado.</p>;
                if (parent && parent.status !== "COMPLETED") return <p className="mt-1 text-amber-700">Esperando la publicación confirmada del mensaje #{parentOrder}.</p>;
                const previous = blockers.at(-1);
                if (previous) return <p className="mt-1 text-slate-500">Esperando a que termine el mensaje #{previous.order}.</p>;
                return <p className="mt-1 text-slate-500">Listo para publicarse: la pantalla de este móvil debe estar abierta en el Hub.</p>;
              })()}
              {job.status === "FAILED" && <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void decideJob(job.id, "RETRY")} className="rounded border bg-white px-2 py-1 font-semibold">Reintentar</button>
                <button type="button" disabled={busy} onClick={() => void decideJob(job.id, "COMPLETE")} className="rounded border bg-white px-2 py-1 font-semibold text-emerald-700">Ya está publicado</button>
              </div>}
              {job.status === "WAITING_USER" && <button type="button" disabled={busy} onClick={() => void decideJob(job.id, "COMPLETE")} className="mt-1 rounded border bg-white px-2 py-1 font-semibold text-emerald-700">Confirmo que está publicado</button>}
              {job.status === "QUEUED" && <button type="button" disabled={busy} onClick={() => void decideJob(job.id, "COMPLETE", true)} className="mt-1 rounded border bg-white px-2 py-1 font-semibold text-emerald-700">Confirmar publicación manual</button>}
              <a className="mt-1 inline-block text-indigo-700 underline" href={`#mobile-device-${encodeURIComponent(job.deviceSerial)}`}>Revisar en la cola de este móvil</a>
            </div>
          );
        })}
        {approveNote && <p role="status" className="text-emerald-800">{approveNote}</p>}
        {error && <p role="alert" className="text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {jobs.some((job) => job.status === "PENDING_APPROVAL") && <button type="button" disabled={busy} onClick={() => void approveAll()} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white disabled:opacity-50">Aprobar todos los mensajes</button>}
          {onOpen && <button type="button" onClick={() => onOpen([...new Set(jobs.map((job) => job.deviceSerial))])} className="rounded-lg border px-3 py-2">Abrir pantallas de estos móviles</button>}
          <button type="button" onClick={reset} className="rounded-lg border px-3 py-2">Nueva conversación</button>
          <p className="w-full text-[11px] text-slate-500">«Nueva conversación» no cancela esta: seguirá publicándose y podrás recuperarla en «Conversaciones en curso».</p>
        </div>
      </div>
    );
  }

  const activeThreads = recent.filter((thread) => thread.active);
  return (
    <div className="space-y-3 rounded-xl border border-indigo-100 bg-white p-3">
      {activeThreads.length > 0 && <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs">
        <p className="font-semibold text-sky-900">Conversaciones en curso · {activeThreads.length}</p>
        {activeThreads.map((thread) => (
          <div key={thread.threadId} className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1">
            <span className="min-w-0 flex-1 truncate">{thread.guide.slice(0, 80)} · {thread.jobs.filter((job) => job.status === "COMPLETED").length}/{thread.jobs.length} publicados</span>
            <button type="button" onClick={() => track(thread)} className="rounded border px-2 py-0.5 font-semibold text-sky-800">Ver seguimiento</button>
          </div>
        ))}
      </div>}
      <ThreadHistory threads={recent} onTrack={track} onCheck={checkThread} />
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
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">Empezar (opcional)
          <input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
          <span className="mt-0.5 block font-normal text-slate-500">Vacío = en cuanto se aprueben. Los siguientes mensajes salen cada {gapMinutes} min desde esa hora.</span>
        </label>
        <label className="text-xs font-semibold text-slate-700">Cliente (para informes)
          <input value={client} onChange={(event) => setClient(event.target.value)} maxLength={120} placeholder="Ej. Aquaking" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
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
