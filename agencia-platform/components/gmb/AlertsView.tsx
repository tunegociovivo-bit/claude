"use client";

/**
 * Centro de ALERTAS + SLA (vista de agencia): lista con severidad, SLA/overdue, ack/resolver, enlaces
 * profundos y generación bajo demanda. Tenant-scoped. Estado vacío honesto.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertTriangle, Check, ExternalLink } from "lucide-react";

type Alert = { id: string; clientId: string | null; type: string; severity: string; title: string; body: string | null; status: string; deepLink: string | null; slaMinutes: number | null; overdue: boolean; createdAt: string };
const CARD = "bg-white rounded-xl border p-4";
const SEV: Record<string, string> = { critical: "bg-rose-100 text-rose-700", warning: "bg-amber-50 text-amber-700", info: "bg-slate-100 text-slate-600" };

export default function AlertsView() {
  const [data, setData] = useState<{ items: Alert[]; byStatus: any } | null>(null);
  const [status, setStatus] = useState("open");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/v1/gmb/alerts?status=${status === "all" ? "" : status}`).then((r) => r.json()).then((d) => setData(d.ok ? d : { items: [], byStatus: {} }));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  async function generate() { setBusy(true); try { await fetch("/api/v1/gmb/alerts", { method: "POST" }); load(); } finally { setBusy(false); } }
  async function transition(id: string, command: string) { await fetch(`/api/v1/gmb/alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) }); load(); }

  if (!data) return <div className="py-16 grid place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["open", "ack", "resolved", "all"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={`px-2.5 py-1 rounded-full border text-xs ${status === s ? "bg-brand-600 text-white border-brand-600" : "bg-white hover:bg-slate-50"}`}>{s === "open" ? "Abiertas" : s === "ack" ? "Reconocidas" : s === "resolved" ? "Resueltas" : "Todas"}</button>
        ))}
        <button onClick={generate} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 text-xs disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "↻"} Recalcular alertas</button>
      </div>
      {data.items.length === 0 ? (
        <div className={`${CARD} text-center py-12 text-sm text-slate-500`}>Sin alertas {status === "open" ? "abiertas" : ""}. El sistema las recalcula automáticamente (reseñas, citaciones, ranking, contenido, conexión).</div>
      ) : (
        <ul className="space-y-2">
          {data.items.map((a) => (
            <li key={a.id} className={`${CARD} flex items-start justify-between gap-3`}>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 flex items-center gap-2 flex-wrap">
                  <AlertTriangle className="h-3.5 w-3.5 text-slate-400" />{a.title}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${SEV[a.severity] ?? SEV.info}`}>{a.severity}</span>
                  {a.overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">SLA vencido</span>}
                  {a.status !== "open" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{a.status}</span>}
                </div>
                {a.body && <div className="text-[11px] text-slate-500 mt-0.5">{a.body}</div>}
                {a.deepLink && <a href={a.deepLink} className="text-[11px] text-brand-600 hover:underline inline-flex items-center gap-1 mt-0.5">Ver <ExternalLink className="h-3 w-3" /></a>}
              </div>
              <div className="shrink-0 flex flex-wrap gap-1 justify-end">
                {a.status === "open" && <button onClick={() => transition(a.id, "ack")} className="text-[11px] px-2 py-0.5 rounded border hover:bg-slate-50">Reconocer</button>}
                {a.status !== "resolved" && <button onClick={() => transition(a.id, "resolve")} className="text-[11px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 inline-flex items-center gap-1"><Check className="h-3 w-3" />Resolver</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
