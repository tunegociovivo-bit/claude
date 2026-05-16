"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import EventFormModal from "@/components/forms/EventFormModal";
import type { UiEvent, UiClient } from "@/lib/db/queries";
import { Plus, ChevronLeft, ChevronRight, Calendar } from "lucide-react";

type ExternalEvent = {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string;
  title: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso?: string;
  allDay: boolean;
  date: string; // YYYY-MM-DD
  time?: string;
  external: true;
};

type ExternalCal = { id: string; name: string; color: string; error: string | null };

const typeStyles: Record<UiEvent["type"], string> = {
  publicacion: "bg-sky-100 text-sky-800 border-sky-300",
  reunion: "bg-indigo-100 text-indigo-800 border-indigo-300",
  deadline: "bg-rose-100 text-rose-800 border-rose-300",
  campaña: "bg-emerald-100 text-emerald-800 border-emerald-300"
};

const typeLabels: Record<UiEvent["type"], string> = {
  publicacion: "Publicación",
  reunion: "Reunión",
  deadline: "Deadline",
  campaña: "Campaña"
};

function buildMonth(year: number, month: number) {
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: ({ date: Date; current: boolean } | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), current: true });
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function CalendarioClient({
  events,
  clients
}: {
  events: UiEvent[];
  clients: UiClient[];
}) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [editingEvent, setEditingEvent] = useState<UiEvent | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = useMemo(() => buildMonth(year, month), [year, month]);

  const getClient = (id?: string) => clients.find((c) => c.id === id);

  // Calendarios externos del usuario (Google/Outlook/iCloud por iCal).
  // Se fetchean cada vez que cambia el mes visible.
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  const [externalCals, setExternalCals] = useState<ExternalCal[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  // Visibilidad por calendario (toggle). Por defecto todos visibles.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    const from = new Date(year, month, 1).toISOString().slice(0, 10);
    const to = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    let aborted = false;
    setExternalLoading(true);
    fetch(`/api/v1/me/external-calendars/events?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (aborted || !data) return;
        setExternalEvents(data.events ?? []);
        setExternalCals(data.calendars ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!aborted) setExternalLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [year, month]);

  const visibleExternal = useMemo(
    () => externalEvents.filter((e) => !hidden.has(e.calendarId)),
    [externalEvents, hidden]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, (UiEvent | ExternalEvent)[]>();
    events.forEach((e) => {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    });
    visibleExternal.forEach((e) => {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    });
    return map;
  }, [events, visibleExternal]);

  function toggleCalendarVisibility(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isoToday = today.toISOString().slice(0, 10);
  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  function openNewEvent(date?: string) {
    setEditingEvent(null);
    setSelectedDate(date);
    setOpen(true);
  }

  function openEditEvent(ev: UiEvent) {
    setEditingEvent(ev);
    setSelectedDate(undefined);
    setOpen(true);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Calendario"
        description="Planifica publicaciones, reuniones y entregas."
        actions={
          <button
            onClick={() => openNewEvent()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nuevo evento
          </button>
        }
      />

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCursor(new Date(year, month - 1, 1))}
              className="h-8 w-8 grid place-items-center rounded-md border hover:bg-slate-50"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold capitalize">
              {cursor.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
            </h2>
            <button
              onClick={() => setCursor(new Date(year, month + 1, 1))}
              className="h-8 w-8 grid place-items-center rounded-md border hover:bg-slate-50"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="ml-2 text-xs text-slate-500 hover:text-slate-900 underline"
            >
              Hoy
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs flex-wrap">
            {(Object.keys(typeLabels) as UiEvent["type"][]).map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm border ${typeStyles[k]}`} />
                <span className="text-slate-600">{typeLabels[k]}</span>
              </div>
            ))}
            {externalCals.length > 0 && (
              <div className="flex items-center gap-1 ml-2 pl-2 border-l">
                {externalCals.map((c) => {
                  const isHidden = hidden.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCalendarVisibility(c.id)}
                      className={
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border " +
                        (isHidden ? "bg-white border-slate-200 text-slate-400" : "bg-white border-slate-200 text-slate-700")
                      }
                      title={c.error ? `Error: ${c.error}` : isHidden ? "Mostrar" : "Ocultar"}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-sm border"
                        style={{
                          backgroundColor: isHidden ? "transparent" : c.color,
                          borderColor: c.color
                        }}
                      />
                      <span className={isHidden ? "line-through" : ""}>{c.name}</span>
                      {c.error && <span className="text-rose-500">⚠</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {externalLoading && (
              <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                <Calendar className="h-3 w-3 animate-pulse" />
                Sincronizando…
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-7 text-xs uppercase tracking-wide text-slate-500 border-b">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
            <div key={d} className="px-3 py-2 border-r last:border-r-0">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 auto-rows-[110px]">
          {cells.map((cell, idx) => {
            if (!cell) return <div key={idx} className="border-r border-b last:border-r-0 bg-slate-50/30" />;
            const iso = cell.date.toISOString().slice(0, 10);
            const dayEvents = eventsByDay.get(iso) ?? [];
            const isToday = iso === isoToday;
            return (
              <button
                key={idx}
                onClick={() => openNewEvent(iso)}
                className="text-left border-r border-b last:border-r-0 p-1.5 overflow-hidden hover:bg-brand-50/50 transition"
              >
                <div className={`text-xs font-medium mb-1 ${isToday ? "text-brand-600" : "text-slate-700"}`}>
                  <span
                    className={
                      isToday
                        ? "inline-block h-6 w-6 rounded-full bg-brand-600 text-white grid place-items-center leading-6 text-center"
                        : ""
                    }
                  >
                    {cell.date.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayEvents.slice(0, 2).map((e) => {
                    const isExt = (e as ExternalEvent).external === true;
                    if (isExt) {
                      const ex = e as ExternalEvent;
                      return (
                        <div
                          key={ex.id}
                          style={{ backgroundColor: ex.color + "20", borderColor: ex.color + "80", color: ex.color }}
                          className="text-[11px] px-1.5 py-0.5 rounded border truncate"
                          title={`${ex.title}${ex.location ? ` · ${ex.location}` : ""} (${ex.calendarName})`}
                        >
                          {ex.time && <span className="font-medium">{ex.time} </span>}
                          {ex.title}
                        </div>
                      );
                    }
                    const ev = e as UiEvent;
                    return (
                      <div
                        key={ev.id}
                        onClick={(clickEv) => {
                          clickEv.stopPropagation();
                          openEditEvent(ev);
                        }}
                        className={`text-[11px] px-1.5 py-0.5 rounded border truncate cursor-pointer hover:opacity-80 ${typeStyles[ev.type]}`}
                        title="Click para editar/eliminar"
                      >
                        {ev.time && <span className="font-medium">{ev.time} </span>}
                        {ev.title}
                      </div>
                    );
                  })}
                  {dayEvents.length > 2 && (
                    <div className="text-[11px] text-slate-500 pl-1.5">+{dayEvents.length - 2} más</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Agenda de la semana</h2>
        <div className="bg-white rounded-xl border divide-y">
          {events
            .filter((e) => {
              const d = new Date(e.date);
              return d >= today && d <= weekFromNow;
            })
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((e) => {
              const client = getClient(e.clientId);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openEditEvent(e)}
                  className="w-full p-4 flex items-center gap-4 text-left hover:bg-slate-50 transition"
                  title="Click para editar/eliminar"
                >
                  <div className="flex flex-col items-center justify-center bg-slate-50 rounded-md w-14 py-1">
                    <div className="text-[10px] uppercase text-slate-500">
                      {new Date(e.date).toLocaleDateString("es-ES", { weekday: "short" })}
                    </div>
                    <div className="text-lg font-semibold leading-none mt-0.5">{new Date(e.date).getDate()}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{e.title}</div>
                    <div className="text-xs text-slate-500">
                      {client?.name} {e.time && `· ${e.time}`}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-md border ${typeStyles[e.type]}`}>
                    {typeLabels[e.type]}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      <EventFormModal
        open={open}
        onClose={() => {
          setOpen(false);
          setEditingEvent(null);
        }}
        clients={clients}
        defaultDate={selectedDate}
        event={editingEvent}
      />
    </div>
  );
}
