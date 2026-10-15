"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, ClipboardList, Loader2, Megaphone, PhoneCall, Plus, Trash2 } from "lucide-react";
import { jsonFetch } from "@/components/inbox/ui";
import { LeadStatusSelect, type LeadStatusOption } from "@/components/inbox/leads-ui";
import LeadDetails, { leadAnswersSummary, leadHeadline, leadWhen, type LeadInfoEntryView } from "@/components/inbox/LeadDetails";

export type LeadContact = {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  stage: string;
  notes: string | null;
  leadStatus?: string | null;
  leadStatusAt?: string | null;
  leadInfo?: { entries?: LeadInfoEntryView[] } | null;
  contactAttempts?: Attempt[];
};

type Attempt = { id: string; at: string; by: string | null; byName: string | null; note: string | null };

// Valor para <input type="datetime-local"> en la hora local del dispositivo.
function localInputValue(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function attemptWhen(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Hoy, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Ayer, ${time}`;
  return `${d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

type Column = { id: string; label: string };

// Barra del lead bajo la cabecera del chat: estado (desplegable), columna del
// pipeline e «Información adicional» con los datos del formulario de Meta.
export default function LeadPanel({
  contact,
  statuses,
  columns,
  onSaved,
  onError,
}: {
  contact: LeadContact;
  statuses: LeadStatusOption[];
  columns: Column[];
  onSaved: () => void;
  onError: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(contact.leadStatus ?? null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const contactId = useRef(contact.id);
  const [attempts, setAttempts] = useState<Attempt[]>(contact.contactAttempts ?? []);
  const [attemptAt, setAttemptAt] = useState("");
  const [savingAttempt, setSavingAttempt] = useState(false);
  const attemptsRef = useRef<HTMLDivElement>(null);

  // Al cambiar de chat se reinicia; mientras se escribe, el refresco no pisa el texto.
  useEffect(() => {
    if (contactId.current !== contact.id) {
      contactId.current = contact.id;
      setOpen(false);
      setNotesDirty(false);
      setNotes(contact.notes ?? "");
      setStatus(contact.leadStatus ?? null);
      setAttempts(contact.contactAttempts ?? []);
      setAttemptAt("");
      return;
    }
    if (!savingAttempt) setAttempts(contact.contactAttempts ?? []);
    if (!savingStatus) setStatus(contact.leadStatus ?? null);
    if (!notesDirty) setNotes(contact.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id, contact.leadStatus, contact.notes, contact.contactAttempts, notesDirty, savingStatus]);

  async function addAttempt(atLocal: string | null) {
    setSavingAttempt(true);
    const at = atLocal ? new Date(atLocal).toISOString() : null;
    const { ok, data } = await jsonFetch(`/api/v1/contacts/${contact.id}/attempts`, { method: "POST", body: JSON.stringify({ at }) });
    setSavingAttempt(false);
    if (!ok) {
      onError(typeof data?.error === "string" ? data.error : "No se pudo apuntar el intento");
      return;
    }
    setAttempts(data.attempts ?? []);
    setAttemptAt("");
    onSaved();
  }

  async function removeAttempt(id: string) {
    if (!confirm("¿Borrar este intento de contacto?")) return;
    setSavingAttempt(true);
    const { ok, data } = await jsonFetch(`/api/v1/contacts/${contact.id}/attempts?attempt=${encodeURIComponent(id)}`, { method: "DELETE" });
    setSavingAttempt(false);
    if (!ok) {
      onError(typeof data?.error === "string" ? data.error : "No se pudo borrar el intento");
      return;
    }
    setAttempts(data.attempts ?? []);
    onSaved();
  }

  async function changeStatus(next: string | null) {
    const prev = status;
    setStatus(next);
    setSavingStatus(true);
    const { ok, data } = await jsonFetch(`/api/v1/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ leadStatus: next }) });
    setSavingStatus(false);
    if (!ok) {
      setStatus(prev);
      onError(typeof data?.error === "string" ? data.error : "No se pudo cambiar el estado");
      return;
    }
    onSaved();
  }

  async function changeStage(stage: string) {
    const { ok } = await jsonFetch(`/api/v1/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    if (!ok) onError("No se pudo mover en el pipeline");
    onSaved();
  }

  async function saveNotes() {
    setSavingNotes(true);
    const { ok } = await jsonFetch(`/api/v1/contacts/${contact.id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: notes.trim() ? notes.trim() : null }),
    });
    setSavingNotes(false);
    if (!ok) {
      onError("No se pudo guardar la información adicional");
      return;
    }
    setNotesDirty(false);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2500);
    onSaved();
  }

  const entries = contact.leadInfo?.entries ?? [];
  const latest = entries[0];
  const hasNotes = Boolean((contact.notes ?? "").trim());

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <LeadStatusSelect statuses={statuses} value={status} onChange={(v) => void changeStatus(v)} disabled={savingStatus} className="min-w-0 flex-1 sm:max-w-xs" />
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setTimeout(() => attemptsRef.current?.scrollIntoView({ block: "nearest" }), 50);
          }}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
          aria-label={`${attempts.length} intentos de contacto`}
          title="Intentos de contacto"
        >
          <PhoneCall size={15} />
          {attempts.length}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={clsx(
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
            open ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-700"
          )}
        >
          <ClipboardList size={15} />
          <span>Ficha</span>
          {(hasNotes || entries.length > 0) && !open && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-label="Con información" />}
          <ChevronDown size={14} className={clsx("transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {!open && latest && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-start gap-1.5 px-3 pb-2 text-left text-xs text-slate-600 sm:px-4"
          aria-label="Ver todos los datos del lead"
        >
          <Megaphone size={13} className="mt-0.5 shrink-0 text-brand-600" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-slate-800">{leadHeadline(latest)}</span>
            <span className="text-slate-500"> · {leadWhen(latest.at)}</span>
            {leadAnswersSummary(latest) && <span className="line-clamp-2 block text-slate-700">{leadAnswersSummary(latest)}</span>}
            {contact.email && <span className="block truncate text-slate-500">{contact.email}</span>}
          </span>
        </button>
      )}
      {open && (
        <div className="max-h-[50dvh] space-y-3 overflow-y-auto border-t border-slate-100 px-3 py-3 sm:px-4">
          <LeadDetails entries={entries} email={contact.email} />
          <div ref={attemptsRef} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Intentos de contacto: <span className="text-base">{attempts.length}</span>
              </span>
              <button
                type="button"
                className="btn-primary h-10 px-3 text-sm"
                disabled={savingAttempt}
                onClick={() => void addAttempt(null)}
              >
                {savingAttempt ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Intento ahora
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                aria-label="Hora del intento"
                className="input h-10 min-w-0 flex-1"
                value={attemptAt}
                max={localInputValue()}
                onChange={(e) => setAttemptAt(e.target.value)}
              />
              <button
                type="button"
                className="btn-ghost h-10 shrink-0 border border-slate-200 bg-white"
                disabled={!attemptAt || savingAttempt}
                onClick={() => void addAttempt(attemptAt)}
              >
                Añadir a esa hora
              </button>
            </div>
            {attempts.length > 0 && (
              <ol className="mt-2 divide-y divide-slate-200/70">
                {[...attempts].reverse().map((a, i) => (
                  <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="w-7 shrink-0 text-xs font-semibold text-slate-400">#{attempts.length - i}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800">{attemptWhen(a.at)}</span>
                      {a.byName && <span className="block truncate text-[11px] text-slate-500">{a.byName}</span>}
                    </span>
                    <button
                      type="button"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => void removeAttempt(a.id)}
                      disabled={savingAttempt}
                      aria-label={`Borrar intento ${attempts.length - i}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {columns.length > 0 && (
            <label className="block text-xs font-medium text-slate-600">
              Columna del pipeline
              <select className="input mt-1 h-10" value={contact.stage} onChange={(e) => void changeStage(e.target.value)}>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-xs font-medium text-slate-600">
            Información adicional
            <textarea
              className="input mt-1 min-h-24 resize-y"
              placeholder="Lo que haya que saber de este lead: cuándo llamar, qué le interesa, presupuesto…"
              value={notes}
              maxLength={10000}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesDirty(true);
              }}
            />
          </label>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary h-10" disabled={!notesDirty || savingNotes} onClick={() => void saveNotes()}>
              {savingNotes ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Guardar
            </button>
            {notesSaved && <span className="text-xs text-emerald-700">Guardado</span>}
            {notesDirty && !savingNotes && <span className="text-xs text-amber-700">Sin guardar</span>}
          </div>
        </div>
      )}
    </div>
  );
}
