"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";

/** Indicador del gasto de IA: total del mes en curso y total de hoy. */
export default function AiSpendBadge() {
  const [s, setS] = useState<{ monthMicros: number; todayMicros: number } | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/v1/ai-spend", { cache: "no-store" });
        if (r.ok && !stop) setS(await r.json());
      } catch {}
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (!s) return null;
  const fmt = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-xs"
      title="Gasto de la IA (Sonia + asistentes) en el workspace"
    >
      <Bot className="h-4 w-4 text-violet-600 shrink-0" />
      <span className="text-slate-500">IA</span>
      <span className="font-semibold text-slate-900">{fmt(s.monthMicros)}</span>
      <span className="text-slate-400">este mes</span>
      <span className="text-slate-300">·</span>
      <span className="font-semibold text-slate-900">{fmt(s.todayMicros)}</span>
      <span className="text-slate-400">hoy</span>
    </div>
  );
}
