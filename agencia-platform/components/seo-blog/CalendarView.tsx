"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Nav } from "./SeoBlogApp";
import { api, Btn, STATUS, StatusBadge, todayISO } from "./ui";

const WEEK = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function CalendarView({ nav }: { nav: Nav }) {
  const [month, setMonth] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [events, setEvents] = useState<any[]>([]);
  const [ideas, setIdeas] = useState<any[]>([]);
  const [dragOver, setDragOver] = useState("");
  const [msg, setMsg] = useState("");

  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  const load = async () => {
    const from = new Date(days[0].getTime() - 86400e3).toISOString();
    const to = new Date(days[41].getTime() + 2 * 86400e3).toISOString();
    const q = nav.siteId ? `&siteId=${nav.siteId}` : "";
    const [cal, props] = await Promise.all([
      api(`/calendar?from=${from}&to=${to}${q}`),
      api(`/posts?status=propuesta${q}`)
    ]);
    setEvents(cal.items);
    setIdeas(props.items);
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, nav.siteId]);

  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of events) {
      const d = String(e.publishAtLocal ?? "").slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(e);
    }
    return m;
  }, [events]);

  const drop = async (day: string, data: string) => {
    setDragOver("");
    const [kind, id] = data.split(":");
    const ev = kind === "ev" ? events.find((e) => e.id === id) : null;
    if (ev?.status === "publicada") return;
    const time = ev ? String(ev.publishAtLocal).slice(11, 16) : "";
    try {
      await api(`/posts/${id}/action`, { method: "POST", body: { action: "schedule", publishAt: time ? `${day} ${time}` : day } });
      setMsg(ev?.status === "programada" ? "Movido · se actualizará la fecha en la web del cliente" : `Planificado para el ${day}`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const today = todayISO();
  const title = month.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  return (
    <div className="grid lg:grid-cols-[250px_1fr] gap-4">
      <aside className="bg-white rounded-xl border p-3 lg:sticky lg:top-4 self-start max-h-[80vh] overflow-auto">
        <h4 className="font-semibold text-sm">Propuestas ({ideas.length})</h4>
        <p className="text-xs text-slate-500 mb-2">Arrástralas a un día del calendario.</p>
        {ideas.map((p) => (
          <div key={p.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `idea:${p.id}`)}
            className="mb-2 cursor-grab rounded-lg border-l-4 bg-amber-50/60 px-2.5 py-2 text-xs font-medium hover:bg-amber-100" style={{ borderLeftColor: p.color }}>
            <span className="block text-[10px] font-semibold" style={{ color: p.color }}>{p.clientName}</span>
            {p.title}
          </div>
        ))}
        {!ideas.length && <p className="text-xs text-slate-400">Sin propuestas pendientes. <button className="text-amber-700 underline" onClick={() => nav.go("propuestas")}>Genera nuevas</button>.</p>}
      </aside>
      <section className="bg-white rounded-xl border p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Btn variant="ghost" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Btn>
          <Btn variant="ghost" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Btn>
          <Btn variant="ghost" size="sm" onClick={() => { const t = new Date(); setMonth(new Date(t.getFullYear(), t.getMonth(), 1)); }}>Hoy</Btn>
          <h3 className="font-semibold capitalize flex-1 text-center">{title}</h3>
          <div className="flex flex-wrap gap-1">{["planificada", "generando", "revision", "programada", "publicada", "error"].map((s) => <StatusBadge key={s} status={s} />)}</div>
        </div>
        {msg && <p className="text-xs text-slate-600 mb-2">{msg}</p>}
        <div className="grid grid-cols-7 text-[11px] font-semibold text-slate-500 border-b">
          {WEEK.map((d) => <div key={d} className="px-1.5 py-1 text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const key = ymd(d);
            const list = byDay.get(key) ?? [];
            const out = d.getMonth() !== month.getMonth();
            const past = key < today;
            return (
              <div key={key}
                onDragOver={(e) => { if (!past) { e.preventDefault(); setDragOver(key); } }}
                onDragLeave={() => setDragOver("")}
                onDrop={(e) => { e.preventDefault(); if (!past) drop(key, e.dataTransfer.getData("text/plain")); }}
                className={clsx("min-h-[108px] border-b border-r p-1 align-top", out && "bg-slate-50/70", key === today && "bg-amber-50", dragOver === key && "ring-2 ring-inset ring-amber-400")}>
                <div className={clsx("text-right text-[11px] mb-1", out ? "text-slate-300" : "text-slate-500", key === today && "font-bold text-amber-700")}>{d.getDate()}</div>
                <div className="space-y-1">
                  {list.map((e) => (
                    <button key={e.id} draggable={e.status !== "publicada"}
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", `ev:${e.id}`)}
                      onClick={() => nav.openPost(e.id)}
                      className="w-full text-left rounded-md px-1.5 py-1 text-[11px] leading-tight text-white shadow-sm hover:brightness-110"
                      style={{ background: e.color, borderLeft: `3px solid ${(STATUS[e.status] ?? STATUS.propuesta).dot}` }}
                      title={`${e.title} · ${(STATUS[e.status] ?? STATUS.propuesta).label}`}>
                      <span className="font-semibold">{String(e.publishAtLocal).slice(11, 16)}</span> {e.title}
                      <span className="block opacity-80 text-[10px]">{e.clientName}{e.seoScore ? ` · SEO ${e.seoScore}` : ""} · {(STATUS[e.status] ?? STATUS.propuesta).label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
