"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import type { UiTask, UiMember } from "@/lib/db/queries";
import { Plane, CalendarDays, MessageSquare, Loader2, Send, Lock, ChevronLeft, ChevronRight } from "lucide-react";

type Tab = "vacaciones" | "tareas" | "chat";

type Vacation = {
  id: string;
  userId: string;
  date: string;
  note: string | null;
  locked: boolean;
  user: { id: string; name: string | null; email: string; image: string | null };
};

type TeamMessage = {
  id: string;
  body: string;
  references: Array<{ kind: "task" | "project"; id: string }> | null;
  createdAt: string;
  author: { id: string; name: string | null; email: string; image: string | null };
};

export default function EquipoClient({
  team,
  teamTasks,
  currentUserId
}: {
  team: UiMember[];
  teamTasks: UiTask[];
  currentUserId: string | null;
}) {
  const [tab, setTab] = useState<Tab>("vacaciones");
  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)]">
      <PageHeader
        title="Equipo"
        description="Vacaciones, calendario común y chat del equipo."
      />
      <div className="flex items-center gap-1 mb-4 border-b">
        <TabButton active={tab === "vacaciones"} onClick={() => setTab("vacaciones")} icon={<Plane className="h-4 w-4" />}>
          Vacaciones
        </TabButton>
        <TabButton active={tab === "tareas"} onClick={() => setTab("tareas")} icon={<CalendarDays className="h-4 w-4" />}>
          Tareas comunes
        </TabButton>
        <TabButton active={tab === "chat"} onClick={() => setTab("chat")} icon={<MessageSquare className="h-4 w-4" />}>
          Chat
        </TabButton>
      </div>

      {tab === "vacaciones" && <VacacionesTab team={team} currentUserId={currentUserId} />}
      {tab === "tareas" && <TareasComunesTab team={team} tasks={teamTasks} />}
      {tab === "chat" && <ChatTab currentUserId={currentUserId} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition " +
        (active
          ? "border-brand-600 text-brand-700 font-medium"
          : "border-transparent text-slate-500 hover:text-slate-900")
      }
    >
      {icon}
      {children}
    </button>
  );
}

// ============================================================
// Vacaciones
// ============================================================

function VacacionesTab({ team, currentUserId }: { team: UiMember[]; currentUserId: string | null }) {
  const [items, setItems] = useState<Vacation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  // Vista: "month" = el calendario mensual, "year" = 12 minigrids para
  // ver vacaciones de un vistazo. Filtro: "all" = todos los miembros,
  // o un userId concreto para aislar la agenda de uno.
  const [view, setView] = useState<"month" | "year">("month");
  const [filterUser, setFilterUser] = useState<string>("all");
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  async function load() {
    setLoading(true);
    // En vista anual cargamos los 12 meses del año actual de cursor.
    // En mensual, sólo ese mes (más rápido).
    const from =
      view === "year"
        ? new Date(year, 0, 1).toISOString().slice(0, 10)
        : new Date(year, month, 1).toISOString().slice(0, 10);
    const to =
      view === "year"
        ? new Date(year, 11, 31).toISOString().slice(0, 10)
        : new Date(year, month + 1, 0).toISOString().slice(0, 10);
    const r = await fetch(`/api/v1/team/vacations?from=${from}&to=${to}`);
    if (r.ok) {
      const d = await r.json();
      setItems(d.items ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, view]);

  // Filtra por usuario seleccionado antes de mapear por día.
  const filteredItems = useMemo(
    () => (filterUser === "all" ? items : items.filter((v) => v.userId === filterUser)),
    [items, filterUser]
  );

  // Mapa fecha → array de vacaciones de ese día
  const byDay = useMemo(() => {
    const map = new Map<string, Vacation[]>();
    filteredItems.forEach((v) => {
      if (!map.has(v.date)) map.set(v.date, []);
      map.get(v.date)!.push(v);
    });
    return map;
  }, [filteredItems]);

  async function toggleMyDay(iso: string) {
    if (!currentUserId) return;
    const date = new Date(iso + "T00:00:00");
    if (date < today) return; // bloqueado
    const mine = byDay.get(iso)?.find((v) => v.userId === currentUserId);
    setSaving(true);
    if (mine) {
      await fetch(`/api/v1/team/vacations?date=${iso}`, { method: "DELETE" });
    } else {
      await fetch("/api/v1/team/vacations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates: [iso] })
      });
    }
    await load();
    setSaving(false);
  }

  const cells = useMemo(() => buildMonth(year, month), [year, month]);

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b flex-wrap">
        <h2 className="text-sm font-semibold">
          {view === "year"
            ? year
            : new Date(year, month, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro por trabajador */}
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="px-2 py-1.5 rounded-md border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">Todos los trabajadores</option>
            {[...team]
              .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"))
              .map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
          </select>

          {/* Toggle vista mensual / anual */}
          <div className="inline-flex rounded-md border bg-white text-xs">
            <button
              type="button"
              onClick={() => setView("month")}
              className={"px-2.5 py-1 rounded-l-md " + (view === "month" ? "bg-brand-50 text-brand-700 font-medium" : "text-slate-500 hover:bg-slate-50")}
            >
              Mes
            </button>
            <button
              type="button"
              onClick={() => setView("year")}
              className={"px-2.5 py-1 rounded-r-md border-l " + (view === "year" ? "bg-brand-50 text-brand-700 font-medium" : "text-slate-500 hover:bg-slate-50")}
            >
              Año
            </button>
          </div>

          {/* Navegación temporal — paso = mes o año según vista */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCursor(view === "year" ? new Date(year - 1, 0, 1) : new Date(year, month - 1, 1))}
              className="h-7 w-7 grid place-items-center rounded-md border bg-white hover:bg-slate-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setCursor(view === "year" ? new Date(today.getFullYear(), 0, 1) : new Date(today.getFullYear(), today.getMonth(), 1))}
              className="px-2 py-1 rounded-md border bg-white text-xs hover:bg-slate-50"
            >
              Hoy
            </button>
            <button
              onClick={() => setCursor(view === "year" ? new Date(year + 1, 0, 1) : new Date(year, month + 1, 1))}
              className="h-7 w-7 grid place-items-center rounded-md border bg-white hover:bg-slate-50"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {view === "year" ? (
        <YearGrid
          year={year}
          today={today}
          byDay={byDay}
          currentUserId={currentUserId}
          filterUser={filterUser}
          onPickDay={async (iso) => {
            await toggleMyDay(iso);
          }}
          onJumpToMonth={(m) => {
            setView("month");
            setCursor(new Date(year, m, 1));
          }}
        />
      ) : (
        <>
      <div className="grid grid-cols-7 text-xs uppercase tracking-wide text-slate-500 border-b">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
          <div key={d} className="px-3 py-2 border-r last:border-r-0">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-[100px]">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={idx} className="border-r border-b last:border-r-0 bg-slate-50/30" />;
          const iso = cell.date.toISOString().slice(0, 10);
          const dayVacs = byDay.get(iso) ?? [];
          const isPast = cell.date < today;
          const mine = dayVacs.find((v) => v.userId === currentUserId);
          return (
            <div
              key={idx}
              role={isPast ? undefined : "button"}
              tabIndex={isPast ? undefined : 0}
              onClick={() => !isPast && toggleMyDay(iso)}
              className={
                "border-r border-b last:border-r-0 p-1.5 overflow-hidden transition " +
                (isPast
                  ? "bg-slate-50/40 cursor-not-allowed"
                  : mine
                    ? "bg-emerald-50 hover:bg-emerald-100 cursor-pointer"
                    : "hover:bg-slate-50 cursor-pointer")
              }
              title={
                isPast
                  ? "Fecha pasada — bloqueada"
                  : mine
                    ? "Click para quitar tu día de vacaciones"
                    : "Click para marcar como tu día de vacaciones"
              }
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className={isPast ? "text-slate-400" : "text-slate-700 font-medium"}>{cell.date.getDate()}</span>
                {isPast && dayVacs.length > 0 && <Lock className="h-3 w-3 text-slate-400" />}
              </div>
              <div className="space-y-0.5">
                {dayVacs.slice(0, 3).map((v) => {
                  const isMine = v.userId === currentUserId;
                  return (
                    <div
                      key={v.id}
                      className={
                        "text-[10px] px-1.5 py-0.5 rounded truncate " +
                        (isMine ? "bg-emerald-600 text-white font-semibold" : "bg-emerald-100 text-emerald-800")
                      }
                      title={v.user.name || v.user.email}
                    >
                      {v.user.name?.split(" ")[0] ?? v.user.email}
                    </div>
                  );
                })}
                {dayVacs.length > 3 && <div className="text-[10px] text-slate-500">+{dayVacs.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}

      <div className="px-4 py-3 border-t bg-slate-50/50 text-xs text-slate-600 flex items-center justify-between flex-wrap gap-2">
        <span>
          Click en un día futuro para marcarlo como vacaciones. Días pasados quedan bloqueados.
        </span>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
        {loading && !saving && <span className="text-slate-400">Cargando…</span>}
      </div>
    </div>
  );
}

// Vista anual: 12 mini-grids de mes, marcando cada día con un punto
// según si hay vacaciones (verde) o no. Click en día futuro toggle
// directo. Click en el título del mes → salta a vista mensual.
function YearGrid({
  year,
  today,
  byDay,
  currentUserId,
  filterUser,
  onPickDay,
  onJumpToMonth
}: {
  year: number;
  today: Date;
  byDay: Map<string, Vacation[]>;
  currentUserId: string | null;
  filterUser: string;
  onPickDay: (iso: string) => void;
  onJumpToMonth: (m: number) => void;
}) {
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 12 }).map((_, m) => {
        const monthName = new Date(year, m, 1).toLocaleDateString("es-ES", { month: "long" });
        const cells = buildMonth(year, m);
        return (
          <div key={m} className="border rounded-lg overflow-hidden bg-slate-50/30">
            <button
              type="button"
              onClick={() => onJumpToMonth(m)}
              className="w-full px-2 py-1.5 text-xs font-semibold text-left capitalize bg-white border-b hover:bg-slate-50"
            >
              {monthName}
            </button>
            <div className="grid grid-cols-7 text-[9px] text-slate-400 px-1 pt-1">
              {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => (
                <div key={i} className="text-center">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px p-1">
              {cells.map((cell, idx) => {
                if (!cell) return <div key={idx} className="h-6" />;
                const iso = cell.date.toISOString().slice(0, 10);
                const dayVacs = byDay.get(iso) ?? [];
                const isPast = cell.date < today;
                const mine = dayVacs.find((v) => v.userId === currentUserId);
                const hasAny = dayVacs.length > 0;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isPast || (filterUser !== "all" && filterUser !== currentUserId)}
                    onClick={() => onPickDay(iso)}
                    title={
                      hasAny
                        ? dayVacs.map((v) => v.user.name || v.user.email).join(", ")
                        : isPast
                          ? "Pasado"
                          : "Click para marcar"
                    }
                    className={
                      "h-6 text-[10px] rounded transition flex items-center justify-center " +
                      (isPast
                        ? "text-slate-300 cursor-not-allowed"
                        : "hover:ring-1 hover:ring-brand-400 cursor-pointer ") +
                      (mine
                        ? "bg-emerald-600 text-white font-semibold"
                        : hasAny
                          ? "bg-emerald-100 text-emerald-800"
                          : "text-slate-600")
                    }
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

// ============================================================
// Tareas comunes
// ============================================================

function TareasComunesTab({ team, tasks }: { team: UiMember[]; tasks: UiTask[] }) {
  const router = useRouter();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = useMemo(() => buildMonth(year, month), [year, month]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, UiTask[]>();
    tasks.forEach((t) => {
      if (!t.dueDate) return;
      if (!map.has(t.dueDate)) map.set(t.dueDate, []);
      map.get(t.dueDate)!.push(t);
    });
    return map;
  }, [tasks]);

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h2 className="text-sm font-semibold">
            {new Date(year, month, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Sólo tareas de trabajadores. Las tareas internas del admin (admin solo) no aparecen.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="h-7 w-7 grid place-items-center rounded-md border bg-white hover:bg-slate-50"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="px-2 py-1 rounded-md border bg-white text-xs hover:bg-slate-50"
          >
            Hoy
          </button>
          <button
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="h-7 w-7 grid place-items-center rounded-md border bg-white hover:bg-slate-50"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
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
          const dayTasks = tasksByDay.get(iso) ?? [];
          return (
            <div key={idx} className="border-r border-b last:border-r-0 p-1.5 overflow-hidden">
              <div className="text-xs font-medium text-slate-700 mb-1">{cell.date.getDate()}</div>
              <div className="space-y-1">
                {dayTasks.slice(0, 3).map((t) => {
                  const initials = t.assigneeIds
                    .map((id) => team.find((m) => m.id === id))
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((m) => (m as UiMember).name?.[0]?.toUpperCase() ?? "?")
                    .join("");
                  return (
                    <div
                      key={t.id}
                      onClick={() => router.push(`/tareas?task=${t.id}`)}
                      className="text-[11px] px-1.5 py-0.5 rounded border truncate cursor-pointer hover:opacity-80 bg-indigo-50 text-indigo-800 border-indigo-200"
                      title={`${t.title} — ${initials}`}
                    >
                      {t.dueTime && <span className="font-medium">{t.dueTime} </span>}
                      <span className="font-medium">{initials}</span> {t.title}
                    </div>
                  );
                })}
                {dayTasks.length > 3 && (
                  <div className="text-[10px] text-slate-500">+{dayTasks.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Chat del equipo
// ============================================================

function ChatTab({ currentUserId }: { currentUserId: string | null }) {
  const router = useRouter();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/team/messages?limit=100");
    if (r.ok) {
      const d = await r.json();
      setMessages(d.items ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    const r = await fetch("/api/v1/team/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body })
    });
    setSending(false);
    if (r.ok) {
      const newMsg = await r.json();
      setMessages((m) => [...m, newMsg]);
      setText("");
    }
  }

  return (
    <div className="bg-white rounded-xl border overflow-hidden flex flex-col" style={{ height: "calc(100vh - 18rem)" }}>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && (
          <div className="text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-center text-sm text-slate-500 py-8">
            Aún no hay mensajes. Escribe el primero abajo.
          </div>
        )}
        {messages.map((m) => {
          const mine = m.author.id === currentUserId;
          return (
            <div key={m.id} className={"flex gap-2 " + (mine ? "justify-end" : "")}>
              {!mine && (
                <div className="h-8 w-8 rounded-full bg-brand-500 text-white grid place-items-center text-xs font-semibold shrink-0">
                  {(m.author.name || m.author.email).slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className={"max-w-[70%] " + (mine ? "items-end" : "items-start") + " flex flex-col"}>
                <div className="text-[10px] text-slate-500 mb-0.5">
                  {!mine && <span className="font-medium text-slate-700">{m.author.name || m.author.email} · </span>}
                  {new Date(m.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
                <div
                  className={
                    "px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words " +
                    (mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800")
                  }
                >
                  {renderBody(m.body, router, mine)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="border-t p-3 bg-slate-50/50">
        <div className="flex gap-2 items-end">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Mensaje al equipo. Usa #tarea:ID o #proyecto:ID para enlazar."
            className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
          <button
            onClick={send}
            disabled={sending || !text.trim()}
            className="h-10 w-10 grid place-items-center rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
            title="Enviar (Ctrl/Cmd + Enter)"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// Reemplaza los tokens "#tarea:ID" y "#proyecto:ID" por links clicables.
function renderBody(body: string, router: ReturnType<typeof useRouter>, mine: boolean) {
  const parts: React.ReactNode[] = [];
  const re = /#(tarea|proyecto):([a-zA-Z0-9_-]{4,40})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    const kind = m[1].toLowerCase();
    const id = m[2];
    const href = kind === "tarea" ? `/tareas?task=${id}` : `/tareas?project=${id}`;
    parts.push(
      <button
        key={`r-${idx++}`}
        onClick={(e) => {
          e.preventDefault();
          router.push(href);
        }}
        className={
          "underline underline-offset-2 font-medium " +
          (mine ? "text-white/90 hover:text-white" : "text-brand-700 hover:text-brand-900")
        }
      >
        #{kind}:{id}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts.length > 0 ? parts : body;
}
