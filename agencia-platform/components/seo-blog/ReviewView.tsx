"use client";

import { useEffect, useState } from "react";
import type { Nav } from "./SeoBlogApp";
import { api, Empty, fmtDate, Score, StatusBadge } from "./ui";

export default function ReviewView({ nav }: { nav: Nav }) {
  const [data, setData] = useState<{ rev: any[]; work: any[]; done: any[] } | null>(null);
  const load = async () => {
    const q = nav.siteId ? `&siteId=${nav.siteId}` : "";
    const [rev, work, done] = await Promise.all([
      api(`/posts?status=revision${q}`),
      api(`/posts?status=en_cola,generando,error${q}`),
      api(`/posts?status=aprobada,programada,publicada${q}`)
    ]);
    setData({ rev: rev.items, work: work.items, done: done.items.slice(0, 30) });
  };
  useEffect(() => {
    load().catch(() => null);
    const t = setInterval(() => load().catch(() => null), 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.siteId]);

  const Grid = ({ items }: { items: any[] }) => (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map((p) => (
        <button key={p.id} onClick={() => nav.openPost(p.id)} className="text-left bg-white rounded-xl border p-3 hover:shadow-md transition border-l-4" style={{ borderLeftColor: p.color }}>
          <div className="flex items-center gap-2 mb-1"><StatusBadge status={p.status} /><Score value={p.seoScore} />{p.words ? <span className="text-[11px] text-slate-500">{p.words} palabras</span> : null}</div>
          <div className="font-medium text-sm leading-snug">{p.title}</div>
          <div className="text-xs text-slate-500 mt-0.5">{p.clientName} · {fmtDate(p.publishAt)}</div>
          {["generando", "en_cola"].includes(p.status) && <div className="text-xs text-violet-700 font-medium mt-1">⏳ {p.stepLabel || "En cola"}</div>}
          {p.error && <div className="text-xs text-rose-600 mt-1 line-clamp-2">{p.error}</div>}
        </button>
      ))}
    </div>
  );

  if (!data) return <p className="text-sm text-slate-400">Cargando…</p>;
  return (
    <div className="space-y-6">
      <section><h3 className="font-semibold mb-2">Pendientes de revisar ({data.rev.length})</h3>{data.rev.length ? <Grid items={data.rev} /> : <Empty>Nada pendiente de revisión 🎉</Empty>}</section>
      <section><h3 className="font-semibold mb-2">En producción ({data.work.length})</h3>{data.work.length ? <Grid items={data.work} /> : <Empty>Nada en producción.</Empty>}</section>
      <section><h3 className="font-semibold mb-2">Aprobados, programados y publicados</h3>{data.done.length ? <Grid items={data.done} /> : <Empty>—</Empty>}</section>
    </div>
  );
}
