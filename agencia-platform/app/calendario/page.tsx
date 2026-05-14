import PageHeader from "@/components/PageHeader";
import { events, getClient, type CalendarEvent } from "@/lib/mock-data";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";

const typeStyles: Record<CalendarEvent["type"], string> = {
  publicacion: "bg-sky-100 text-sky-800 border-sky-300",
  reunion: "bg-indigo-100 text-indigo-800 border-indigo-300",
  deadline: "bg-rose-100 text-rose-800 border-rose-300",
  campaña: "bg-emerald-100 text-emerald-800 border-emerald-300"
};

const typeLabels: Record<CalendarEvent["type"], string> = {
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

export default function CalendarioPage() {
  const today = new Date("2026-05-14");
  const year = today.getFullYear();
  const month = today.getMonth();
  const cells = buildMonth(year, month);

  const eventsByDay = new Map<string, CalendarEvent[]>();
  events.forEach((e) => {
    if (!eventsByDay.has(e.date)) eventsByDay.set(e.date, []);
    eventsByDay.get(e.date)!.push(e);
  });

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Calendario"
        description="Planifica publicaciones, reuniones y entregas."
        actions={
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
            <Plus className="h-4 w-4" />
            Nuevo evento
          </button>
        }
      />

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <button className="h-8 w-8 grid place-items-center rounded-md border hover:bg-slate-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold capitalize">
              {today.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
            </h2>
            <button className="h-8 w-8 grid place-items-center rounded-md border hover:bg-slate-50">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {(Object.keys(typeLabels) as CalendarEvent["type"][]).map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm border ${typeStyles[k]}`} />
                <span className="text-slate-600">{typeLabels[k]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-7 text-xs uppercase tracking-wide text-slate-500 border-b">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
            <div key={d} className="px-3 py-2 border-r last:border-r-0">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 auto-rows-[110px]">
          {cells.map((cell, idx) => {
            if (!cell) return <div key={idx} className="border-r border-b last:border-r-0 bg-slate-50/30" />;
            const iso = cell.date.toISOString().slice(0, 10);
            const dayEvents = eventsByDay.get(iso) ?? [];
            const isToday = iso === "2026-05-14";
            return (
              <div key={idx} className="border-r border-b last:border-r-0 p-1.5 overflow-hidden">
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
                  {dayEvents.slice(0, 2).map((e) => (
                    <div
                      key={e.id}
                      className={`text-[11px] px-1.5 py-0.5 rounded border truncate ${typeStyles[e.type]}`}
                      title={e.title}
                    >
                      {e.time && <span className="font-medium">{e.time} </span>}
                      {e.title}
                    </div>
                  ))}
                  {dayEvents.length > 2 && (
                    <div className="text-[11px] text-slate-500 pl-1.5">+{dayEvents.length - 2} más</div>
                  )}
                </div>
              </div>
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
              return d >= today && d <= new Date("2026-05-20");
            })
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((e) => {
              const client = getClient(e.clientId);
              return (
                <div key={e.id} className="p-4 flex items-center gap-4">
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
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
