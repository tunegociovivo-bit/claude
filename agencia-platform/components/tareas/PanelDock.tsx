"use client";

/**
 * Dock fijo a la derecha del kanban (solo pantallas anchas). Dos piezas:
 *
 *  1. Mini-calendario del mes: marca de un vistazo los días "ocupados"
 *     (con tareas que tienen fecha de entrega). Al pinchar un día:
 *       - si tiene 1 tarea  → abre esa tarea directamente.
 *       - si tiene varias   → las lista debajo para elegir.
 *
 *  2. Tablón de notas (post-its) persistido por usuario vía
 *     /api/v1/me/panel-notes.
 *
 * Es puramente personal: el calendario usa las tareas ya cargadas en el
 * panel y las notas son privadas del usuario.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { UiTask } from "@/lib/db/queries";
import { ChevronLeft, ChevronRight, Plus, Trash2, StickyNote, CalendarDays, Loader2, CalendarRange } from "lucide-react";

// ---- Helpers de fecha (local, sin saltos de zona horaria) ----------
function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Lunes (00:00) de la semana de `d`. Semana ES = lunes→domingo.
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // lunes = 0
  x.setDate(x.getDate() - dow);
  return x;
}

function buildMonth(year: number, month: number) {
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ---- Notas: paleta de colores -------------------------------------
type NoteColor = "amber" | "sky" | "rose" | "emerald" | "violet" | "slate";

// Post-it: pastel un punto más saturado (-100) con borde definido (-300)
// para que destaquen como notas de papel sobre el fondo oscuro del dock.
const NOTE_STYLES: Record<NoteColor, string> = {
  amber: "bg-amber-100 border-amber-300",
  sky: "bg-sky-100 border-sky-300",
  rose: "bg-rose-100 border-rose-300",
  emerald: "bg-emerald-100 border-emerald-300",
  violet: "bg-violet-100 border-violet-300",
  slate: "bg-slate-100 border-slate-300"
};

const NOTE_DOTS: Record<NoteColor, string> = {
  amber: "bg-amber-400",
  sky: "bg-sky-400",
  rose: "bg-rose-400",
  emerald: "bg-emerald-400",
  violet: "bg-violet-400",
  slate: "bg-slate-400"
};

const COLOR_ORDER: NoteColor[] = ["amber", "sky", "rose", "emerald", "violet", "slate"];

type Note = { id: string; content: string; color: string; order: number };

export default function PanelDock({
  tasks,
  myUserId,
  onOpenTask
}: {
  tasks: UiTask[];
  myUserId?: string;
  onOpenTask: (t: UiTask) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const isoToday = isoLocal(today);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Semana visible en "Tareas de esta semana": 0 = esta semana, 1 = la
  // siguiente, -1 = la anterior… (se navega con las flechas).
  const [weekOffset, setWeekOffset] = useState(0);
  // Día sobre el que está el ratón en el calendario → muestra un popover
  // flotante con todas sus tareas sin necesidad de hacer click. Guardamos
  // la posición de la celda (rect) para anclar el cuadro con position:fixed
  // (así escapa de los overflow del dock).
  const [hover, setHover] = useState<{
    iso: string;
    left: number;
    top: number;
    bottom: number;
  } | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = useMemo(() => buildMonth(year, month), [year, month]);

  // Tareas con fecha agrupadas por día. Solo cuentan las que tienen
  // dueDate — sin fecha no ocupan un día en el calendario.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, UiTask[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const key = String(t.dueDate).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tasks]);

  // ¿Cuáles de esas tareas son MÍAS? Se resaltan más fuerte.
  const myDays = useMemo(() => {
    const set = new Set<string>();
    if (!myUserId) return set;
    for (const [day, list] of tasksByDay) {
      if (list.some((t) => t.assigneeIds?.includes(myUserId))) set.add(day);
    }
    return set;
  }, [tasksByDay, myUserId]);

  // Lunes de la semana visible (aplicando weekOffset) y su rango.
  const weekMonday = useMemo(() => {
    const m = startOfWeek(today);
    m.setDate(m.getDate() + weekOffset * 7);
    return m;
  }, [today, weekOffset]);
  const weekSunday = useMemo(() => {
    const s = new Date(weekMonday);
    s.setDate(s.getDate() + 6);
    return s;
  }, [weekMonday]);

  // Tareas de la semana visible (lunes→domingo) agrupadas por día, en orden.
  const weekDays = useMemo(() => {
    const days: { iso: string; date: Date; tasks: UiTask[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekMonday.getFullYear(), weekMonday.getMonth(), weekMonday.getDate() + i);
      const iso = isoLocal(date);
      const tasks = tasksByDay.get(iso) ?? [];
      if (tasks.length > 0) days.push({ iso, date, tasks });
    }
    return days;
  }, [tasksByDay, weekMonday]);

  const weekCount = useMemo(
    () => weekDays.reduce((sum, d) => sum + d.tasks.length, 0),
    [weekDays]
  );

  // Etiqueta de la semana visible: relativa cuando es cercana, si no el rango.
  const weekLabel = useMemo(() => {
    if (weekOffset === 0) return "Esta semana";
    if (weekOffset === 1) return "Próxima semana";
    if (weekOffset === -1) return "Semana pasada";
    const fmt = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    return `${fmt(weekMonday)} – ${fmt(weekSunday)}`;
  }, [weekOffset, weekMonday, weekSunday]);

  function handleDayClick(iso: string) {
    const list = tasksByDay.get(iso) ?? [];
    if (list.length === 0) {
      setSelectedDay((cur) => (cur === iso ? null : iso));
      return;
    }
    if (list.length === 1) {
      onOpenTask(list[0]);
      return;
    }
    setSelectedDay((cur) => (cur === iso ? null : iso));
  }

  const selectedTasks = selectedDay ? tasksByDay.get(selectedDay) ?? [] : [];

  return (
    // Columna fija oscura, mismo aire que la barra de navegación de la
    // izquierda (bg-slate-900). Las tarjetas internas son superficies un
    // punto más claras (slate-800) con texto claro.
    <aside className="hidden xl:flex w-80 shrink-0 flex-col gap-3 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">
      {/* ---- Mini calendario ---- */}
      <div className="rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <CalendarDays className="h-4 w-4 text-brand-400" />
            <span className="capitalize">
              {cursor.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setSelectedDay(null);
                setCursor(new Date(year, month - 1, 1));
              }}
              className="h-6 w-6 grid place-items-center rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setSelectedDay(null);
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
              }}
              className="text-[11px] px-1.5 py-1 rounded-md border border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            >
              Hoy
            </button>
            <button
              onClick={() => {
                setSelectedDay(null);
                setCursor(new Date(year, month + 1, 1));
              }}
              className="h-6 w-6 grid place-items-center rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 text-[10px] uppercase tracking-wide text-slate-500 px-2 pt-2">
          {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => (
            <div key={i} className="text-center py-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5 px-2 pb-2">
          {cells.map((date, idx) => {
            if (!date) return <div key={idx} />;
            const iso = isoLocal(date);
            const list = tasksByDay.get(iso) ?? [];
            const busy = list.length > 0;
            const isToday = iso === isoToday;
            const isSelected = iso === selectedDay;
            const mine = myDays.has(iso);
            return (
              <button
                key={idx}
                onClick={() => handleDayClick(iso)}
                onMouseEnter={(e) => {
                  if (!busy) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  setHover({ iso, left: r.left + r.width / 2, top: r.top, bottom: r.bottom });
                }}
                onMouseLeave={() => setHover((h) => (h?.iso === iso ? null : h))}
                className={
                  "relative h-9 rounded-md text-xs flex flex-col items-center justify-center transition " +
                  (isSelected
                    ? "bg-brand-600 text-white"
                    : isToday
                    ? "bg-brand-500/20 text-brand-300 font-semibold ring-1 ring-brand-500"
                    : busy
                    ? "bg-slate-700 hover:bg-slate-600 text-slate-100 font-medium"
                    : "hover:bg-slate-700 text-slate-400")
                }
              >
                <span>{date.getDate()}</span>
                {busy && (
                  <span
                    className={
                      "absolute bottom-1 h-1.5 w-1.5 rounded-full " +
                      (isSelected ? "bg-white" : mine ? "bg-brand-400" : "bg-slate-400")
                    }
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Lista del día seleccionado → click abre la tarea */}
        {selectedDay && (
          <div className="border-t border-slate-700 px-3 py-2">
            <div className="text-[11px] font-medium text-slate-400 mb-1.5">
              {new Date(selectedDay + "T00:00:00").toLocaleDateString("es-ES", {
                weekday: "long",
                day: "numeric",
                month: "long"
              })}
            </div>
            {selectedTasks.length === 0 ? (
              <div className="text-xs text-slate-500 py-1">Sin tareas este día.</div>
            ) : (
              <ul className="space-y-1">
                {selectedTasks.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => onOpenTask(t)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded-md text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                    >
                      <span
                        className={
                          "h-1.5 w-1.5 rounded-full shrink-0 " +
                          (t.priority === "urgencia"
                            ? "bg-rose-500"
                            : t.priority === "alta"
                            ? "bg-amber-500"
                            : "bg-slate-400")
                        }
                      />
                      <span className="truncate">{t.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ---- Tareas de la semana (con navegación entre semanas) ---- */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-slate-700 bg-slate-700/40 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-brand-300">
              <CalendarRange className="h-4 w-4" />
              Tareas de la semana
            </div>
            {weekCount > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-600 text-white">
                {weekCount}
              </span>
            )}
          </div>
          {/* Selector de semana: ◀ etiqueta ▶ (+ volver a "hoy" si no estás
              en la semana actual). */}
          <div className="flex items-center justify-between gap-1">
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              className="h-6 w-6 grid place-items-center rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700"
              aria-label="Semana anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-medium text-slate-200 truncate">{weekLabel}</span>
              {weekOffset !== 0 && (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-slate-200 shrink-0"
                >
                  Hoy
                </button>
              )}
            </div>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              className="h-6 w-6 grid place-items-center rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700"
              aria-label="Semana siguiente"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {weekDays.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-500 text-center">
            {weekOffset === 0
              ? "No tienes tareas con fecha esta semana. 🎉"
              : "No hay tareas con fecha en esta semana."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {weekDays.map(({ iso, date, tasks }) => {
              const isToday = iso === isoToday;
              return (
                <li key={iso} className="px-3 py-2">
                  <div
                    className={
                      "text-[11px] font-medium mb-1 flex items-center gap-1.5 " +
                      (isToday ? "text-amber-300" : "text-slate-400")
                    }
                  >
                    <span className="capitalize">
                      {date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" })}
                    </span>
                    {isToday && (
                      <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-semibold">
                        Hoy
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {tasks.map((t) => (
                      <li key={t.id}>
                        <button
                          onClick={() => onOpenTask(t)}
                          className={
                            "w-full text-left text-xs px-2 py-1.5 rounded-md flex items-center gap-2 border-l-2 transition " +
                            (isToday
                              ? "border-amber-400 bg-amber-400/15 hover:bg-amber-400/25 text-amber-50 font-medium"
                              : "border-slate-600 text-slate-200 hover:bg-slate-700")
                          }
                        >
                          <span
                            className={
                              "h-1.5 w-1.5 rounded-full shrink-0 " +
                              (t.priority === "urgencia"
                                ? "bg-rose-500"
                                : t.priority === "alta"
                                ? "bg-amber-500"
                                : "bg-slate-400")
                            }
                          />
                          <span className="truncate">{t.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---- Tablón de notas ---- */}
      <NotesBoard />

      {/* Popover flotante al pasar el ratón por un día con tareas. Se ancla
          con position:fixed a la celda; si el día está muy arriba, el cuadro
          sale por debajo en vez de por encima. pointer-events-none para que
          no provoque parpadeo del hover. */}
      {hover &&
        (() => {
          const list = tasksByDay.get(hover.iso) ?? [];
          if (list.length === 0) return null;
          const below = hover.top < 260;
          return (
            <div
              style={{
                position: "fixed",
                left: hover.left,
                top: below ? hover.bottom + 6 : hover.top - 6,
                transform: below ? "translate(-50%, 0)" : "translate(-50%, -100%)"
              }}
              className="z-[60] w-52 pointer-events-none rounded-lg border border-slate-700 bg-slate-800 shadow-xl p-2"
            >
              <div className="text-[11px] font-semibold text-slate-200 mb-1 capitalize">
                {new Date(hover.iso + "T00:00:00").toLocaleDateString("es-ES", {
                  weekday: "long",
                  day: "numeric",
                  month: "long"
                })}
              </div>
              <ul className="space-y-1 max-h-56 overflow-hidden">
                {list.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-xs text-slate-200">
                    <span
                      className={
                        "h-1.5 w-1.5 rounded-full shrink-0 " +
                        (t.priority === "urgencia"
                          ? "bg-rose-500"
                          : t.priority === "alta"
                          ? "bg-amber-500"
                          : "bg-slate-400")
                      }
                    />
                    <span className="truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
    </aside>
  );
}

// ====================================================================
// Tablón de notas
// ====================================================================
function NotesBoard() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let aborted = false;
    fetch("/api/v1/me/panel-notes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (aborted || !d) return;
        setNotes(d.items ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, []);

  async function addNote() {
    setCreating(true);
    try {
      const r = await fetch("/api/v1/me/panel-notes", { method: "POST" });
      if (r.ok) {
        const note = await r.json();
        setNotes((prev) => [...prev, note]);
      }
    } finally {
      setCreating(false);
    }
  }

  function patchLocal(id: string, patch: Partial<Note>) {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  async function saveNote(id: string, patch: Partial<Pick<Note, "content" | "color">>) {
    await fetch(`/api/v1/me/panel-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }).catch(() => {});
  }

  async function deleteNote(id: string) {
    const prev = notes;
    setNotes((p) => p.filter((n) => n.id !== id));
    const r = await fetch(`/api/v1/me/panel-notes/${id}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) setNotes(prev); // revertir si falla
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
          <StickyNote className="h-4 w-4 text-amber-400" />
          Tablón de notas
        </div>
        <button
          onClick={addNote}
          disabled={creating}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Nota
        </button>
      </div>

      <div className="p-3 space-y-2">
        {loading ? (
          <div className="text-xs text-slate-500 py-2 flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando notas…
          </div>
        ) : notes.length === 0 ? (
          <div className="text-xs text-slate-500 py-3 text-center">
            Sin notas. Pulsa <span className="font-medium text-slate-400">+ Nota</span> para crear una.
          </div>
        ) : (
          notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              onChange={(patch) => patchLocal(n.id, patch)}
              onSave={(patch) => saveNote(n.id, patch)}
              onDelete={() => deleteNote(n.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NoteCard({
  note,
  onChange,
  onSave,
  onDelete
}: {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  onSave: (patch: Partial<Pick<Note, "content" | "color">>) => void;
  onDelete: () => void;
}) {
  const color = (COLOR_ORDER.includes(note.color as NoteColor) ? note.color : "amber") as NoteColor;
  // Autoguardado con debounce al escribir; guardado inmediato al perder foco.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleSave(content: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onSave({ content }), 700);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className={"rounded-lg border p-2 shadow-md " + NOTE_STYLES[color]}>
      <textarea
        value={note.content}
        onChange={(e) => {
          onChange({ content: e.target.value });
          scheduleSave(e.target.value);
        }}
        onBlur={(e) => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          onSave({ content: e.target.value });
        }}
        placeholder="Escribe una nota…"
        rows={3}
        className="w-full resize-y bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
      />
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-1">
          {COLOR_ORDER.map((c) => (
            <button
              key={c}
              onClick={() => {
                onChange({ color: c });
                onSave({ color: c });
              }}
              aria-label={`Color ${c}`}
              className={
                "h-3.5 w-3.5 rounded-full transition " +
                NOTE_DOTS[c] +
                (c === color ? " ring-2 ring-offset-1 ring-slate-400" : " opacity-60 hover:opacity-100")
              }
            />
          ))}
        </div>
        <button
          onClick={onDelete}
          aria-label="Borrar nota"
          className="text-slate-400 hover:text-rose-500 p-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
