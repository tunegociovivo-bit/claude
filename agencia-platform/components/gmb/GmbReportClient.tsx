"use client";

import { useEffect, useState } from "react";
import { Loader2, Printer, Star } from "lucide-react";

export default function GmbReportClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/gmb/clients/${id}/report`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se pudo cargar el informe"))))
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <div className="p-8 text-sm text-rose-600">{err}</div>;
  if (!data) return <div className="p-8 text-sm text-slate-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando informe…</div>;

  const { client, stats, monthly, reviews } = data;
  const maxMonthly = Math.max(1, ...monthly.map((m: any) => m.count));

  return (
    <div className="max-w-3xl mx-auto p-6 print:p-0">
      <style>{`@media print { .no-print { display:none !important; } body { background:#fff; } }`}</style>

      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-lg font-semibold">Informe — {client.name}</h1>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          <Printer className="h-4 w-4" /> Imprimir / Guardar PDF
        </button>
      </div>

      <div className="bg-white rounded-xl border p-6 space-y-6">
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <div className="text-xl font-bold text-slate-900">{client.name}</div>
            <div className="text-sm text-slate-500">{client.category}{client.address ? ` · ${client.address}` : ""}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-brand-600 flex items-center gap-1 justify-end">
              {stats.avg} <Star className="h-6 w-6 fill-brand-500 text-brand-500" />
            </div>
            <div className="text-xs text-slate-500">{stats.total} reseñas</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Stat label="Reseñas" value={stats.total} />
          <Stat label="Valoración media" value={stats.avg} />
          <Stat label="Tasa de respuesta" value={`${stats.responseRate}%`} />
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-700 mb-2">Distribución de estrellas</div>
          {[5, 4, 3, 2, 1].map((s) => {
            const n = stats.distribution[s] ?? 0;
            const pct = stats.total ? Math.round((n / stats.total) * 100) : 0;
            return (
              <div key={s} className="flex items-center gap-2 text-xs mb-1">
                <span className="w-8 text-slate-500">{s}★</span>
                <div className="flex-1 h-3 bg-slate-100 rounded overflow-hidden">
                  <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-right text-slate-500">{n}</span>
              </div>
            );
          })}
        </div>

        {monthly.length > 0 && (
          <div>
            <div className="text-sm font-semibold text-slate-700 mb-2">Reseñas por mes</div>
            <div className="flex items-end gap-1 h-24">
              {monthly.map((m: any) => (
                <div key={m.month} className="flex-1 flex flex-col items-center justify-end">
                  <div className="w-full bg-brand-400 rounded-t" style={{ height: `${(m.count / maxMonthly) * 100}%` }} title={`${m.count} reseñas`} />
                  <span className="text-[9px] text-slate-400 mt-1 rotate-0">{m.month.slice(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-sm font-semibold text-slate-700 mb-2">Últimas reseñas</div>
          <div className="space-y-2">
            {reviews.slice(0, 15).map((r: any, i: number) => (
              <div key={i} className="border-b pb-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">{r.author}</span>
                  <span className="text-brand-500">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                </div>
                {r.comment && <div className="text-slate-600 mt-0.5">{r.comment}</div>}
                {r.reply && <div className="text-slate-500 mt-1 pl-2 border-l-2 border-slate-200">Respuesta: {r.reply}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="text-[10px] text-slate-400 text-center pt-4 border-t">
          Generado el {new Date(data.generatedAt).toLocaleString("es-ES")} · GMB Hub
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center">
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
