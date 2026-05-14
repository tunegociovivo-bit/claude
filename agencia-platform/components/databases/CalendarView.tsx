"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DbDetail, DbRecord } from "@/lib/db/types";

function buildMonth(year: number, month: number) {
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function CalendarView({
  db,
  records,
  dateProperty,
  onChangeDateProperty
}: {
  db: DbDetail;
  records: DbRecord[];
  dateProperty: string | null;
  onChangeDateProperty: (propertyId: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const dateProps = db.properties.filter((p) => p.type === "DATE");
  const dateProp = dateProps.find((p) => p.id === dateProperty) ?? dateProps[0];

  if (!dateProp) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-sm text-slate-500">
        Para usar la vista calendario necesitas al menos una propiedad de tipo <strong>Fecha</strong>.
      </div>
    );
  }

  const cells = buildMonth(cursor.getFullYear(), cursor.getMonth());
  const recordsByDay = new Map<string, DbRecord[]>();
  for (const r of records) {
    const v = r.values[dateProp.id];
    if (!v) continue;
    const day = String(v).slice(0, 10);
    if (!recordsByDay.has(day)) recordsByDay.set(day, []);
    recordsByDay.get(day)!.push(r);
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="h-8 w-8 grid place-items-center rounded-md border hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold capitalize">
            {cursor.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
          </h2>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="h-8 w-8 grid place-items-center rounded-md border hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Fecha:</span>
          <select
            value={dateProp.id}
            onChange={(e) => onChangeDateProperty(e.target.value)}
            className="px-2 py-1 rounded-md bg-white border text-xs font-medium"
          >
            {dateProps.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
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
          const iso = cell.toISOString().slice(0, 10);
          const dayRecs = recordsByDay.get(iso) ?? [];
          const isToday = iso === todayIso;
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
                  {cell.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {dayRecs.slice(0, 3).map((r) => (
                  <div
                    key={r.id}
                    className="text-[11px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 truncate"
                    title={r.title}
                  >
                    {r.title}
                  </div>
                ))}
                {dayRecs.length > 3 && (
                  <div className="text-[10px] text-slate-500">+{dayRecs.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
