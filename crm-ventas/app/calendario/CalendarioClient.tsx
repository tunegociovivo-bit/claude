"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Phone, MessageCircle, Plus, X } from "lucide-react";
import clsx from "clsx";

type Appointment = {
  id: string;
  customerName: string;
  customerPhone: string | null;
  startsAt: string;
  durationMin: number;
  status: string;
  source: string;
  notes: string | null;
};

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

// Rejilla mensual con lunes como primer día.
function buildMonth(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarioClient() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState<string | null>(null); // dayKey

  const load = useCallback(async () => {
    const from = new Date(year, month, 1).toISOString();
    const to = new Date(year, month + 1, 1).toISOString();
    const res = await fetch(`/api/v1/appointments?from=${from}&to=${to}`);
    if (res.ok) {
      const data = await res.json();
      setAppointments(data.appointments);
    }
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const cells = useMemo(() => buildMonth(year, month), [year, month]);
  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const k = dayKey(new Date(a.startsAt));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [appointments]);

  function nav(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  async function cancelAppointment(id: string) {
    await fetch(`/api/v1/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelada" }),
    });
    setSelected(null);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calendario</h1>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => nav(-1)}>
            <ChevronLeft size={16} />
          </button>
          <span className="w-44 text-center text-sm font-semibold">
            {MONTHS[month]} {year}
          </span>
          <button className="btn-ghost" onClick={() => nav(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => {
            const k = date ? dayKey(date) : `x${i}`;
            const dayAppts = date ? byDay.get(k) ?? [] : [];
            const isToday = date && dayKey(date) === dayKey(today);
            return (
              <div
                key={k}
                className={clsx(
                  "group min-h-[110px] border-b border-r border-slate-100 p-1.5",
                  !date && "bg-slate-50/50"
                )}
              >
                {date && (
                  <>
                    <div className="flex items-center justify-between">
                      <span
                        className={clsx(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                          isToday
                            ? "bg-brand-500 font-bold text-white"
                            : "text-slate-500"
                        )}
                      >
                        {date.getDate()}
                      </span>
                      <button
                        onClick={() => setCreating(k)}
                        className="hidden text-slate-300 hover:text-brand-600 group-hover:block"
                        title="Nueva cita"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="mt-1 space-y-1">
                      {dayAppts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setSelected(a)}
                          className={clsx(
                            "flex w-full items-center gap-1 truncate rounded-md px-1.5 py-1 text-left text-xs font-medium",
                            a.status === "cancelada"
                              ? "bg-slate-100 text-slate-400 line-through"
                              : "bg-brand-50 text-brand-700 hover:bg-brand-100"
                          )}
                        >
                          {a.source === "llamada" ? (
                            <Phone size={11} className="shrink-0" />
                          ) : a.source === "whatsapp" ? (
                            <MessageCircle size={11} className="shrink-0" />
                          ) : null}
                          <span className="shrink-0">
                            {new Date(a.startsAt).toLocaleTimeString("es-ES", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span className="truncate">{a.customerName}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <DetailModal
          appointment={selected}
          onClose={() => setSelected(null)}
          onCancel={() => cancelAppointment(selected.id)}
        />
      )}
      {creating && (
        <CreateModal
          day={creating}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function DetailModal({
  appointment: a,
  onClose,
  onCancel,
}: {
  appointment: Appointment;
  onClose: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold">{a.customerName}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <dl className="space-y-2 text-sm">
          <Row label="Cuándo">
            {new Date(a.startsAt).toLocaleString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · {a.durationMin} min
          </Row>
          {a.customerPhone && <Row label="Teléfono">{a.customerPhone}</Row>}
          <Row label="Origen">
            {a.source === "llamada"
              ? "📞 Llamada (PAULA)"
              : a.source === "whatsapp"
                ? "💬 WhatsApp (PAULA)"
                : "Manual"}
          </Row>
          <Row label="Estado">{a.status}</Row>
          {a.notes && <Row label="Notas">{a.notes}</Row>}
        </dl>
        {a.status !== "cancelada" && (
          <button
            onClick={onCancel}
            className="btn mt-5 w-full justify-center border border-red-200 text-red-600 hover:bg-red-50"
          >
            Cancelar cita
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function CreateModal({
  day,
  onClose,
  onCreated,
}: {
  day: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/v1/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: name,
        customerPhone: phone || undefined,
        datetime: `${day}T${time}:00`,
        notes: notes || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo crear la cita");
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <form className="card w-full max-w-md space-y-3 p-6" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">Nueva cita — {day}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <input className="input" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="input" placeholder="Teléfono (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        <textarea className="input" placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full justify-center" disabled={saving}>
          {saving ? "Guardando…" : "Crear cita"}
        </button>
      </form>
    </div>
  );
}
