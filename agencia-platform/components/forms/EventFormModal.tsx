"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import type { UiClient, UiEvent } from "@/lib/db/queries";
import { Loader2, Trash2 } from "lucide-react";

const typeOptions = [
  { value: "MEETING", label: "Reunión" },
  { value: "PUBLICATION", label: "Publicación" },
  { value: "DEADLINE", label: "Deadline" },
  { value: "CAMPAIGN", label: "Campaña" },
  { value: "OTHER", label: "Otro" }
];

// Mapeo del tipo UI (español) al tipo backend (inglés mayúsculas).
const UI_TO_BACKEND: Record<string, string> = {
  reunion: "MEETING",
  publicacion: "PUBLICATION",
  deadline: "DEADLINE",
  campaña: "CAMPAIGN"
};

export default function EventFormModal({
  open,
  onClose,
  clients,
  defaultDate,
  event
}: {
  open: boolean;
  onClose: () => void;
  clients: UiClient[];
  defaultDate?: string;
  /** Si se pasa, modo edición — habilita el botón Eliminar y al
   *  guardar hace PATCH en lugar de POST. */
  event?: UiEvent | null;
}) {
  const router = useRouter();
  const isEdit = !!event;
  const [title, setTitle] = useState("");
  const [type, setType] = useState("MEETING");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (event) {
      setTitle(event.title);
      setType(UI_TO_BACKEND[event.type] ?? "OTHER");
      setDate(event.date);
      setTime(event.time ?? "10:00");
      setAllDay(!event.time);
      setClientId(event.clientId ?? "");
    } else {
      setTitle("");
      setType("MEETING");
      setDate(defaultDate ?? new Date().toISOString().slice(0, 10));
      setTime("10:00");
      setAllDay(false);
      setClientId("");
    }
  }, [open, defaultDate, event]);

  async function handleDelete() {
    if (!event) return;
    if (!confirm(`¿Eliminar el evento "${event.title}"?\n\nEsta acción no se puede deshacer.`)) return;
    setDeleting(true);
    const r = await fetch(`/api/v1/events/${event.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    router.refresh();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("El título es obligatorio");
    if (!date) return setError("La fecha es obligatoria");

    const startAt = allDay
      ? new Date(`${date}T00:00:00`).toISOString()
      : new Date(`${date}T${time}:00`).toISOString();

    setSaving(true);
    const url = isEdit ? `/api/v1/events/${event!.id}` : "/api/v1/events";
    const method = isEdit ? "PATCH" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        type,
        startAt,
        allDay,
        clientId: clientId || undefined
      })
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return setError(j.message || `Error ${r.status}`);
    }
    router.refresh();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar evento" : "Nuevo evento"}
      size="lg"
      footer={
        <>
          {isEdit && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 disabled:opacity-50 mr-auto"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar
            </button>
          )}
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="event-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Guardar cambios" : "Crear evento"}
          </button>
        </>
      }
    >
      <form id="event-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Ej. Publicación reel cliente X"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Cliente</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— Sin cliente —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Fecha</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Hora</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={allDay}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="rounded"
              />
              Todo el día
            </label>
          </div>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
